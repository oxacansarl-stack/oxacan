import { Injectable } from '@nestjs/common';
import { EmbeddingKind, EmbeddingProvider } from './embedding.provider';

/**
 * The default, and what production runs until a provider is chosen and contracted. It makes the
 * "no AI configured" case an ordinary state rather than a missing dependency: every caller already
 * has to handle `enabled === false`, so nothing reaches for the network by accident.
 */
@Injectable()
export class DisabledEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'disabled';
  readonly enabled = false;

  async embed(_texts: string[], _kind: EmbeddingKind): Promise<number[][]> {
    throw new Error('No embedding provider is configured (AI_PROVIDER is unset).');
  }
}
