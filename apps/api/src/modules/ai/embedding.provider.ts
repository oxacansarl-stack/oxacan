/**
 * The one thing OXACAN asks of an AI provider: turn trade text into vectors it can compare.
 *
 * Nothing above this interface knows which provider is configured. The provider is a deployment
 * choice (`AI_PROVIDER`), not a product decision: the one used while building is not the one
 * production will run, so no vendor name, model id or response shape may leak past this file.
 */
export interface EmbeddingProvider {
  /** Identifies the configured backend in logs and in the suggestion payload. */
  readonly name: string;

  /** False when nothing is configured: callers must degrade instead of failing. */
  readonly enabled: boolean;

  /**
   * Embeds texts in order. `kind` separates the things being searched for ('query') from the
   * things being searched through ('passage'); providers that ignore the distinction may drop it.
   * Returns one vector per input, or throws — never a partial result.
   */
  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
}

export type EmbeddingKind = 'query' | 'passage';

/** The provider token to inject; Nest resolves it to whatever `AI_PROVIDER` selected. */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** What a provider is allowed to be asked for in one call, so one import cannot run up a bill. */
export const MAX_EMBEDDING_BATCH = 96;

/** Cosine similarity of two vectors of equal length; both are expected to be normalised. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Scales a vector to unit length so similarity is a plain dot product. */
export function normalise(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum);
  return n === 0 ? v : v.map((x) => x / n);
}
