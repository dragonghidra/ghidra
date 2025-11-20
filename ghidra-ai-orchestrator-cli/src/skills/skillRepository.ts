import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { globSync } from 'glob';
import type { SkillRecord, SkillRepositoryOptions, SkillResourceEntry, SkillSource, SkillSummary } from './types.js';
import { pickBrandEnv, resolveSkillSearchDirs } from '../core/brand.js';

const SKILL_FILE_NAME = 'SKILL.md';
const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/.next/**',
  '**/build/**',
  '**/coverage/**',
  '**/.cache/**',
];

interface SearchRoot {
  path: string;
  source: SkillSource;
  label: string;
  priority: number;
}

interface ParsedSkillFile {
  name: string;
  description: string;
  version?: string;
  frontMatter: Record<string, string>;
  body: string;
}

export class SkillRepository {
  private readonly workingDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly homeDir: string;
  private readonly extraPaths: string[];
  private loaded = false;
  private readonly records = new Map<string, SkillRecord>();
  private readonly aliasMap = new Map<string, string>();

  constructor(options: SkillRepositoryOptions) {
    this.workingDir = resolve(options.workingDir);
    this.env = { ...(options.env ?? process.env) };
    this.homeDir = resolve(options.homeDir ?? homedir());
    this.extraPaths = options.extraPaths?.map((dir) => resolve(dir)).filter(Boolean) ?? [];
  }

  listSkills(): SkillSummary[] {
    this.ensureLoaded();
    return Array.from(this.records.values()).map((record) => this.toSummary(record));
  }

  getSkill(identifier: string): SkillRecord | null {
    this.ensureLoaded();
    const key = identifier.trim().toLowerCase();
    if (!key) {
      return null;
    }

    if (this.records.has(key)) {
      return this.records.get(key)!;
    }

    const alias = this.aliasMap.get(key);
    if (alias && this.records.has(alias)) {
      return this.records.get(alias)!;
    }

    // Allow path-based lookups
    const resolved = isAbsolute(identifier) ? resolve(identifier) : resolve(this.workingDir, identifier);
    for (const record of this.records.values()) {
      if (record.filePath === resolved || record.location === resolved || record.relativeLocation === identifier) {
        return record;
      }
    }

    return null;
  }

  refresh(): void {
    this.loaded = false;
    this.records.clear();
    this.aliasMap.clear();
    this.ensureLoaded();
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }

    const roots = this.collectSearchRoots();
    const seenPaths = new Set<string>();

    for (const root of roots) {
      if (!existsSync(root.path)) {
        continue;
      }
      const stat = statSync(root.path);
      if (!stat.isDirectory()) {
        continue;
      }

      const matches = globSync(`**/${SKILL_FILE_NAME}`, {
        cwd: root.path,
        absolute: true,
        nocase: true,
        ignore: DEFAULT_IGNORES,
      });

      for (const file of matches) {
        const normalized = resolve(file);
        if (seenPaths.has(normalized)) {
          continue;
        }
        seenPaths.add(normalized);
        this.ingestSkillFile(normalized, root);
      }
    }

    this.loaded = true;
  }

  private collectSearchRoots(): SearchRoot[] {
    const roots: SearchRoot[] = [];
    let priority = 1000;
    const defaultDirs = resolveSkillSearchDirs(this.env);

    // Workspace-relative defaults
    for (const dir of defaultDirs) {
      roots.push({
        path: resolve(this.workingDir, dir),
        source: 'workspace',
        label: `workspace:${dir}`,
        priority: priority--,
      });
    }

    // Scan entire workspace for SKILL.md so we pick up nested plugin directories
    roots.push({
      path: this.workingDir,
      source: 'workspace',
      label: 'workspace',
      priority: priority--,
    });

    // Home directories (~/.claude/skills, ~/.apt/skills, legacy APT locations)
    for (const dir of defaultDirs) {
      roots.push({
        path: resolve(this.homeDir, dir),
        source: 'home',
        label: `home:${dir}`,
        priority: priority--,
      });
    }

    // Custom directories from env
    const envDirs = (pickBrandEnv(this.env, 'SKILLS_DIRS') ?? '')
      .split(process.platform === 'win32' ? ';' : ':')
      .map((value) => value.trim())
      .filter(Boolean);
    for (const entry of [...this.extraPaths, ...envDirs]) {
      roots.push({
        path: resolve(entry),
        source: 'custom',
        label: entry,
        priority: priority--,
      });
    }

    // Sort by precedence so earlier directories win on collisions
    roots.sort((a, b) => b.priority - a.priority);
    return roots;
  }

  private ingestSkillFile(filePath: string, root: SearchRoot): void {
    try {
      const parsed = this.parseSkillFile(filePath, root);
      if (!parsed) {
        return;
      }

      if (this.records.has(parsed.id)) {
        return;
      }

      this.records.set(parsed.id, parsed);
      for (const alias of parsed.aliases) {
        if (!this.aliasMap.has(alias)) {
          this.aliasMap.set(alias, parsed.id);
        }
      }
    } catch {
      // Ignore malformed skills
    }
  }

  private parseSkillFile(filePath: string, root: SearchRoot): SkillRecord | null {
    if (!existsSync(filePath)) {
      return null;
    }

    const directory = dirname(filePath);
    const content = readFileSync(filePath, 'utf8');
    const parsed = this.extractSkillContent(content);
    if (!parsed) {
      return null;
    }

    const relativePathFromWorkspace = this.safeRelative(this.workingDir, directory);
    const slug = toSlug(parsed.name || dirname(directory).split(sep).pop() || 'skill');
    const namespace = this.buildNamespace(root.path, directory);
    const id = namespace ? `${namespace}:${slug}` : slug;
    const resources = this.collectResourceDirectory(directory);

    const record: SkillRecord = {
      id,
      slug,
      name: parsed.name,
      description: parsed.description,
      version: parsed.version,
      namespace: namespace || undefined,
      source: root.source,
      sourceLabel: root.label,
      location: directory,
      relativeLocation: relativePathFromWorkspace ?? undefined,
      hasBody: Boolean(parsed.body.trim()),
      hasReferences: resources.references.length > 0,
      hasScripts: resources.scripts.length > 0,
      hasAssets: resources.assets.length > 0,
      body: parsed.body.trim(),
      frontMatter: parsed.frontMatter,
      references: resources.references,
      scripts: resources.scripts,
      assets: resources.assets,
      filePath,
      aliases: this.buildAliases({
        id,
        slug,
        name: parsed.name,
        namespace,
        relativeLocation: relativePathFromWorkspace ?? '',
        location: directory,
        sourceLabel: root.label,
      }),
    };

    return record;
  }

  private collectResourceDirectory(skillDir: string): {
    references: SkillResourceEntry[];
    scripts: SkillResourceEntry[];
    assets: SkillResourceEntry[];
  } {
    return {
      references: this.listFiles(join(skillDir, 'references')),
      scripts: this.listFiles(join(skillDir, 'scripts')),
      assets: this.listFiles(join(skillDir, 'assets')),
    };
  }

  private listFiles(dir: string): SkillResourceEntry[] {
    if (!existsSync(dir)) {
      return [];
    }
    const stat = statSync(dir);
    if (!stat.isDirectory()) {
      return [];
    }

    const entries: SkillResourceEntry[] = [];
    const visit = (current: string, prefix: string) => {
      for (const child of readdirSync(current, { withFileTypes: true })) {
        const childPath = join(current, child.name);
        const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
        if (child.isDirectory()) {
          visit(childPath, relativePath);
        } else if (child.isFile()) {
          const size = statSync(childPath).size;
          entries.push({ path: relativePath, bytes: size });
        }
      }
    };

    visit(dir, '');
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  private buildNamespace(rootPath: string, directory: string): string | null {
    const relativePath = this.safeRelative(rootPath, directory);
    if (!relativePath) {
      return null;
    }
    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    if (segments.length <= 1) {
      return null;
    }

    const namespaceSegments = segments.slice(0, segments.length - 1).map((segment) => toSlug(segment));
    if (namespaceSegments[namespaceSegments.length - 1] === 'skills') {
      namespaceSegments.pop();
    }

    return namespaceSegments.filter(Boolean).join(':') || null;
  }

  private safeRelative(base: string, target: string): string | null {
    const rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      return null;
    }
    return rel.replace(/\\/g, '/');
  }

  private buildAliases(metadata: {
    id: string;
    slug: string;
    name: string;
    namespace: string | null;
    relativeLocation: string;
    location: string;
    sourceLabel: string;
  }): string[] {
    const aliases = new Set<string>();
    aliases.add(metadata.id.toLowerCase());
    aliases.add(metadata.slug.toLowerCase());
    aliases.add(metadata.name.trim().toLowerCase());
    if (metadata.namespace) {
      aliases.add(metadata.namespace.toLowerCase());
      aliases.add(`${metadata.namespace.toLowerCase()}:${metadata.slug.toLowerCase()}`);
    }
    if (metadata.relativeLocation) {
      aliases.add(metadata.relativeLocation.toLowerCase());
    }
    aliases.add(metadata.location.toLowerCase());
    aliases.add(metadata.sourceLabel.toLowerCase());
    return Array.from(aliases).filter(Boolean);
  }

  private extractSkillContent(raw: string): ParsedSkillFile | null {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }

    let frontMatter: Record<string, string> = {};
    let body = trimmed;

    const fmMatch = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*/.exec(trimmed);
    if (fmMatch) {
      frontMatter = this.parseFrontMatterBlock(fmMatch[1] ?? '');
      body = trimmed.slice(fmMatch[0].length).trim();
    }

    const name = frontMatter['name'] ?? 'Skill';
    const description =
      frontMatter['description'] ??
      'Skill documentation lacked a description. Update SKILL.md front matter to include one.';

    return {
      name,
      description,
      version: frontMatter['version'],
      frontMatter,
      body,
    };
  }

  private parseFrontMatterBlock(block: string): Record<string, string> {
    const metadata: Record<string, string> = {};
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) {
        metadata[key] = value;
      }
    }
    return metadata;
  }

  private toSummary(record: SkillRecord): SkillSummary {
    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      description: record.description,
      version: record.version,
      namespace: record.namespace,
      source: record.source,
      sourceLabel: record.sourceLabel,
      location: record.location,
      relativeLocation: record.relativeLocation,
      hasBody: record.hasBody,
      hasReferences: record.hasReferences,
      hasScripts: record.hasScripts,
      hasAssets: record.hasAssets,
    };
  }
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'skill';
}
