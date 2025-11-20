import { registerOpenAIProviderPlugin } from './openai/index.js';
import { registerAnthropicProviderPlugin } from './anthropic/index.js';
import { registerDeepSeekProviderPlugin } from './deepseek/index.js';
import { registerXaiProviderPlugin } from './xai/index.js';
import { registerGoogleProviderPlugin } from './google/index.js';

let defaultsRegistered = false;

export function registerDefaultProviderPlugins(): void {
  if (defaultsRegistered) {
    return;
  }

  registerOpenAIProviderPlugin();
  registerAnthropicProviderPlugin();
  registerDeepSeekProviderPlugin();
  registerXaiProviderPlugin();
  registerGoogleProviderPlugin();

  defaultsRegistered = true;
}
