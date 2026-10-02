import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding.provider';
import { DisabledEmbeddingProvider } from './disabled-embedding.provider';
import { OpenAiCompatibleEmbeddingProvider } from './openai-compatible.provider';

/**
 * Backends that speak the OpenAI `/v1` shape. Adding one is a row here plus its three variables;
 * no caller changes, because nothing above `EmbeddingProvider` names a vendor.
 */
const OPENAI_COMPATIBLE: Record<string, { baseUrl: string; model: string; sendInputType: boolean }> = {
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3-embed-1b',
    sendInputType: true,
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-large',
    sendInputType: false,
  },
  // A model run on infrastructure we choose — the likely answer if the data may not leave Switzerland.
  self_hosted: {
    baseUrl: '',
    model: '',
    sendInputType: false,
  },
};

/**
 * Chooses the embedding backend from configuration, defaulting to none.
 *
 * `AI_PROVIDER` is unset in production on purpose: the provider in use while the feature is built
 * is a development convenience, and production stays off until one is chosen, contracted and
 * checked against nLPD/RGPD (PRD §24.2). Nothing calls out when it is unset.
 */
export function createEmbeddingProvider(config: ConfigService): EmbeddingProvider {
  const logger = new Logger('AiModule');
  const choice = config.get<string>('AI_PROVIDER')?.trim().toLowerCase();
  if (!choice || choice === 'none' || choice === 'disabled') return new DisabledEmbeddingProvider();

  const preset = OPENAI_COMPATIBLE[choice];
  if (!preset) {
    logger.warn(`AI_PROVIDER='${choice}' is not a known provider — AI features stay off.`);
    return new DisabledEmbeddingProvider();
  }

  const apiKey = config.get<string>('AI_API_KEY')?.trim();
  const baseUrl = config.get<string>('AI_BASE_URL')?.trim().replace(/\/+$/, '') || preset.baseUrl;
  const model = config.get<string>('AI_EMBEDDING_MODEL')?.trim() || preset.model;
  if (!apiKey || !baseUrl || !model) {
    logger.warn(`AI_PROVIDER='${choice}' is set but AI_API_KEY / AI_BASE_URL / AI_EMBEDDING_MODEL are incomplete — AI features stay off.`);
    return new DisabledEmbeddingProvider();
  }

  logger.log(`Embeddings: ${choice} (${model})`);
  return new OpenAiCompatibleEmbeddingProvider({
    name: choice,
    baseUrl,
    apiKey,
    model,
    sendInputType: preset.sendInputType,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: createEmbeddingProvider,
    },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class AiModule {}
