/** Local CPU embedding models. Fingerprints prevent stale-vector reuse across profiles. */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline as createPipeline, AutoModel, AutoTokenizer, Tensor, env } from "@huggingface/transformers";

export interface EmbeddingModel {
  id: string;
  dims: number;
  pooling: "mean" | "sentence_embedding";
  queryPrefix: string;
  documentPrefix: string;
  quantization: "fp32" | "q8" | "q4";
  license: string;
}

export const EMBEDDING_MODELS: Readonly<Record<string, EmbeddingModel>> = {
  minilm: { id: "Xenova/all-MiniLM-L6-v2", dims: 384, pooling: "mean", queryPrefix: "", documentPrefix: "", quantization: "fp32", license: "Apache-2.0" },
  "jina-code": { id: "jinaai/jina-embeddings-v2-base-code", dims: 768, pooling: "mean", queryPrefix: "", documentPrefix: "", quantization: "q8", license: "Apache-2.0" },
  gemma: { id: "onnx-community/embeddinggemma-300m-ONNX", dims: 768, pooling: "sentence_embedding", queryPrefix: "task: search result | query: ", documentPrefix: "title: none | text: ", quantization: "q8", license: "Gemma Terms of Use (https://ai.google.dev/gemma/terms)" },
  "gemma-q4": { id: "onnx-community/embeddinggemma-300m-ONNX", dims: 768, pooling: "sentence_embedding", queryPrefix: "task: search result | query: ", documentPrefix: "title: none | text: ", quantization: "q4", license: "Gemma Terms of Use (https://ai.google.dev/gemma/terms)" },
};
// Hook embeddings have a strict load + inference deadline and never download.
export const DEFAULT_EMBEDDING_MODEL = "jina-code";
const requested = process.env.BRAINBOX_EMBED_MODEL || DEFAULT_EMBEDDING_MODEL;
const selected = EMBEDDING_MODELS[requested] || Object.values(EMBEDDING_MODELS).find(m => m.id === requested);
if (!selected) throw new Error(`Unknown BRAINBOX_EMBED_MODEL ${requested}; choose ${Object.keys(EMBEDDING_MODELS).join(", ")}`);
export const EMBEDDING_MODEL = selected;
export const EMBEDDING_DIM = selected.dims;
export const EMBEDDING_MODEL_ID = `${selected.id}:${selected.quantization}:${selected.dims}:${selected.pooling}`;
export const HOOK_EMBEDDING_TIMEOUT_MS = 1200;
const defaultCacheDir = env.cacheDir;

export function embeddingCacheDir(): string {
  return process.env.BRAINBOX_MODEL_CACHE ? resolve(process.env.BRAINBOX_MODEL_CACHE) : defaultCacheDir;
}

/** Inspect the active profile's required artifacts without loading or downloading it. */
export function embeddingModelStatus(): { cached: boolean; cacheDir: string; bytes: number; missing: string[] } {
  const cacheDir = embeddingCacheDir();
  const suffix = EMBEDDING_MODEL.quantization === "fp32" ? "" : EMBEDDING_MODEL.quantization === "q8" ? "_quantized" : "_q4";
  const modelFile = `onnx/model${suffix}.onnx`;
  const files = ["config.json", "tokenizer.json", "tokenizer_config.json", modelFile];
  // EmbeddingGemma stores its weights outside the ONNX graph.
  if (EMBEDDING_MODEL.pooling === "sentence_embedding") files.push(`${modelFile}_data`);
  let bytes = 0;
  const missing: string[] = [];
  for (const file of files) {
    const cached = join(cacheDir, EMBEDDING_MODEL.id, file);
    const local = join(env.localModelPath, EMBEDDING_MODEL.id, file);
    const path = existsSync(cached) ? cached : local;
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size === 0) missing.push(file);
      else bytes += stat.size;
    } catch {
      missing.push(file);
    }
  }
  return { cached: missing.length === 0, cacheDir, bytes, missing };
}
type Embedder = (text: string) => Promise<Float32Array>;
let embedder: Embedder | null = null;
let pipelinePromise: Promise<Embedder | null> | null = null;
let available: boolean | null = null;
let hookDeadlineExceeded = false;

export function isEmbeddingAvailable(): boolean {
  if (process.env.BRAINBOX_EMBEDDINGS === "off") return false;
  if (available !== null) return available;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", "@huggingface", "transformers"))) return available = true;
  }
  return available = false;
}

async function getPipeline(): Promise<Embedder | null> {
  if (!isEmbeddingAvailable()) return null;
  const hook = process.env.BRAINBOX_HOOK === "1";
  env.allowRemoteModels = !hook;
  env.cacheDir = embeddingCacheDir();
  if (embedder) return embedder;
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    try {
      const options = {
        dtype: EMBEDDING_MODEL.quantization,
        device: "cpu" as const,
        local_files_only: hook,
        session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
      };
      if (EMBEDDING_MODEL.pooling === "sentence_embedding") {
        // EmbeddingGemma exports a trained sentence head, not just mean token states.
        const tokenizer = await AutoTokenizer.from_pretrained(EMBEDDING_MODEL.id, { local_files_only: hook });
        const model = await AutoModel.from_pretrained(EMBEDDING_MODEL.id, options);
        embedder = async text => {
          const inputs = await tokenizer(text, { padding: true, truncation: true });
          const outputs: unknown = await model(inputs);
          if (!outputs || typeof outputs !== "object" || !("sentence_embedding" in outputs) || !(outputs.sentence_embedding instanceof Tensor)) throw new Error("Model did not return sentence_embedding");
          const vector = Float32Array.from(outputs.sentence_embedding.data);
          let norm = 0;
          for (const value of vector) norm += value * value;
          norm = Math.sqrt(norm);
          if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] /= norm;
          return vector;
        };
      } else {
        const pipe = await createPipeline<"feature-extraction">("feature-extraction", EMBEDDING_MODEL.id, options);
        embedder = async text => {
          const output = await pipe(text, { pooling: "mean", normalize: true });
          return Float32Array.from(output.data);
        };
      }
      return embedder;
    } catch (error: unknown) {
      available = false;
      console.error(`[brainbox] embeddings unavailable (${EMBEDDING_MODEL_ID}): ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  })();
  return pipelinePromise;
}

export async function embedText(text: string, purpose: "query" | "document" = "query"): Promise<Float32Array | null> {
  const hook = process.env.BRAINBOX_HOOK === "1";
  if (hook && hookDeadlineExceeded) return null;
  const work = async (): Promise<Float32Array | null> => {
    const pipe = await getPipeline();
    if (!pipe) return null;
    const prefix = purpose === "query" ? EMBEDDING_MODEL.queryPrefix : EMBEDDING_MODEL.documentPrefix;
    const result = await pipe(prefix + text);
    if (result.length !== EMBEDDING_DIM) throw new Error(`Embedding dimension ${result.length} != ${EMBEDDING_DIM}`);
    return result;
  };
  if (!hook) return work();
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<null>(resolve => {
        timeout = setTimeout(() => {
          hookDeadlineExceeded = true;
          resolve(null);
        }, HOOK_EMBEDDING_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // A failed local model must not prevent lexical hook recall.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Downloads and warms the configured CPU profile, outside the hook path only. */
export async function pullEmbeddingModel(): Promise<{ bytes: number; elapsedMs: number }> {
  if (process.env.BRAINBOX_HOOK === "1") throw new Error("Model downloads are disabled in hooks; run 'brainbox models pull' manually.");
  const start = Date.now();
  const result = await embedText("BrainBox model prefetch", "document");
  if (!result) throw new Error(`Could not load ${EMBEDDING_MODEL_ID}`);
  return { bytes: embeddingModelStatus().bytes, elapsedMs: Date.now() - start };
}

/** Dot product for normalized vectors. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}
export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}
export function deserializeEmbedding(blob: Buffer): Float32Array {
  const result = new Float32Array(blob.length / Float32Array.BYTES_PER_ELEMENT);
  new Uint8Array(result.buffer).set(blob);
  return result;
}
