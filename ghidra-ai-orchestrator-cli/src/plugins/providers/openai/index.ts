import { OpenAIResponsesProvider } from '../../../providers/openaiResponsesProvider.js';
import { registerProvider } from '../../../providers/providerFactory.js';
import type { ProviderId } from '../../../core/types.js';

let registered = false;

export function registerOpenAIProviderPlugin(providerId: ProviderId = 'openai'): void {
  if (registered) {
    return;
  }

  registerProvider(providerId, (config) => {
    const options = {
      apiKey: requireEnv('OPENAI_API_KEY'),
      model: config.model,
      providerId,
      ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
      ...(config.textVerbosity ? { textVerbosity: config.textVerbosity } : {}),
    };
    return new OpenAIResponsesProvider(options);
  });

  registered = true;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}
