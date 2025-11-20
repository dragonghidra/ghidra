import type { ProviderId } from '../types.js';
import {
  MissingSecretError,
  type SecretDefinition,
  getSecretDefinitionForProvider,
} from '../secretStore.js';

export type ApiKeyErrorType = 'missing' | 'invalid';

export interface ApiKeyErrorInfo {
  type: ApiKeyErrorType;
  provider: ProviderId | null;
  secret?: SecretDefinition | null;
  message?: string;
}

export function detectApiKeyError(error: unknown, provider?: ProviderId | null): ApiKeyErrorInfo | null {
  if (error instanceof MissingSecretError) {
    const primaryProvider = error.secret.providers[0] ?? null;
    return {
      type: 'missing',
      provider: provider ?? primaryProvider,
      secret: error.secret,
      message: error.message,
    };
  }

  if (isUnauthorizedError(error)) {
    const labelProvider = provider ?? extractProviderFromError(error);
    const secret = labelProvider ? getSecretDefinitionForProvider(labelProvider) : null;
    return {
      type: 'invalid',
      provider: labelProvider,
      secret,
      message: extractErrorMessage(error),
    };
  }

  return null;
}

function isUnauthorizedError(error: unknown): boolean {
  const status = extractStatus(error);
  if (status === 401 || status === 403) {
    return true;
  }

  const payload = extractStructuredError(error);
  if (payload) {
    const normalizedType = normalize(payload.type) || normalize(payload.code);
    if (normalizedType && containsAuthKeyword(normalizedType)) {
      return true;
    }
    if (payload.message && containsAuthKeyword(normalize(payload.message))) {
      return true;
    }
  }

  const message = normalize(extractErrorMessage(error));
  if (!message) {
    return false;
  }
  return containsAuthKeyword(message);
}

function extractStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const directStatus = (error as { status?: number }).status;
  if (typeof directStatus === 'number') {
    return directStatus;
  }

  const response = (error as { response?: { status?: number } }).response;
  if (response && typeof response.status === 'number') {
    return response.status;
  }

  return null;
}

function extractStructuredError(error: unknown): { type?: string; code?: string; message?: string } | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  if ('error' in error) {
    const candidate = (error as { error?: unknown }).error;
    if (candidate && typeof candidate === 'object') {
      return candidate as { type?: string; code?: string; message?: string };
    }
  }

  return null;
}

function extractProviderFromError(error: unknown): ProviderId | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const provider = (error as { provider?: ProviderId }).provider;
  if (typeof provider === 'string' && provider.trim()) {
    return provider.trim();
  }

  return null;
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message ?? '';
  }

  if (error && typeof error === 'object') {
    const payload = extractStructuredError(error);
    if (payload?.message) {
      return payload.message;
    }
    if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
  }

  return '';
}

function containsAuthKeyword(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return (
    value.includes('api key') ||
    value.includes('apikey') ||
    value.includes('api-key') ||
    value.includes('authentication') ||
    value.includes('unauthorized')
  );
}

function normalize(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.toLowerCase();
}
