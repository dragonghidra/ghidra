/**
 * Enhanced error utilities for better debugging and error reporting
 */

import type { ErrorContext } from '../core/errors.js';

export interface ErrorDetails {
  message: string;
  code?: string;
  context?: ErrorContext;
  stack?: string;
  timestamp: string;
}

// Centralized configuration for retryable error patterns
const RETRYABLE_ERROR_PATTERNS = [
  'timeout',
  'network',
  'rate limit',
  'too many requests',
  'service unavailable',
  'gateway timeout',
  'bad gateway',
  'internal server error',
] as const;

export function createErrorDetails(
  error: unknown,
  context?: ErrorContext,
  code?: string
): ErrorDetails {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  
  return {
    message,
    code,
    context,
    stack,
    timestamp: new Date().toISOString(),
  };
}

export function formatErrorForLogging(error: unknown, context?: ErrorContext): string {
  const details = createErrorDetails(error, context);
  
  const parts = [
    `[${details.timestamp}]`,
    details.code ? `[${details.code}]` : '',
    details.message,
  ];
  
  if (details.context && Object.keys(details.context).length > 0) {
    parts.push(`Context: ${JSON.stringify(details.context)}`);
  }
  
  if (details.stack) {
    parts.push(`Stack: ${details.stack}`);
  }
  
  return parts.filter(Boolean).join(' ');
}

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  
  const message = error.message.toLowerCase();
  return RETRYABLE_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      // Don't retry if we've exhausted attempts or error is not retryable
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }
      
      // Exponential backoff
      const backoffDelay = delayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
  
  // This should never be reached due to the throw above, but TypeScript needs it
  throw new Error('Retry logic failed unexpectedly');
}