import type { ChatApiPayload, ChatMessage } from "./types";

/** Lowercase words that stay lowercase in the middle of a title (English). */
const TITLE_SMALL_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "nor",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "as",
  "by",
  "is",
  "if",
  "it",
  "vs",
  "vs.",
  "per",
  "from",
  "with",
  "into",
  "over",
]);

function capitalizeWordSegment(segment: string): string {
  if (!segment) return segment;
  if (/^[A-Z]{2,6}$/.test(segment)) return segment;
  const lower = segment.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Hyphenated or plain word; preserves mixed-case tokens (e.g. iOS, ChatGPT). */
function capitalizeWordToken(word: string): string {
  if (!word) return word;
  if (/[a-z]/.test(word) && /[A-Z]/.test(word) && word.length > 1) {
    return word;
  }
  return word.split("-").map(capitalizeWordSegment).join("-");
}

/**
 * Title-style capitalization for sidebar chat labels (English-friendly).
 * — First / last word always capitalized (except pure ellipsis).
 * — Small words (of, and, …) stay lowercase in the middle.
 */
export function formatChatHistoryTitle(title: string): string {
  const t = title.trim().replace(/\s+/g, " ");
  if (!t) return t;
  if (/^new chat$/i.test(t)) return "New Chat";

  const words = t.split(" ");
  const n = words.length;

  return words
    .map((word, i) => {
      if (!word) return word;

      const hasEllipsis = word.endsWith("…");
      const w = hasEllipsis ? word.slice(0, -1) : word;
      if (!w && hasEllipsis) return "…";

      const trailing = w.match(/([.!?,;:]+)$/)?.[1] ?? "";
      const core = trailing ? w.slice(0, -trailing.length) : w;
      const bareLower = core.toLowerCase();
      const isFirst = i === 0;
      const isLast = i === n - 1;
      const useSmall = !isFirst && !isLast && TITLE_SMALL_WORDS.has(bareLower);

      const piece = useSmall
        ? bareLower + trailing
        : capitalizeWordToken(core) + trailing;

      return piece + (hasEllipsis ? "…" : "");
    })
    .join(" ");
}

/** Turn raw first user text into a single-line sidebar title (no wall of text). */
export function formatFirstMessageTitle(raw: string, maxLen = 42): string {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "New Chat";
  const sentenceEnd = t.search(/[.!?]\s/);
  if (sentenceEnd > 8 && sentenceEnd <= maxLen + 15) {
    t = t.slice(0, sentenceEnd + 1).trim();
  }
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function userMessageApiContent(m: ChatMessage): string {
  const base = m.content.trim();
  if (m.attachment?.kind === "pdf") {
    const label = `[PDF attachment: ${m.attachment.name}]`;
    return base ? `${label}\n${base}` : label;
  }
  return m.content;
}

/** Sidebar fallback when no stored `chatTitles[id]`. */
export function getChatPreviewTitle(messages: ChatMessage[] | undefined): string {
  if (!messages?.length) return "New Chat";
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New Chat";
  const t = firstUser.content?.trim() ?? "";
  if (firstUser.attachment?.kind === "pdf") {
    if (t) {
      const line = formatFirstMessageTitle(t);
      return line === "New Chat" ? "New Chat" : formatChatHistoryTitle(line);
    }
    const fromName = firstUser.attachment.name.replace(/\.pdf$/i, "") || firstUser.attachment.name;
    return formatChatHistoryTitle(formatFirstMessageTitle(fromName));
  }
  if (!t) return "New Chat";
  const line = formatFirstMessageTitle(t);
  if (line === "New Chat") return "New Chat";
  return formatChatHistoryTitle(line);
}

export function sanitizeAiTitle(raw: string, maxLen = 48): string {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(/^["'«»]|["'«»]$/g, "").replace(/[.…]+$/g, "").trim();
  let base: string;
  if (t.length <= maxLen) base = t || "Chat";
  else {
    const cut = t.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(" ");
    base = (lastSpace > 8 ? cut.slice(0, lastSpace) : cut).trim() || "Chat";
  }
  return formatChatHistoryTitle(base);
}

export function normalizePersistedChatTitles(
  raw: unknown,
  validIds: Set<string>,
): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (validIds.has(k) && typeof v === "string") {
      const t = v.trim();
      if (t) out[k] = formatChatHistoryTitle(t.slice(0, 80));
    }
  }
  return out;
}

export function newMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Recover time from ids produced by {@link newMessageId}. */
export function timestampFromMessageId(id: string): number | undefined {
  const head = id.split("-")[0];
  const n = Number(head);
  if (!Number.isFinite(n) || n < 1e12) return undefined;
  return n;
}

export function getMessageTimestamp(msg: ChatMessage): number | undefined {
  if (msg.at != null && Number.isFinite(msg.at)) return msg.at;
  return timestampFromMessageId(msg.id);
}

/** e.g. "10:45 PM" — always 12-hour with AM/PM. */
export function formatMessageTimestamp(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function messagesToApiHistory(messages: ChatMessage[]): ChatApiPayload[] {
  return messages
    .filter((m) => !m.isError)
    .map((c) => ({
      role: c.role === "user" ? "user" : "assistant",
      content:
        c.role === "assistant"
          ? normalizeAssistantContent(c.content)
          : userMessageApiContent(c),
    }));
}

/** Unwrap legacy `{ "reply": "..." }` bodies so the UI shows plain text. */
export function normalizeAssistantContent(text: string): string {
  const t = text.trim();
  if (!t.startsWith("{")) return text;
  try {
    const o = JSON.parse(t) as unknown;
    if (
      o &&
      typeof o === "object" &&
      "reply" in o &&
      typeof (o as { reply: unknown }).reply === "string"
    ) {
      return (o as { reply: string }).reply;
    }
  } catch {
    /* incomplete or non-JSON */
  }
  return text;
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}
