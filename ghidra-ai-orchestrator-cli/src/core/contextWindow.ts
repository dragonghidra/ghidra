const MODEL_CONTEXT_WINDOWS: Array<{ pattern: RegExp; tokens: number }> = [
  { pattern: /^gpt-5\.1-?codex$/i, tokens: 200_000 },
  { pattern: /^gpt-5(?:\.1|-?pro|-?mini|-?nano)/i, tokens: 200_000 },
  { pattern: /^claude-sonnet-4[-.]?5/i, tokens: 200_000 },
  { pattern: /^claude-opus-4[-.]?1/i, tokens: 200_000 },
  { pattern: /^claude-haiku-4[-.]?5/i, tokens: 200_000 },
  { pattern: /sonnet-4[-.]?5/i, tokens: 200_000 },
  { pattern: /opus-4[-.]?1/i, tokens: 200_000 },
  { pattern: /haiku-4[-.]?5/i, tokens: 200_000 },
  { pattern: /^deepseek[-_]?reasoner/i, tokens: 131_072 },
  { pattern: /^deepseek[-_]?chat/i, tokens: 64_000 },
];

/**
 * Returns the approximate context window (in tokens) for the provided model id.
 * Falls back to null when the model is unknown so callers can handle gracefully.
 */
export function getContextWindowTokens(model: string | null | undefined): number | null {
  if (!model) {
    return null;
  }
  const normalized = model.trim();
  if (!normalized) {
    return null;
  }

  for (const entry of MODEL_CONTEXT_WINDOWS) {
    if (entry.pattern.test(normalized)) {
      return entry.tokens;
    }
  }

  return null;
}
