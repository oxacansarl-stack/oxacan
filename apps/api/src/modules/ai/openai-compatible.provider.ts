import { Logger } from '@nestjs/common';
import { OxacanError } from '@oxacan/shared-types';
import {
  EmbeddingKind,
  EmbeddingProvider,
  MAX_EMBEDDING_BATCH,
  normalise,
} from './embedding.provider';

const TIMEOUT_MS = 30_000;

export interface OpenAiCompatibleSettings {
  /** Shown in logs and in suggestion payloads — the deployment's name for this backend. */
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Some backends want the query/passage distinction as an `input_type` field; most ignore it. */
  sendInputType: boolean;
}

/**
 * Embeddings over the OpenAI `/v1/embeddings` shape, which NVIDIA NIM, vLLM, Together, Mistral,
 * Azure OpenAI and a self-hosted model all speak. Swapping provider is a change of base URL, key
 * and model name, so the provider used while building is not a commitment for production.
 *
 * Only the text handed in is sent. Deciding what text that may be (never client names or
 * addresses, under nLPD/RGPD) belongs to the caller, which is why this class takes strings and
 * knows nothing about the records they came from.
 */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OpenAiCompatibleEmbeddingProvider.name);
  readonly enabled = true;
  readonly name: string;

  constructor(private readonly settings: OpenAiCompatibleSettings) {
    this.name = settings.name;
  }

  async embed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length > MAX_EMBEDDING_BATCH) {
      throw new OxacanError('AI_BATCH_TOO_LARGE', `At most ${MAX_EMBEDDING_BATCH} texts per call.`, 400);
    }

    const res = await fetch(`${this.settings.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        input: texts,
        encoding_format: 'float',
        ...(this.settings.sendInputType ? { input_type: kind } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: Error) => {
      // A provider that is slow or down must read as "no suggestion", never as a 500 on an import.
      throw new OxacanError('AI_UNAVAILABLE', `The ${this.name} service did not answer: ${err.message}`, 503);
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      this.logger.warn(`${this.name} embeddings returned ${res.status}: ${detail}`);
      throw new OxacanError('AI_UNAVAILABLE', `The ${this.name} service returned ${res.status}.`, 503);
    }

    const body = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    if (!Array.isArray(body.data) || body.data.length !== texts.length) {
      throw new OxacanError('AI_UNAVAILABLE', `The ${this.name} service returned an unusable answer.`, 503);
    }
    // The order of `data` is not guaranteed; `index` is what ties a vector to its input.
    const ordered = [...body.data].sort((a, b) => a.index - b.index);
    return ordered.map((d) => normalise(d.embedding));
  }
}
