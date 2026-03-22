export type ChatAttachment = {
  kind: "pdf";
  name: string;
};

/** RAG hit for the Sources list (server sends fileName + optional chunk text). */
export type RagSourceEntry = {
  fileName: string;
  text?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Unix ms when the message was created (optional on older persisted data). */
  at?: number;
  isError?: boolean;
  /** Optional file the user sent (shown in the user bubble). */
  attachment?: ChatAttachment;
  /** RAG retrieval sources under the assistant reply (streaming). */
  sources?: RagSourceEntry[];
};

/** All conversations keyed by id (see `chatOrder` for sidebar order). */
export type ChatsMap = Record<string, ChatMessage[]>;

export type PersistedMultiChatState = {
  chats: ChatsMap;
  chatOrder: string[];
  activeChatId: string;
  /** Optional sidebar labels (AI-generated or user-defined); fallback uses first message. */
  chatTitles?: Record<string, string>;
};

export type ChatApiPayload = {
  role: "user" | "assistant";
  content: string;
};

export type ChatApiResponse = {
  reply?: string;
  error?: string;
  details?: string;
};
