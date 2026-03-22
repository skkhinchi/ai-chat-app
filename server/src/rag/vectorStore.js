/**
 * In-memory vector store for RAG (Phase 2). No persistence — multiple PDFs append; never reset here.
 * @type {{ text: string; vector: number[]; fileName?: string }[]}
 */
export const vectorStore = [];

/**
 * @param {{ text: string; vector: number[]; fileName?: string }[]} items
 */
export function appendToVectorStore(items) {
  vectorStore.push(...items);
}

/** Wipes all in-memory embeddings (no disk DB — only this process’s RAM). */
export function clearVectorStore() {
  vectorStore.length = 0;
  return vectorStore.length;
}
