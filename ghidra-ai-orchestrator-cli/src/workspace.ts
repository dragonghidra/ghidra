import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildAgentRulebookPrompt } from './core/agentRulebook.js';
import type { ProfileName } from './core/agentProfiles.js';
import { pickBrandEnv } from './core/brand.js';

const PRIORITY_DOCS = ['README.md', 'package.json'];
const RULEBOOK_DIR = 'agents';
const RULEBOOK_SUFFIX = '.rules.json';
const RULEBOOK_SCHEMA_PATH = 'src/contracts/schemas/agent-rules.schema.json';
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist']);
const DEFAULT_TREE_DEPTH = 2;
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_DOC_LIMIT = 2000;

export interface WorkspaceCaptureOptions {
  treeDepth?: number;
  maxEntries?: number;
  docExcerptLimit?: number;
}

export function resolveWorkspaceCaptureOptions(env: NodeJS.ProcessEnv = process.env): WorkspaceCaptureOptions {
  return {
    treeDepth: parsePositiveInt(pickBrandEnv(env, 'CONTEXT_TREE_DEPTH') ?? undefined),
    maxEntries: parsePositiveInt(pickBrandEnv(env, 'CONTEXT_MAX_ENTRIES') ?? undefined),
    docExcerptLimit: parsePositiveInt(pickBrandEnv(env, 'CONTEXT_DOC_LIMIT') ?? undefined),
  };
}

export function buildWorkspaceContext(root: string, options: WorkspaceCaptureOptions = {}): string | null {
  const treeDepth = options.treeDepth ?? DEFAULT_TREE_DEPTH;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const docLimit = options.docExcerptLimit ?? DEFAULT_DOC_LIMIT;

  try {
    const treeLines = formatFileTree(root, treeDepth, maxEntries);
    const docSnippets = capturePriorityDocs(root, docLimit);
    const rulebooks = captureRulebookSections(root);

    const sections: string[] = [`cwd: ${root}`, 'files:', ...treeLines];
    if (docSnippets.length) {
      sections.push(docSnippets.join('\n\n'));
    }
    if (rulebooks.length) {
      sections.push(rulebooks.join('\n\n'));
    }

    return sections.filter((section) => section.trim().length > 0).join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Workspace context unavailable (${message}).`;
  }
}

function capturePriorityDocs(root: string, docLimit: number): string[] {
  return PRIORITY_DOCS.filter((name) => existsSync(join(root, name))).map((name) => {
    const content = readFileSync(join(root, name), 'utf8');
    const snippet = content.length > docLimit ? `${content.slice(0, docLimit)}\n...` : content;
    return `--- ${name} ---\n${snippet.trim()}`;
  });
}

function captureRulebookSections(root: string): string[] {
  const rulebookDir = join(root, RULEBOOK_DIR);
  if (!existsSync(rulebookDir)) {
    return [];
  }

  return readdirSync(rulebookDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(RULEBOOK_SUFFIX))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => buildRulebookBlock(root, entry.name))
    .filter((block): block is string => Boolean(block?.trim()));
}

function buildRulebookBlock(root: string, fileName: string): string | null {
  if (!fileName.endsWith(RULEBOOK_SUFFIX)) {
    return null;
  }
  const profile = fileName.slice(0, -RULEBOOK_SUFFIX.length) as ProfileName;
  try {
    const prompt = buildAgentRulebookPrompt(profile, { root });
    const header = `--- ${RULEBOOK_DIR}/${fileName} (contract: ${RULEBOOK_SCHEMA_PATH}) ---`;
    return `${header}\n${prompt.trim()}`;
  } catch (error) {
    const header = `--- ${RULEBOOK_DIR}/${fileName} ---`;
    const message = error instanceof Error ? error.message : String(error);
    return `${header}\nFailed to load rulebook: ${message}`;
  }
}

function formatFileTree(root: string, maxDepth: number, maxEntries: number): string[] {
  const lines: string[] = [];
  const walk = (dir: string, depth: number, prefix: string) => {
    if (depth > maxDepth || lines.length >= maxEntries) {
      return;
    }

    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !IGNORED_DIRS.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (lines.length >= maxEntries) {
        break;
      }

      const isDir = entry.isDirectory();
      lines.push(`${prefix}${entry.name}${isDir ? '/' : ''}`);
      if (isDir && depth < maxDepth) {
        walk(join(dir, entry.name), depth + 1, `${prefix}  `);
      }
    }
  };

  walk(root, 0, '');
  return lines;
}

function parsePositiveInt(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
