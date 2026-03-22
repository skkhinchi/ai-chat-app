import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus, vs } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./Home.css";
import brandLogo from "./assets/logo.png";
import {
  IconCopy,
  IconDoc,
  IconMenu,
  IconMoon,
  IconSend,
  IconStar,
  IconSun,
  IconTrash,
  IconXSmall,
} from "./chat/icons";
import { uploadPdfFile } from "./chat/uploadPdf";
import type { ChatMessage, RagSourceEntry } from "./chat/types";
import {
  copyToClipboard,
  formatMessageTimestamp,
  getMessageTimestamp,
} from "./chat/utils";
import { useChatSession } from "./hooks/useChatSession";

function fileIdentity(f: File): string {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

function isLikelyPdf(f: File): boolean {
  if (f.type === "application/pdf") return true;
  return f.name.toLowerCase().endsWith(".pdf");
}

/** Merge new picks with existing; dedupe identical files. */
function mergePdfFiles(existing: File[], incoming: File[]): File[] {
  const seen = new Set(existing.map(fileIdentity));
  const out = [...existing];
  for (const f of incoming) {
    if (!isLikelyPdf(f)) continue;
    const id = fileIdentity(f);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(f);
  }
  return out;
}

/** Older persisted messages may still have `sources: string[]` (chunk text). */
function normalizeRagSources(s: ChatMessage["sources"]): RagSourceEntry[] {
  if (!s?.length) return [];
  const first = s[0];
  if (typeof first === "string") {
    return (s as unknown as string[]).map((fileName) => ({ fileName }));
  }
  return s;
}

/** Same PDF can appear in multiple chunks; list each file once. */
function uniqueSourcesByFileName(entries: RagSourceEntry[]): RagSourceEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.fileName)) return false;
    seen.add(e.fileName);
    return true;
  });
}

type SidebarChatItem = {
  id: string;
  title: string;
  accent: string;
};

type ChatSidebarProps = {
  theme: "dark" | "light";
  activeChatId: string;
  sidebarChats: SidebarChatItem[];
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onClearCurrentChat: () => void;
  onClearAllMemory: () => void | Promise<void>;
  onAskDeleteChat: (chatId: string, title: string) => void;
  onToggleTheme: () => void;
};

function DeleteChatModal({
  chatTitle,
  onClose,
  onConfirm,
}: {
  chatTitle: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>(".chat-modal-btn-danger")?.focus();
  }, []);

  return (
    <div className="chat-modal-root" role="presentation">
      <button
        type="button"
        className="chat-modal-backdrop"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="chat-modal-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="chat-delete-modal-title"
        aria-describedby="chat-delete-modal-desc"
      >
        <h2 id="chat-delete-modal-title" className="chat-modal-title">
          Delete this chat?
        </h2>
        <p id="chat-delete-modal-desc" className="chat-modal-body">
          <span className="chat-modal-chat-title">{chatTitle}</span> will be removed from your
          history. This cannot be undone.
        </p>
        <div className="chat-modal-actions">
          <button type="button" className="chat-modal-btn chat-modal-btn-muted" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="chat-modal-btn chat-modal-btn-danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatSidebar({
  theme,
  activeChatId,
  sidebarChats,
  onSelectChat,
  onNewChat,
  onClearCurrentChat,
  onClearAllMemory,
  onAskDeleteChat,
  onToggleTheme,
}: ChatSidebarProps) {
  return (
    <aside className="chat-sidebar" aria-label="Chats">
      <div className="chat-sidebar-header">
        <div className="chat-sidebar-branding">
          <button type="button" className="chat-icon-btn chat-branding-menu" aria-label="Menu">
            <IconMenu />
          </button>
          <div className="chat-sidebar-brand">
            <div className="chat-brand-logo-frame">
              <img src={brandLogo} alt="DXYRA" className="chat-brand-logo" decoding="async" />
            </div>
          </div>
          <button type="button" className="chat-new-btn chat-branding-newchat" onClick={onNewChat}>
            <span className="chat-new-btn-inner">
              <span className="chat-new-btn-plus" aria-hidden>
                +
              </span>
              <span className="chat-new-btn-full">New Chat</span>
              <span className="chat-new-btn-short" aria-hidden>
                +
              </span>
            </span>
          </button>
        </div>
        <div className="chat-sidebar-divider" aria-hidden />
        <div className="chat-history-label">Chat history</div>
      </div>
      <ul className="chat-history-list">
        {sidebarChats.length === 0 ? (
          <li className="chat-history-item-static" style={{ color: "var(--chat-muted)", fontSize: 13 }}>
            No chats
          </li>
        ) : (
          sidebarChats.map((item) => {
            const isActive = item.id === activeChatId;
            return (
              <li
                key={item.id}
                className={`chat-history-row${isActive ? " chat-history-row-active" : ""}`}
              >
                <button
                  type="button"
                  className={`chat-history-item${isActive ? " chat-history-item-active" : ""}`}
                  onClick={() => onSelectChat(item.id)}
                  title={item.title}
                  aria-current={isActive ? "true" : undefined}
                >
                  <span
                    className={`chat-history-dot${isActive ? " chat-history-dot-active" : ""}`}
                    style={
                      isActive
                        ? undefined
                        : {
                            background: `linear-gradient(145deg, ${item.accent}, ${item.accent}99)`,
                            color: "#fff",
                          }
                    }
                  >
                    <IconStar />
                  </span>
                  <span className="chat-history-text">{item.title}</span>
                </button>
                <button
                  type="button"
                  className="chat-history-delete"
                  aria-label={`Delete chat: ${item.title}`}
                  title="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAskDeleteChat(item.id, item.title);
                  }}
                >
                  <IconTrash />
                </button>
              </li>
            );
          })
        )}
      </ul>
      <div className="chat-sidebar-actions">
        <button type="button" className="chat-clear-btn" onClick={onClearCurrentChat}>
          Clear this chat
        </button>
        <button
          type="button"
          className="chat-clear-memory-btn"
          onClick={() => void onClearAllMemory()}
          aria-label="Clear memory: remove all chats and server-side document index"
        >
          <span aria-hidden>🧹</span> Clear Memory
        </button>
      </div>
      <div className="chat-sidebar-footer">
        <button type="button" className="chat-theme-btn" onClick={onToggleTheme}>
          {theme === "dark" ? <IconSun /> : <IconMoon />}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>
    </aside>
  );
}

function ChatMainHeader() {
  return (
    <header className="chat-header">
      <span>Dxyra AI</span>
    </header>
  );
}

const PRISM_LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  rs: "rust",
  cxx: "cpp",
};

function normalizePrismLanguage(raw: string | undefined): string {
  const key = (raw || "clike").toLowerCase();
  if (key === "text" || key === "txt" || key === "plain") return "clike";
  return PRISM_LANG_ALIASES[key] ?? key;
}

function codeBlockSource(children: ReactNode): string {
  return String(children).replace(/\n$/, "");
}

/** Fenced blocks use `language-*`; unlabeled multi-line fences have no class but include a newline. */
function isMdFencedCodeBlock(className: string | undefined, children: ReactNode): boolean {
  if (/\blanguage-[\w-]+\b/.test(String(className || ""))) return true;
  return String(children).includes("\n");
}

function createChatMarkdownComponents(theme: "dark" | "light"): Components {
  const prismStyle = theme === "dark" ? vscDarkPlus : vs;
  return {
    a: ({ href, children, ...props }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    ),
    code({ className, children, ...props }) {
      if (!isMdFencedCodeBlock(className, children)) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      const match = /language-([\w-]+)/.exec(className || "");
      const lang = normalizePrismLanguage(match?.[1]);
      const source = codeBlockSource(children);
      return (
        <SyntaxHighlighter
          language={lang}
          style={prismStyle}
          PreTag="div"
          className="chat-md-syntax"
          customStyle={{
            margin: 0,
            padding: "40px 14px 14px",
            borderRadius: 0,
            fontSize: "13px",
            lineHeight: 1.5,
          }}
          wrapLongLines
        >
          {source}
        </SyntaxHighlighter>
      );
    },
    pre: ({ children, ...rest }) => {
      const { node: _omit, ...domRest } = rest as typeof rest & { node?: unknown };
      void _omit;
      return (
        <MarkdownCodeBlock {...(domRest as Omit<ComponentPropsWithoutRef<"pre">, "children">)}>
          {children}
        </MarkdownCodeBlock>
      );
    },
  };
}

function MarkdownCodeBlock({
  children,
  ...rest
}: Omit<ComponentPropsWithoutRef<"pre">, "children"> & { children?: ReactNode }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    const text = bodyRef.current?.textContent ?? "";
    if (!text.trim()) return;
    await copyToClipboard(text);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 2000);
  };

  return (
    <div className="chat-md-code-block">
      <button
        type="button"
        className={`chat-md-code-icon-btn chat-md-code-copy${copied ? " chat-copy-btn-copied" : ""}`}
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        <IconCopy />
      </button>
      <div ref={bodyRef} className="chat-md-code-block-body" {...(rest as ComponentPropsWithoutRef<"div">)}>
        {children}
      </div>
    </div>
  );
}

type MessageBubbleProps = {
  msg: ChatMessage;
  theme: "dark" | "light";
};

function MessageTimestamp({ msg }: { msg: ChatMessage }) {
  const at = getMessageTimestamp(msg);
  if (at == null) return null;
  return (
    <time className="chat-msg-time" dateTime={new Date(at).toISOString()}>
      {formatMessageTimestamp(at)}
    </time>
  );
}

function MessageBubble({ msg, theme }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    await copyToClipboard(msg.content);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 2000);
  };

  const mdComponents = useMemo(() => createChatMarkdownComponents(theme), [theme]);

  if (msg.role === "user") {
    const att = msg.attachment;
    return (
      <div className="chat-row chat-row-user">
        <div className="chat-bubble-stack-user">
          <div className="chat-bubble-user">
            {att?.kind === "pdf" ? (
              <div className="chat-user-attach-card">
                <IconDoc />
                <span className="chat-user-attach-name">{att.name}</span>
                <span className="chat-user-attach-kind">PDF</span>
              </div>
            ) : null}
            {msg.content.trim() ? <div className="chat-user-text">{msg.content}</div> : null}
          </div>
          <MessageTimestamp msg={msg} />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-row chat-row-assistant">
      <div className="chat-avatar" aria-hidden>
        <IconStar />
      </div>
      <div className="chat-assistant-block">
        <div className={`chat-bubble-assistant${msg.isError ? " error" : " chat-md"}`}>
          {msg.isError ? (
            msg.content
          ) : (
            <ReactMarkdown components={mdComponents}>
              {msg.content}
            </ReactMarkdown>
          )}
        </div>
        {!msg.isError && msg.sources && msg.sources.length > 0 ? (
          <div className="sources">
            <h4 className="sources-heading">Sources</h4>
            {uniqueSourcesByFileName(normalizeRagSources(msg.sources)).map((src, i) => (
              <div
                key={`${src.fileName}-${i}`}
                className="sources-item"
                title={src.text ?? undefined}
              >
                <span className="sources-item-row">
                  <span className="sources-item-icon" aria-hidden>
                    <IconDoc />
                  </span>
                  <span className="sources-item-name">{src.fileName}</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <MessageTimestamp msg={msg} />
        {!msg.isError && msg.content.length > 0 && (
          <div className="chat-copy-row">
            <button
              type="button"
              className={`chat-copy-btn${copied ? " chat-copy-btn-copied" : ""}`}
              onClick={handleCopy}
            >
              <IconCopy />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type ChatThreadProps = {
  messages: ChatMessage[];
  loading: boolean;
  activeChatId: string;
  theme: "dark" | "light";
};

function ChatThread({ messages, loading, activeChatId, theme }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];
  const replyHasStarted =
    last?.role === "assistant" && (last.content.length > 0 || last.isError);
  const showThinking = loading && !replyHasStarted;

  const visibleMessages = messages.filter(
    (m) =>
      !(loading && m.role === "assistant" && m.content === "" && !m.isError),
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, activeChatId, showThinking]);

  return (
    <div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions">
      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} theme={theme} />
      ))}
      {showThinking && (
        <div className="chat-row chat-row-assistant chat-typing-row" aria-busy="true" aria-label="Assistant is thinking">
          <div className="chat-avatar" aria-hidden>
            <IconStar />
          </div>
          <div className="chat-typing-card">
            <div className="chat-typing-shimmer" aria-hidden />
            <div className="chat-typing-inner">
              <span className="chat-typing-label">Thinking</span>
              <span className="chat-typing-dots" aria-hidden>
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
              </span>
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} className="chat-messages-bottom-anchor" aria-hidden />
    </div>
  );
}

type ChatComposerProps = {
  input: string;
  loading: boolean;
  pendingPdfs: File[];
  onAddPdfs: (files: File[]) => void;
  onRemovePdfAt: (index: number) => void;
  onInputChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void | Promise<void>;
};

function ChatComposer({
  input,
  loading,
  pendingPdfs,
  onAddPdfs,
  onRemovePdfAt,
  onInputChange,
  onSubmit,
}: ChatComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pendingPdfs.length === 0 && fileInputRef.current) fileInputRef.current.value = "";
  }, [pendingPdfs.length]);

  /** Shrink empty / single-line field; min/max caps come from CSS (1–4 lines). */
  const syncComposerHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.removeProperty("min-height");
    el.style.removeProperty("max-height");
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    let minH = parseFloat(cs.minHeight);
    let maxH = parseFloat(cs.maxHeight);
    const fontSize = parseFloat(cs.fontSize) || 15;
    const lhRaw = cs.lineHeight;
    const lineH =
      lhRaw === "normal" ? fontSize * 1.45 : parseFloat(lhRaw) || fontSize * 1.45;
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    if (!Number.isFinite(minH) || minH <= 0) minH = padY + lineH;
    if (!Number.isFinite(maxH) || maxH <= 0) maxH = padY + lineH * 4;
    const scrollH = el.scrollHeight;
    let h = scrollH;
    h = Math.max(h, minH);
    h = Math.min(h, maxH);
    el.style.height = `${Math.ceil(h)}px`;
  }, []);

  useLayoutEffect(() => {
    syncComposerHeight();
    const id = requestAnimationFrame(() => {
      syncComposerHeight();
    });
    return () => cancelAnimationFrame(id);
  }, [input, loading, pendingPdfs.length, syncComposerHeight]);

  const canSend = Boolean(input.trim() || pendingPdfs.length > 0);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (loading || !canSend) return;
    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} className="chat-input-bar" onSubmit={onSubmit}>
      <div className="chat-input-wrap">
        {pendingPdfs.length > 0 ? (
          <div className="chat-pdf-chips" aria-label="Attached PDFs">
            {pendingPdfs.map((file, index) => (
              <div key={`${fileIdentity(file)}-${index}`} className="chat-pdf-chip">
                <span className="chat-pdf-chip-name" title={file.name}>
                  {file.name}
                </span>
                <button
                  type="button"
                  className="chat-pdf-chip-remove"
                  aria-label={`Remove ${file.name}`}
                  disabled={loading}
                  onClick={() => onRemovePdfAt(index)}
                >
                  <IconXSmall />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="chat-input-row">
          <div className="chat-input-slot">
            <textarea
              ref={textareaRef}
              className="chat-input-field"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Start a conversation…"
              disabled={loading}
              autoComplete="off"
              aria-label="Message"
              rows={1}
            />
          </div>
          <label
            className={`chat-attach-btn${loading ? " chat-attach-btn--busy" : ""}`}
            title={pendingPdfs.length ? `${pendingPdfs.length} PDF(s) — add more` : "Attach PDFs"}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="chat-file-input-native"
              disabled={loading}
              aria-label="Attach PDF files"
              onChange={(e) => {
                const list = e.target.files;
                if (list?.length) onAddPdfs(Array.from(list));
                e.target.value = "";
              }}
            />
            <span className="chat-attach-btn-face" aria-hidden>
              <IconDoc />
            </span>
            {pendingPdfs.length > 0 ? (
              <span className="chat-attach-count" aria-hidden>
                {pendingPdfs.length > 99 ? "99+" : pendingPdfs.length}
              </span>
            ) : null}
          </label>
          <button
            type="submit"
            className="chat-send-btn"
            disabled={loading || !canSend}
            aria-label="Send"
          >
            <IconSend />
          </button>
        </div>
      </div>
    </form>
  );
}

function Home() {
  const {
    input,
    setInput,
    messages,
    loading,
    theme,
    activeChatId,
    sidebarChats,
    selectChat,
    createNewChat,
    clearCurrentChat: clearCurrentChatFromHook,
    clearAllMemory,
    deleteChat,
    sendMessage,
    applyPdfExchange,
    toggleTheme,
  } = useChatSession();

  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [pendingPdfs, setPendingPdfs] = useState<File[]>([]);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const composerBusy = loading || pdfUploading;

  const addPendingPdfs = useCallback((files: File[]) => {
    setPendingPdfs((prev) => mergePdfFiles(prev, files));
  }, []);

  const removePendingPdfAt = useCallback((index: number) => {
    setPendingPdfs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const prevActiveChatIdRef = useRef<string | undefined>(undefined);

  /** Pending PDFs are scoped to the active chat (same as the shared input field). */
  useEffect(() => {
    if (!activeChatId) return;
    const prev = prevActiveChatIdRef.current;
    prevActiveChatIdRef.current = activeChatId;
    if (prev === undefined || prev === activeChatId) return;
    setPendingPdfs([]);
    setUploadNotice(null);
  }, [activeChatId]);

  const clearCurrentChat = useCallback(() => {
    clearCurrentChatFromHook();
    setPendingPdfs([]);
    setUploadNotice(null);
  }, [clearCurrentChatFromHook]);

  const handleClearAllMemory = useCallback(async () => {
    setPdfUploading(false);
    setPendingPdfs([]);
    setUploadNotice(null);
    prevActiveChatIdRef.current = undefined;
    await clearAllMemory();
  }, [clearAllMemory]);

  useEffect(() => {
    if (!uploadNotice) return;
    const t = window.setTimeout(() => setUploadNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [uploadNotice]);

  const handleComposerSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (loading || pdfUploading) return;
      const message = input.trim();
      if (!message && pendingPdfs.length === 0) return;

      if (pendingPdfs.length > 0) {
        const files = [...pendingPdfs];
        const captionFirst = message;
        setPdfUploading(true);
        setPendingPdfs([]);
        setInput("");
        let lastServerMessage: string | undefined;
        let okCount = 0;
        let errCount = 0;
        try {
          for (let i = 0; i < files.length; i++) {
            const file = files[i]!;
            const caption = i === 0 ? captionFirst : "";
            try {
              const { text, message: serverMessage } = await uploadPdfFile(file);
              lastServerMessage = serverMessage ?? lastServerMessage;
              okCount += 1;
              applyPdfExchange({
                status: "ok",
                fileName: file.name,
                caption,
                text,
              });
            } catch (err) {
              errCount += 1;
              const errMsg = err instanceof Error ? err.message : "PDF upload failed";
              applyPdfExchange({
                status: "error",
                fileName: file.name,
                caption,
                message: errMsg,
              });
            }
          }
          if (okCount > 0) {
            if (files.length > 1) {
              setUploadNotice(
                errCount > 0
                  ? `${okCount} of ${files.length} PDFs processed (${errCount} failed)`
                  : `${okCount} PDFs processed successfully`,
              );
            } else {
              setUploadNotice(lastServerMessage ?? "PDF processed successfully");
            }
          } else if (errCount > 0) {
            setUploadNotice(
              files.length > 1 ? `Could not process ${errCount} PDFs` : "Could not process PDF",
            );
          }
        } finally {
          setPdfUploading(false);
        }
        return;
      }

      if (message) {
        await sendMessage(e);
      }
    },
    [input, loading, pdfUploading, pendingPdfs, sendMessage, applyPdfExchange, setInput],
  );

  return (
    <div className="chat-shell" data-chat-theme={theme}>
      {pendingDelete && (
        <DeleteChatModal
          chatTitle={pendingDelete.title}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteChat(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      )}
      <ChatSidebar
        theme={theme}
        activeChatId={activeChatId}
        sidebarChats={sidebarChats}
        onSelectChat={selectChat}
        onNewChat={createNewChat}
        onClearCurrentChat={clearCurrentChat}
        onClearAllMemory={handleClearAllMemory}
        onAskDeleteChat={(id, title) => setPendingDelete({ id, title })}
        onToggleTheme={toggleTheme}
      />
      <main className="chat-main">
        <ChatMainHeader />
        <ChatThread
          messages={messages}
          loading={loading || pdfUploading}
          activeChatId={activeChatId}
          theme={theme}
        />
        {uploadNotice ? (
          <div className="chat-upload-notice" role="status">
            {uploadNotice}
          </div>
        ) : null}
        <ChatComposer
          input={input}
          loading={composerBusy}
          pendingPdfs={pendingPdfs}
          onAddPdfs={addPendingPdfs}
          onRemovePdfAt={removePendingPdfAt}
          onInputChange={setInput}
          onSubmit={handleComposerSubmit}
        />
      </main>
    </div>
  );
}

export default Home;
