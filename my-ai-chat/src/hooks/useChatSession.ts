import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  CHAT_URL,
  CLEAR_ALL_URL,
  HISTORY_ACCENT,
  LS_LEGACY_MESSAGES,
  LS_MULTICHAT,
  TITLE_URL,
} from "../chat/constants";
import type {
  ChatMessage,
  ChatsMap,
  PersistedMultiChatState,
  RagSourceEntry,
} from "../chat/types";
import {
  createChatStreamParser,
  feedChatStreamChunk,
  parseFullChatBody,
} from "../chat/parseChatStream";
import {
  formatChatHistoryTitle,
  getChatPreviewTitle,
  messagesToApiHistory,
  newMessageId,
  normalizeAssistantContent,
  normalizePersistedChatTitles,
  sanitizeAiTitle,
  timestampFromMessageId,
} from "../chat/utils";

function normalizeMessageList(list: ChatMessage[]): ChatMessage[] {
  return list.map((m) => {
    const base =
      m.role === "assistant" && !m.isError
        ? { ...m, content: normalizeAssistantContent(m.content) }
        : { ...m };
    if (base.at != null) return base;
    const fromId = timestampFromMessageId(base.id);
    return fromId != null ? { ...base, at: fromId } : base;
  });
}

function isPersistedState(o: unknown): o is PersistedMultiChatState {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  if (
    typeof x.chats !== "object" ||
    x.chats === null ||
    !Array.isArray(x.chatOrder) ||
    !x.chatOrder.every((id) => typeof id === "string") ||
    typeof x.activeChatId !== "string"
  ) {
    return false;
  }
  const chats = x.chats as Record<string, unknown>;
  return x.chatOrder.every((id) => Array.isArray(chats[id]));
}

function newWorkspace(): PersistedMultiChatState {
  const id = crypto.randomUUID();
  return {
    chats: { [id]: [] },
    chatOrder: [id],
    activeChatId: id,
  };
}

function repairWorkspace(s: PersistedMultiChatState): PersistedMultiChatState {
  const chatsIn = { ...s.chats };
  const ids = s.chatOrder.filter((id) => Array.isArray(chatsIn[id]));
  if (ids.length === 0) return newWorkspace();
  const chats = Object.fromEntries(ids.map((id) => [id, chatsIn[id]!])) as ChatsMap;
  let activeChatId = s.activeChatId;
  if (!ids.includes(activeChatId)) {
    activeChatId = ids[0]!;
  }
  return { chats, chatOrder: ids, activeChatId };
}

export function useChatSession() {
  const [chats, setChats] = useState<ChatsMap>({});
  const [chatTitles, setChatTitles] = useState<Record<string, string>>({});
  const [chatOrder, setChatOrder] = useState<string[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [hydrated, setHydrated] = useState(false);

  const clearAllMemory = useCallback(async () => {
    setLoading(false);
    try {
      await fetch(CLEAR_ALL_URL, { method: "POST" });
    } catch {
      /* server may be offline; still reset local UI */
    }
    const w = newWorkspace();
    setChats(w.chats);
    setChatOrder(w.chatOrder);
    setActiveChatId(w.activeChatId);
    setChatTitles({});
    setInput("");
  }, []);

  const requestAiTitle = useCallback(
    async (chatId: string, userMessage: string, assistantReply: string) => {
      try {
        const res = await fetch(TITLE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userMessage,
            assistantReply: assistantReply.slice(0, 800),
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { title?: string };
        if (!data.title || typeof data.title !== "string") return;
        const clean = sanitizeAiTitle(data.title);
        setChatTitles((prev) => ({ ...prev, [chatId]: clean }));
      } catch {
        /* sidebar keeps formatted first-message title */
      }
    },
    [],
  );

  useEffect(() => {
    try {
      const multi = localStorage.getItem(LS_MULTICHAT);
      if (multi) {
        const parsed = JSON.parse(multi) as unknown;
        if (isPersistedState(parsed)) {
          const fixed = repairWorkspace({
            chats: parsed.chats as ChatsMap,
            chatOrder: parsed.chatOrder,
            activeChatId: parsed.activeChatId,
          });
          setChats(
            Object.fromEntries(
              Object.entries(fixed.chats).map(([id, msgs]) => [
                id,
                normalizeMessageList(msgs as ChatMessage[]),
              ]),
            ),
          );
          setChatOrder(fixed.chatOrder);
          setActiveChatId(fixed.activeChatId);
          const withTitles = parsed as PersistedMultiChatState;
          setChatTitles(
            normalizePersistedChatTitles(withTitles.chatTitles, new Set(fixed.chatOrder)),
          );
          setHydrated(true);
          return;
        }
      }

      const legacyRaw = localStorage.getItem(LS_LEGACY_MESSAGES);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw) as unknown;
        if (Array.isArray(parsed)) {
          const id = crypto.randomUUID();
          const list = normalizeMessageList(parsed as ChatMessage[]);
          setChats({ [id]: list });
          setChatOrder([id]);
          setActiveChatId(id);
          setChatTitles({});
        } else {
          const w = newWorkspace();
          setChats(w.chats);
          setChatOrder(w.chatOrder);
          setActiveChatId(w.activeChatId);
          setChatTitles({});
        }
      } else {
        const w = newWorkspace();
        setChats(w.chats);
        setChatOrder(w.chatOrder);
        setActiveChatId(w.activeChatId);
        setChatTitles({});
      }
    } catch {
      const w = newWorkspace();
      setChats(w.chats);
      setChatOrder(w.chatOrder);
      setActiveChatId(w.activeChatId);
      setChatTitles({});
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !activeChatId) return;
    const payload: PersistedMultiChatState = {
      chats,
      chatOrder,
      activeChatId,
      chatTitles,
    };
    localStorage.setItem(LS_MULTICHAT, JSON.stringify(payload));
  }, [chats, chatOrder, activeChatId, chatTitles, hydrated]);

  const activeMessages = useMemo(
    () => chats[activeChatId] ?? [],
    [chats, activeChatId],
  );

  const selectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setInput("");
  }, []);

  const createNewChat = useCallback(() => {
    const id = crypto.randomUUID();
    setChatOrder((prev) => [...prev, id]);
    setChats((prev) => ({ ...prev, [id]: [] }));
    setActiveChatId(id);
    setInput("");
  }, []);

  const clearCurrentChat = useCallback(() => {
    setChats((prev) => ({
      ...prev,
      [activeChatId]: [],
    }));
    setChatTitles((prev) => {
      const next = { ...prev };
      delete next[activeChatId];
      return next;
    });
    setInput("");
  }, [activeChatId]);

  const deleteChat = useCallback(
    (chatIdToDelete: string) => {
      const nextOrder = chatOrder.filter((id) => id !== chatIdToDelete);
      const nextChats = { ...chats };
      delete nextChats[chatIdToDelete];
      const nextTitles = { ...chatTitles };
      delete nextTitles[chatIdToDelete];

      if (nextOrder.length === 0) {
        const newId = crypto.randomUUID();
        setChatOrder([newId]);
        setChats({ [newId]: [] });
        setChatTitles({});
        setActiveChatId(newId);
        setInput("");
        return;
      }

      setChatOrder(nextOrder);
      setChats(nextChats);
      setChatTitles(nextTitles);

      if (activeChatId === chatIdToDelete) {
        const idx = chatOrder.indexOf(chatIdToDelete);
        const nextActive = nextOrder[Math.max(0, idx - 1)] ?? nextOrder[0]!;
        setActiveChatId(nextActive);
        setInput("");
      }
    },
    [activeChatId, chatOrder, chats, chatTitles],
  );

  type PdfExchangeResult =
    | { status: "ok"; fileName: string; caption: string; text: string }
    | { status: "error"; fileName: string; caption: string; message: string };

  const applyPdfExchange = useCallback(
    (result: PdfExchangeResult) => {
      const streamChatId = activeChatId;
      if (!streamChatId) return;

      const listSnapshot = chats[streamChatId] ?? [];
      const isFirstExchange = listSnapshot.length === 0;
      const now = Date.now();
      const caption = result.caption.trim();
      const userMsg: ChatMessage = {
        id: newMessageId(),
        role: "user",
        content: caption,
        at: now,
        attachment: { kind: "pdf", name: result.fileName },
      };

      if (result.status === "ok") {
        const body = normalizeAssistantContent(
          result.text.trim() || "(No text extracted from this PDF.)",
        );
        const assistantMsg: ChatMessage = {
          id: newMessageId(),
          role: "assistant",
          content: body,
          at: Date.now(),
        };
        setChats((prev) => ({
          ...prev,
          [streamChatId]: [...(prev[streamChatId] ?? []), userMsg, assistantMsg],
        }));
        const titleSeed = caption || result.fileName;
        if (isFirstExchange) {
          const line = titleSeed.trim().replace(/\s+/g, " ");
          if (line) {
            const clipped = line.length > 25 ? `${line.slice(0, 25)}…` : line;
            setChatTitles((prev) => ({
              ...prev,
              [streamChatId]: formatChatHistoryTitle(clipped),
            }));
          }
          if (body.trim()) {
            void requestAiTitle(streamChatId, titleSeed, body);
          }
        }
        return;
      }

      const assistantMsg: ChatMessage = {
        id: newMessageId(),
        role: "assistant",
        content: result.message,
        isError: true,
        at: Date.now(),
      };
      setChats((prev) => ({
        ...prev,
        [streamChatId]: [...(prev[streamChatId] ?? []), userMsg, assistantMsg],
      }));
      if (isFirstExchange) {
        const line = (caption || result.fileName).trim().replace(/\s+/g, " ");
        if (line) {
          const clipped = line.length > 25 ? `${line.slice(0, 25)}…` : line;
          setChatTitles((prev) => ({
            ...prev,
            [streamChatId]: formatChatHistoryTitle(clipped),
          }));
        }
      }
    },
    [activeChatId, chats, requestAiTitle],
  );

  const sendMessage = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const message = input.trim();
      if (!message || loading) return;

      const streamChatId = activeChatId;
      if (!streamChatId) return;

      const listSnapshot = chats[streamChatId] ?? [];
      const isFirstExchange = listSnapshot.length === 0;
      const history = messagesToApiHistory(listSnapshot);
      const now = Date.now();
      const userMsg: ChatMessage = {
        id: newMessageId(),
        role: "user",
        content: message,
        at: now,
      };

      setChats((prev) => ({
        ...prev,
        [streamChatId]: [...(prev[streamChatId] ?? []), userMsg],
      }));
      if (isFirstExchange) {
        const line = message.trim().replace(/\s+/g, " ");
        if (line) {
          const clipped = line.length > 25 ? `${line.slice(0, 25)}…` : line;
          setChatTitles((prev) => ({
            ...prev,
            [streamChatId]: formatChatHistoryTitle(clipped),
          }));
        }
      }
      setInput("");
      setLoading(true);

      let streamTempId: string | null = null;

      try {
        const res = await fetch(CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history }),
        });

        if (!res.ok) {
          const errBody = (await res.text()).trim();
          setChats((prev) => ({
            ...prev,
            [streamChatId]: [
              ...(prev[streamChatId] ?? []),
              {
                id: newMessageId(),
                role: "assistant",
                content: errBody || `Request failed (${res.status})`,
                isError: true,
                at: Date.now(),
              },
            ],
          }));
          return;
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        const tempId = newMessageId();
        streamTempId = tempId;
        const assistantStartedAt = Date.now();
        setChats((prev) => ({
          ...prev,
          [streamChatId]: [
            ...(prev[streamChatId] ?? []),
            { id: tempId, role: "assistant", content: "", at: assistantStartedAt },
          ],
        }));

        if (!reader) {
          const raw = await res.text();
          const parsed = parseFullChatBody(raw);
          const text = normalizeAssistantContent(parsed.text);
          setChats((prev) => ({
            ...prev,
            [streamChatId]: (prev[streamChatId] ?? []).map((msg) =>
              msg.id === tempId
                ? {
                    ...msg,
                    content: text,
                    ...(parsed.sources?.length ? { sources: parsed.sources } : {}),
                  }
                : msg,
            ),
          }));
          if (isFirstExchange && text.trim()) {
            void requestAiTitle(streamChatId, message, text);
          }
          return;
        }

        const parseState = createChatStreamParser();
        let streamSources: RagSourceEntry[] | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.length) continue;

          const chunk = decoder.decode(value, { stream: true });
          const { sources: srcFromChunk, textDelta } = feedChatStreamChunk(parseState, chunk);
          if (srcFromChunk && srcFromChunk.length > 0) {
            streamSources = srcFromChunk;
          }
          fullText += textDelta;

          flushSync(() => {
            setChats((prev) => ({
              ...prev,
              [streamChatId]: (prev[streamChatId] ?? []).map((msg) =>
                msg.id === tempId
                  ? {
                      ...msg,
                      content: fullText,
                      ...(streamSources && streamSources.length > 0 ? { sources: streamSources } : {}),
                    }
                  : msg,
              ),
            }));
          });
        }

        fullText += decoder.decode();
        fullText = normalizeAssistantContent(fullText);
        setChats((prev) => ({
          ...prev,
          [streamChatId]: (prev[streamChatId] ?? []).map((msg) =>
            msg.id === tempId
              ? {
                  ...msg,
                  content: fullText,
                  ...(streamSources && streamSources.length > 0 ? { sources: streamSources } : {}),
                }
              : msg,
          ),
        }));
        if (isFirstExchange && fullText.trim()) {
          void requestAiTitle(streamChatId, message, fullText);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Network error";
        setChats((prev) => {
          const list = prev[streamChatId] ?? [];
          const withoutDraft = streamTempId
            ? list.filter((m) => m.id !== streamTempId)
            : list;
          return {
            ...prev,
            [streamChatId]: [
              ...withoutDraft,
              {
                id: newMessageId(),
                role: "assistant",
                content: errMsg,
                isError: true,
                at: Date.now(),
              },
            ],
          };
        });
      } finally {
        setLoading(false);
      }
    },
    [activeChatId, chats, input, loading, requestAiTitle],
  );

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const sidebarChats = useMemo(
    () =>
      [...chatOrder].reverse().map((id, i) => ({
        id,
        title: formatChatHistoryTitle(chatTitles[id] ?? getChatPreviewTitle(chats[id])),
        accent: HISTORY_ACCENT[(chatOrder.length - 1 - i) % HISTORY_ACCENT.length],
      })),
    [chatOrder, chats, chatTitles],
  );

  return {
    input,
    setInput,
    messages: activeMessages,
    loading,
    theme,
    activeChatId,
    sidebarChats,
    selectChat,
    createNewChat,
    clearCurrentChat,
    clearAllMemory,
    deleteChat,
    sendMessage,
    applyPdfExchange,
    toggleTheme,
  };
}
