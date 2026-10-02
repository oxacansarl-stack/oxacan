/**
 * The AI layer is provider-agnostic on purpose: the backend used while building it is not the one
 * production will run. These tests pin the two things that must hold whatever the provider is —
 * production stays off unless it is deliberately configured, and a provider's answer is never
 * trusted blindly — without any network call.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { apiClient, tokenFor, USER_A } from './setup';
import { createEmbeddingProvider } from '../src/modules/ai/ai.module';
import { OpenAiCompatibleEmbeddingProvider } from '../src/modules/ai/openai-compatible.provider';
import { cosine, normalise, MAX_EMBEDDING_BATCH } from '../src/modules/ai/embedding.provider';

const admin = apiClient(tokenFor(USER_A.authId));

/** A ConfigService stand-in: only `get` is used by the factory. */
const config = (vars: Record<string, string>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

const provider = (over: Partial<Record<string, string>> = {}) =>
  new OpenAiCompatibleEmbeddingProvider({
    name: 'test', baseUrl: 'https://example.invalid/v1', apiKey: 'k', model: 'm', sendInputType: true, ...over,
  } as ConstructorParameters<typeof OpenAiCompatibleEmbeddingProvider>[0]);

/** Replaces global fetch for one call and gives back what the provider sent. */
async function withFetch<T>(reply: Partial<Response> | (() => never), fn: () => Promise<T>) {
  const original = globalThis.fetch;
  let sent: any = null;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    if (typeof reply === 'function') reply();
    return reply as Response;
  }) as typeof fetch;
  try {
    return { result: await fn().catch((e) => e), sent };
  } finally {
    globalThis.fetch = original;
  }
}

const jsonReply = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as Partial<Response>;

describe('AI provider selection', () => {
  it('stays off unless a provider is deliberately configured', () => {
    expect(createEmbeddingProvider(config({})).enabled).toBe(false);
    expect(createEmbeddingProvider(config({ AI_PROVIDER: 'none' })).enabled).toBe(false);
    // An unknown or half-configured provider degrades to off rather than failing at boot.
    expect(createEmbeddingProvider(config({ AI_PROVIDER: 'wat', AI_API_KEY: 'k' })).enabled).toBe(false);
    expect(createEmbeddingProvider(config({ AI_PROVIDER: 'nvidia' })).enabled).toBe(false);
  });

  it('turns on only with a key, and lets a deployment override the backend entirely', () => {
    const on = createEmbeddingProvider(config({ AI_PROVIDER: 'nvidia', AI_API_KEY: 'k' }));
    expect(on).toMatchObject({ enabled: true, name: 'nvidia' });

    // Swapping provider is configuration, not code: this is how production can run elsewhere.
    const elsewhere = createEmbeddingProvider(
      config({ AI_PROVIDER: 'self_hosted', AI_API_KEY: 'k', AI_BASE_URL: 'https://ai.internal/v1', AI_EMBEDDING_MODEL: 'bge-m3' }),
    );
    expect(elsewhere).toMatchObject({ enabled: true, name: 'self_hosted' });
  });

  it('refuses to embed when nothing is configured', async () => {
    await expect(createEmbeddingProvider(config({})).embed(['x'], 'query')).rejects.toThrow(/No embedding provider is configured/i);
  });
});

describe('Embedding provider over the OpenAI shape', () => {
  it('returns vectors in the order asked for, whatever order they come back in', async () => {
    const { result, sent } = await withFetch(
      jsonReply({ data: [{ index: 1, embedding: [0, 3] }, { index: 0, embedding: [4, 0] }] }),
      () => provider().embed(['first', 'second'], 'query'),
    );
    expect(sent).toMatchObject({ model: 'm', input: ['first', 'second'], input_type: 'query' });
    // Reordered by index, and normalised so similarity is a plain dot product.
    expect(result).toEqual([[1, 0], [0, 1]]);
    expect(cosine(result[0], result[1])).toBe(0);
  });

  it('omits the query/passage hint for backends that do not take one', async () => {
    const { sent } = await withFetch(
      jsonReply({ data: [{ index: 0, embedding: [1, 0] }] }),
      () => provider({ sendInputType: false as unknown as string }).embed(['x'], 'passage'),
    );
    expect(sent).not.toHaveProperty('input_type');
  });

  it('reports a refusing, unreachable or nonsensical provider as unavailable, not as a crash', async () => {
    const refused = await withFetch(jsonReply({ detail: 'nope' }, false, 429), () => provider().embed(['x'], 'query'));
    expect(refused.result).toMatchObject({ code: 'AI_UNAVAILABLE', statusCode: 503 });

    const down = await withFetch(() => { throw new Error('socket hang up'); }, () => provider().embed(['x'], 'query'));
    expect(down.result).toMatchObject({ code: 'AI_UNAVAILABLE', statusCode: 503 });

    // Fewer vectors than texts would silently misalign every suggestion.
    const short = await withFetch(jsonReply({ data: [{ index: 0, embedding: [1, 0] }] }), () => provider().embed(['a', 'b'], 'query'));
    expect(short.result).toMatchObject({ code: 'AI_UNAVAILABLE' });
  });

  it('caps what one call may ask for', async () => {
    const many = Array.from({ length: MAX_EMBEDDING_BATCH + 1 }, (_, i) => `t${i}`);
    await expect(provider().embed(many, 'query')).rejects.toMatchObject({ code: 'AI_BATCH_TOO_LARGE' });
    await expect(provider().embed([], 'query')).resolves.toEqual([]);
  });

  it('normalise leaves a zero vector alone instead of producing NaN', () => {
    expect(normalise([0, 0])).toEqual([0, 0]);
    expect(cosine(normalise([3, 4]), normalise([3, 4]))).toBeCloseTo(1, 9);
  });
});

describe('Match suggestions endpoint', () => {
  it('answers that it is off, rather than failing, when no provider is configured', async () => {
    const res = await admin.get('/catalogue/unmatched/suggestions');
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ enabled: false, provider: null, suggestions: [] });
  });

  it('is office-only, like the rest of the catalogue', async () => {
    const worker = apiClient(tokenFor('aaaaaaaa-0000-4000-8000-000000000033'));
    expect((await worker.get('/catalogue/unmatched/suggestions')).status).toBe(403);
    expect((await apiClient().get('/catalogue/unmatched/suggestions')).status).toBe(401);
  });
});
