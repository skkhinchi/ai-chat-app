export const CHAT_URL = "http://localhost:8000/chat";
export const TITLE_URL = "http://localhost:8000/title";
export const UPLOAD_URL = "http://localhost:8000/upload";
/** Clears in-memory RAG embeddings (server `vectorStore`). */
export const CLEAR_DOCS_URL = "http://localhost:8000/clear-docs";
/** Clears server `vectorStore`; client resets chats + composer (see `clearAllMemory`). */
export const CLEAR_ALL_URL = "http://localhost:8000/clear-all";

export const LS_MULTICHAT = "ai_multichat_v1";
/** Legacy single-thread keys (migrated once into LS_MULTICHAT). */
export const LS_LEGACY_MESSAGES = "chat_messages";
export const LS_LEGACY_HISTORY = "chat_history";

export const HISTORY_ACCENT = ["#a855f7", "#14b8a6", "#ec4899", "#f97316"] as const;
