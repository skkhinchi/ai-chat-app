/** Parses optional leading SSE line: `data: {"type":"source","sources":[...]}\n\n` then plain text. */

import type { RagSourceEntry } from "./types";

export type FeedChunkResult = {
  sources: RagSourceEntry[] | null;
  textDelta: string;
};

function parseRawSource(raw: unknown): RagSourceEntry | null {
  if (typeof raw === "string") {
    return { fileName: raw };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const fileName = typeof o.fileName === "string" ? o.fileName.trim() : "";
    const text = typeof o.text === "string" ? o.text : undefined;
    if (fileName) return text ? { fileName, text } : { fileName };
    if (text) return { fileName: text };
  }
  return null;
}

export type ChatStreamParseState = {
  mode: "sse" | "text";
  buf: string;
};

export function createChatStreamParser(): ChatStreamParseState {
  return { mode: "sse", buf: "" };
}

export function feedChatStreamChunk(
  state: ChatStreamParseState,
  chunk: string,
): FeedChunkResult {
  if (state.mode === "text") {
    return { sources: null, textDelta: chunk };
  }

  state.buf += chunk;

  if (state.buf.length >= 6 && !state.buf.startsWith("data: ")) {
    state.mode = "text";
    const textDelta = state.buf;
    state.buf = "";
    return { sources: null, textDelta };
  }

  if (!state.buf.startsWith("data: ")) {
    state.mode = "text";
    const textDelta = state.buf;
    state.buf = "";
    return { sources: null, textDelta };
  }

  const sep = state.buf.indexOf("\n\n");
  if (sep === -1) {
    return { sources: null, textDelta: "" };
  }

  const line = state.buf.slice(0, sep);
  const rest = state.buf.slice(sep + 2);
  state.buf = "";
  state.mode = "text";

  let sources: RagSourceEntry[] | null = null;
  try {
    const payload = JSON.parse(line.slice(6)) as { type?: string; sources?: unknown };
    if (payload?.type === "source" && Array.isArray(payload.sources)) {
      const parsed = payload.sources
        .map(parseRawSource)
        .filter((x): x is RagSourceEntry => x != null);
      sources = parsed.length > 0 ? parsed : null;
    }
  } catch {
    /* ignore */
  }

  return { sources, textDelta: rest };
}

/** Non-streaming body (e.g. missing `getReader()`): strip optional SSE prefix, return text + sources. */
export function parseFullChatBody(raw: string): { sources?: RagSourceEntry[]; text: string } {
  const st = createChatStreamParser();
  const r = feedChatStreamChunk(st, raw);
  return {
    sources: r.sources ?? undefined,
    text: r.textDelta + (st.mode === "sse" ? st.buf : ""),
  };
}
