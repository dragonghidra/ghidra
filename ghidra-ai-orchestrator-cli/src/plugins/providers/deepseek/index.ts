import { OpenAIChatCompletionsProvider } from '../../../providers/openaiChatCompletionsProvider.js';
import { registerProvider } from '../../../providers/providerFactory.js';

let registered = false;

export function registerDeepSeekProviderPlugin(): void {
  if (registered) {
    return;
  }

  registerProvider('deepseek', (config) => {
    return new OpenAIChatCompletionsProvider({
      apiKey: requireEnv('DEEPSEEK_API_KEY'),
      model: config.model,
      baseURL: 'https://api.deepseek.com',
      providerId: 'deepseek',
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
