/** Max strings per OpenAI embeddings request (stay under limits). */
const BATCH_SIZE = 100;

/**
 * @typedef {{ text: string; vector: number[] }} EmbeddedChunk
 */

/**
 * Create embeddings for each text chunk using OpenAI.
 * @param {import("openai").default} openai
 * @param {string[]} chunks
 * @returns {Promise<EmbeddedChunk[]>}
 */
export async function generateEmbeddings(openai, chunks) {
  if (!chunks.length) return [];

  /** @type {EmbeddedChunk[]} */
  const results = [];

  for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + BATCH_SIZE);
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });

    const ordered = [...res.data].sort((a, b) => a.index - b.index);
    for (let j = 0; j < ordered.length; j++) {
      results.push({
        text: batch[j],
        vector: ordered[j].embedding,
      });
    }
  }

  return results;
}

/**
 * Single query embedding (same model/dimensions as chunk embeddings).
 * @param {import("openai").default} openai
 * @param {string} queryText
 * @returns {Promise<number[]>}
 */
export async function embedQuery(openai, queryText) {
  const t = String(queryText ?? "").trim();
  if (!t) {
    throw new Error("embedQuery: empty query");
  }
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: t.slice(0, 8000),
  });
  const emb = res.data[0]?.embedding;
  if (!emb) {
    throw new Error("embedQuery: no embedding returned");
  }
  return emb;
}
