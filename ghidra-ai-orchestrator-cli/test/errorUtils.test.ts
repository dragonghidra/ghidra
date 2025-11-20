import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createErrorDetails,
  formatErrorForLogging,
  isRetryableError,
  withRetry,
} from '../src/utils/errorUtils.js';

test('createErrorDetails creates proper error details from Error', () => {
  const error = new Error('Test error');
  const context = { userId: '123', action: 'test' };
  const details = createErrorDetails(error, context, 'TEST_ERROR');
  
  assert.equal(details.message, 'Test error');
  assert.equal(details.code, 'TEST_ERROR');
  assert.deepEqual(details.context, context);
  assert.ok(details.stack);
  assert.ok(details.timestamp);
});

test('createErrorDetails handles non-Error objects', () => {
  const details = createErrorDetails('String error');
  
  assert.equal(details.message, 'String error');
  assert.equal(details.code, undefined);
  assert.equal(details.context, undefined);
  assert.equal(details.stack, undefined);
  assert.ok(details.timestamp);
});

test('formatErrorForLogging formats error with context', () => {
  const error = new Error('Test error');
  const context = { userId: '123', action: 'test' };
  const formatted = formatErrorForLogging(error, context);
  
  assert.ok(formatted.includes('Test error'));
  assert.ok(formatted.includes('Context: {"userId":"123","action":"test"}'));
  assert.ok(formatted.includes('Stack:'));
});

test('isRetryableError identifies retryable errors', () => {
  assert.equal(isRetryableError(new Error('Request timeout')), true);
  assert.equal(isRetryableError(new Error('Network error')), true);
  assert.equal(isRetryableError(new Error('Rate limit exceeded')), true);
  assert.equal(isRetryableError(new Error('Too many requests')), true);
  assert.equal(isRetryableError(new Error('Service unavailable')), true);
  assert.equal(isRetryableError(new Error('Regular error')), false);
  assert.equal(isRetryableError('String error'), false);
});

test('withRetry retries on retryable errors', async () => {
  let attempts = 0;
  
  const operation = async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error('Rate limit exceeded');
    }
    return 'success';
  };
  
  const result = await withRetry(operation, 3, 10);
  
  assert.equal(result, 'success');
  assert.equal(attempts, 3);
});

test('withRetry fails after max retries', async () => {
  let attempts = 0;
  
  const operation = async () => {
    attempts++;
    throw new Error('Rate limit exceeded');
  };
  
  try {
    await withRetry(operation, 2, 10);
    assert.fail('Should have thrown');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(attempts, 3); // initial + 2 retries
  }
});

test('withRetry does not retry non-retryable errors', async () => {
  let attempts = 0;
  
  const operation = async () => {
    attempts++;
    throw new Error('Validation error');
  };
  
  try {
    await withRetry(operation, 3, 10);
    assert.fail('Should have thrown');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(attempts, 1); // no retries for non-retryable errors
  }
});