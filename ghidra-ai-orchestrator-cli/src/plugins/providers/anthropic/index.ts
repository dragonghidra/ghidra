import { AnthropicMessagesProvider } from '../../../providers/anthropicProvider.js';
import { registerProvider } from '../../../providers/providerFactory.js';

let registered = false;

export function registerAnthropicProviderPlugin(): void {
  if (registered) {
    return;
  }

  registerProvider('anthropic', (config) => {
    const options = {
      apiKey: requireEnv('ANTHROPIC_API_KEY'),
      model: config.model,
      ...(typeof config.temperature === 'number' ? { temperature: config.temperature } : {}),
      ...(typeof config.maxTokens === 'number' ? { maxTokens: config.maxTokens } : {}),
    };
    return new AnthropicMessagesProvider(options);
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
