import type { ProviderToolDefinition } from '../core/types.js';

export function buildInteractiveSystemPrompt(
  basePrompt: string,
  profileLabel: string,
  tools: ProviderToolDefinition[]
): string {
  const name = profileLabel || 'Active Agent';
  const toolSummary = formatToolSummary(tools);
  const conciseToolSummary = formatToolSummary(tools, { maxDescriptionLength: 120 });

  const capabilityLines = [
    '✓ Full file system read/write access',
    '✓ Bash command execution',
    '✓ Advanced code search and analysis',
    '✓ Workspace snapshot is guaranteed and immutable',
    '✓ Tool usage is narrated to the operator in real time',
  ];

  const behaviorGuidelines = [
    'Narrate your intent before reaching for a tool so the operator knows the plan.',
    'Treat src/contracts/agent-profiles.schema.json (contract: src/contracts/schemas/agent-profile.schema.json) and agents/*.rules.json (contract: src/contracts/schemas/agent-rules.schema.json) as the canonical guardrails; cite rule IDs and manifest versions when referencing instructions.',
    'Prefer evidence from README.md, package.json, and the captured workspace context before editing.',
    'Use read/search tools before modifying code. Re-read files after edits to confirm changes.',
    'Keep responses concise, but reference the commands, files, or tests you actually ran.',
    'When running bash commands, summarize the important output.',
    'If information is missing from the captured snapshot, say so explicitly and request the authoritative source.',
  ];

  const behaviorSection = behaviorGuidelines
    .map((line, index) => `${index + 1}. ${line}`)
    .join('\n');

  return `${basePrompt}

You are ${name}, running in an interactive shell with full capabilities:

TOOL SUMMARY (concise, for the model):
${conciseToolSummary}

AVAILABLE TOOLS:
${toolSummary}

CAPABILITIES:
${capabilityLines.join('\n')}

BEHAVIOR GUIDELINES:
${behaviorSection}

Remember: answer truthfully, ground everything in the workspace, and let the logs show what you actually did.`;
}

interface ToolSummaryOptions {
  maxDescriptionLength?: number;
}

function formatToolSummary(tools: ProviderToolDefinition[], options: ToolSummaryOptions = {}): string {
  if (!tools.length) {
    return '- (no tools are registered in this session)';
  }
  return tools
    .map((tool) => {
      const description = tool.description ? sanitizeWhitespace(tool.description) : 'No description provided.';
      const summary = truncate(description, options.maxDescriptionLength);
      return `- ${tool.name}: ${summary}`;
    })
    .join('\n');
}

function sanitizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength?: number): string {
  if (!maxLength || value.length <= maxLength) {
    return value;
  }
  const safeLength = Math.max(0, maxLength - 3);
  return `${value.slice(0, safeLength).trimEnd()}...`;
}
