export const DEFAULT_EMBED_URL = process.env.SOSHO_EMBED_URL || "http://127.0.0.1:8082/v1/embeddings";

export function encodeFloat32(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function decodeFloat32(blob: unknown): Float32Array | null {
  if (!blob) return null;
  if (blob instanceof Uint8Array) {
    const copy = new Uint8Array(blob.byteLength);
    copy.set(blob);
    return new Float32Array(copy.buffer);
  }
  return null;
}

export function cosineSim(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

export async function fetchEmbeddings(
  texts: string[],
  embedUrl: string = DEFAULT_EMBED_URL,
): Promise<Float32Array[] | null> {
  if (!embedUrl || texts.length === 0) return null;
  try {
    const res = await fetch(embedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "embeddinggemma", input: texts }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    if (!Array.isArray(json.data) || json.data.length !== texts.length) return null;
    const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((item) => {
      const arr = new Float32Array(item.embedding || []);
      let norm = 0;
      for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < arr.length; i++) arr[i] /= norm;
      return arr;
    });
  } catch {
    return null;
  }
}
