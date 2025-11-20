import { OpenAIChatCompletionsProvider } from '../../../providers/openaiChatCompletionsProvider.js';
import { registerProvider } from '../../../providers/providerFactory.js';

let registered = false;

export function registerXaiProviderPlugin(): void {
  if (registered) {
    return;
  }

  registerProvider('xai', (config) => {
    return new OpenAIChatCompletionsProvider({
      apiKey: requireEnv('XAI_API_KEY'),
      model: config.model,
      baseURL: 'https://api.x.ai/v1',
      providerId: 'xai',
    });
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
