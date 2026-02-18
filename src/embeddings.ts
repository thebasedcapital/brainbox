/**
 * BrainBox Embedding Module
 *
 * Lazy-loaded embedding pipeline using @huggingface/transformers.
 * Falls back gracefully if the package isn't installed.
 *
 * Model: Xenova/all-MiniLM-L6-v2 (384 dimensions, ~23MB ONNX)
 * Latency: ~50ms per embed after model load, ~2s cold start
 */

import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Embedding dimension for all-MiniLM-L6-v2
export const EMBEDDING_DIM = 384;

// Model ID — small, fast, good quality
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// Singleton pipeline — lazy loaded
let pipeline: any = null;
let pipelinePromise: Promise<any> | null = null;
let available: boolean | null = null;

/**
 * Check if @huggingface/transformers is installed.
 * Walks up from this file to find node_modules.
 */
export function isEmbeddingAvailable(): boolean {
  if (available !== null) return available;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "node_modules", "@huggingface", "transformers"))) {
      available = true;
      return true;
    }
    dir = dirname(dir);
  }
  available = false;
  return false;
}

/**
 * Get the embedding pipeline (lazy singleton).
 * Returns null if @huggingface/transformers is not installed.
 */
async function getPipeline(): Promise<any> {
  if (pipeline) return pipeline;
  if (pipelinePromise) return pipelinePromise;

  if (!isEmbeddingAvailable()) return null;

  pipelinePromise = (async () => {
    try {
      const { pipeline: createPipeline } = await import("@huggingface/transformers");
      pipeline = await createPipeline("feature-extraction", MODEL_ID, {
        dtype: "fp32",
      });
      return pipeline;
    } catch (err) {
      available = false;
      pipeline = null;
      pipelinePromise = null;
      return null;
    }
  })();

  return pipelinePromise;
}

/**
 * Embed a text string into a 384-dim Float32Array.
 * Returns null if embeddings are unavailable.
 */
export async function embedText(text: string): Promise<Float32Array | null> {
  const pipe = await getPipeline();
  if (!pipe) return null;

  const output = await pipe(text, { pooling: "mean", normalize: true });
  // output.data is a Float32Array of shape [1, 384] — flatten
  return new Float32Array(output.data);
}

/**
 * Cosine similarity between two embedding vectors.
 * Assumes normalized vectors (dot product = cosine similarity).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  // Clamp to [-1, 1] for numerical stability
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Serialize a Float32Array to a Buffer for SQLite BLOB storage.
 */
export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/**
 * Deserialize a Buffer from SQLite BLOB back to Float32Array.
 */
export function deserializeEmbedding(blob: Buffer): Float32Array {
  const ab = new ArrayBuffer(blob.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < blob.length; i++) {
    view[i] = blob[i];
  }
  return new Float32Array(ab);
}
