import { cosineSimilarity } from "./cosineSimilarity.js";

/**
 * Top-K retrieval by cosine similarity against an in-memory vector store.
 * @param {{ text: string; vector: number[]; fileName?: string }[]} vectorStore
 * @param {number[]} queryVector
 * @param {number} [k=3]
 */
export function retrieveTopK(vectorStore, queryVector, k = 3) {
  const scored = vectorStore.map((item) => ({
    text: item.text,
    score: cosineSimilarity(queryVector, item.vector),
    ...(item.fileName != null && item.fileName !== ""
      ? { fileName: item.fileName }
      : {}),
  }));

  const topChunks = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  const context = topChunks.map((c) => c.text).join("\n\n");

  return { scored, topChunks, context };
}
