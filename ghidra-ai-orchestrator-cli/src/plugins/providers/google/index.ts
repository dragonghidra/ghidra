import { GoogleGenAIProvider } from '../../../providers/googleProvider.js';
import { registerProvider } from '../../../providers/providerFactory.js';

let registered = false;

export function registerGoogleProviderPlugin(): void {
  if (registered) {
    return;
  }

  registerProvider('google', (config) => {
    const options = {
      apiKey: requireEnv('GEMINI_API_KEY'),
      model: config.model,
      providerId: 'google',
      ...(typeof config.temperature === 'number' ? { temperature: config.temperature } : {}),
      ...(typeof config.maxTokens === 'number' ? { maxOutputTokens: config.maxTokens } : {}),
    };
    return new GoogleGenAIProvider(options);
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
