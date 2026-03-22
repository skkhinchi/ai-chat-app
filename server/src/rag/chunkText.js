/**
 * Split plain text into chunks of roughly `chunkSize` characters.
 * Tries to break at newlines or spaces when near the limit.
 * @param {string} text
 * @param {number} [chunkSize=500]
 * @returns {string[]}
 */
export function chunkText(text, chunkSize = 500) {
  const t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return [];

  const chunks = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + chunkSize, t.length);
    if (end < t.length) {
      const slice = t.slice(i, end);
      const nl = slice.lastIndexOf("\n");
      const sp = slice.lastIndexOf(" ");
      const breakAt = Math.max(nl, sp);
      if (breakAt > chunkSize * 0.25) {
        end = i + breakAt + 1;
      }
    }
    const piece = t.slice(i, end).trim();
    if (piece) chunks.push(piece);
    i = end;
  }
  return chunks;
}
