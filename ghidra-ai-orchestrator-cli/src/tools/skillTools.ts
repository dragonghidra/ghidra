import type { ToolDefinition } from '../core/toolRuntime.js';
import { SkillRepository } from '../skills/skillRepository.js';
import type { SkillRecord, SkillSummary } from '../skills/types.js';

interface SkillToolOptions {
  repository: SkillRepository;
}

type SectionFilter = 'metadata' | 'body' | 'references' | 'scripts' | 'assets';

export function createSkillTools(options: SkillToolOptions): ToolDefinition[] {
  const repository = options.repository;

  return [
    {
      name: 'ListSkills',
      description:
        'List Claude Code compatible skills discovered in the workspace, ~/.claude/skills, and ~/.apt/skills directories.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional substring to filter skills by name, namespace, or description.',
          },
          refresh_cache: {
            type: 'boolean',
            description: 'When true, force a re-scan of skill directories before listing.',
          },
        },
      },
      handler: async (args) => {
        if (args && typeof args['refresh_cache'] === 'boolean' && args['refresh_cache']) {
          repository.refresh();
        }
        const query = typeof args?.['query'] === 'string' ? args['query'].trim().toLowerCase() : '';
        const skills = repository
          .listSkills()
          .filter((skill) => skillMatches(skill, query))
          .sort((a, b) => a.name.localeCompare(b.name));

        if (!skills.length) {
          return query
            ? `No skills matched "${query}". Add SKILL.md files under skills/ or ~/.claude/skills and rerun the command.`
            : 'No skills found. Create a skills/ directory with SKILL.md files or import Claude Code plugin skills.';
        }

        const lines: string[] = [];
        lines.push(`Discovered ${skills.length} skill${skills.length === 1 ? '' : 's'}:`);
        for (const skill of skills) {
          lines.push(formatSkillSummary(skill));
        }
        return lines.join('\n');
      },
    },
    {
      name: 'Skill',
      description:
        'Load a Claude Skill package by name, slug, or path. Returns metadata, documentation body, and optional resource listings.',
      parameters: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            description:
              'Skill name, slug (kebab-case), namespace-qualified id (e.g. plugin-dev:skill-development), or path to SKILL.md.',
          },
          sections: {
            type: 'array',
            description: 'Optional list of sections to include. Defaults to all sections.',
            items: {
              type: 'string',
              enum: ['metadata', 'body', 'references', 'scripts', 'assets'],
            },
          },
          refresh_cache: {
            type: 'boolean',
            description: 'When true, force a re-scan of skills before loading.',
          },
        },
        required: ['skill'],
      },
      handler: async (args) => {
        if (args && typeof args['refresh_cache'] === 'boolean' && args['refresh_cache']) {
          repository.refresh();
        }
        const identifier = String(args?.['skill'] ?? '').trim();
        if (!identifier) {
          return 'Skill identifier is required.';
        }

        const skill = repository.getSkill(identifier);
        if (!skill) {
          return `Skill "${identifier}" not found. Run ListSkills to inspect available skills.`;
        }

        const sections = normalizeSections(args?.['sections']);
        const output = formatSkillDetail(skill, sections);
        return output || `Skill "${skill.name}" has no content.`;
      },
    },
  ];
}

function skillMatches(skill: SkillSummary, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    skill.id,
    skill.slug,
    skill.name,
    skill.description,
    skill.namespace ?? '',
    skill.relativeLocation ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function normalizeSections(value: unknown): Set<SectionFilter> {
  if (!Array.isArray(value) || !value.length) {
    return new Set(['metadata', 'body', 'references', 'scripts', 'assets']);
  }
  const normalized = new Set<SectionFilter>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const key = entry.trim().toLowerCase();
    if (key === 'metadata' || key === 'body' || key === 'references' || key === 'scripts' || key === 'assets') {
      normalized.add(key);
    }
  }
  if (!normalized.size) {
    normalized.add('metadata');
    normalized.add('body');
  }
  return normalized;
}

function formatSkillSummary(skill: SkillSummary): string {
  const namespace = skill.namespace ? `${skill.namespace}:` : '';
  const label = `${namespace}${skill.slug}`;
  const location = skill.relativeLocation ?? skill.location;
  const resourceStatus = [
    `Body ${skill.hasBody ? '✅' : '—'}`,
    `References ${skill.hasReferences ? '✅' : '—'}`,
    `Scripts ${skill.hasScripts ? '✅' : '—'}`,
    `Assets ${skill.hasAssets ? '✅' : '—'}`,
  ].join(' | ');

  const lines = [
    `- ${label} — ${skill.description}`,
    `  Source: ${skill.sourceLabel} • Path: ${location}`,
    `  ${resourceStatus}`,
  ];
  return lines.join('\n');
}

function formatSkillDetail(skill: SkillRecord, sections: Set<SectionFilter>): string {
  const lines: string[] = [];
  lines.push(`# Skill: ${skill.name}`);
  if (skill.version) {
    lines.push(`Version: ${skill.version}`);
  }
  lines.push(`ID: ${skill.id}`);
  lines.push(`Location: ${skill.relativeLocation ?? skill.location}`);
  lines.push('');

  if (sections.has('metadata')) {
    lines.push('## Metadata');
    lines.push(`- Description: ${skill.description}`);
    lines.push(`- Source: ${skill.sourceLabel}`);
    lines.push(`- Namespace: ${skill.namespace ?? 'n/a'}`);
    if (Object.keys(skill.frontMatter).length) {
      for (const [key, value] of Object.entries(skill.frontMatter)) {
        lines.push(`- ${key}: ${value}`);
      }
    }
    lines.push('');
  }

  if (sections.has('body') && skill.body) {
    lines.push('## Skill Body');
    lines.push(skill.body.trim());
    lines.push('');
  }

  if (sections.has('references')) {
    lines.push('## References');
    if (skill.references.length) {
      for (const ref of skill.references) {
        lines.push(`- ${ref.path} (${formatBytes(ref.bytes)})`);
      }
    } else {
      lines.push('- None');
    }
    lines.push('');
  }

  if (sections.has('scripts')) {
    lines.push('## Scripts');
    if (skill.scripts.length) {
      for (const script of skill.scripts) {
        lines.push(`- ${script.path} (${formatBytes(script.bytes)})`);
      }
    } else {
      lines.push('- None');
    }
    lines.push('');
  }

  if (sections.has('assets')) {
    lines.push('## Assets');
    if (skill.assets.length) {
      for (const asset of skill.assets) {
        lines.push(`- ${asset.path} (${formatBytes(asset.bytes)})`);
      }
    } else {
      lines.push('- None');
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
