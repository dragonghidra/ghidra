export type SkillSource = 'workspace' | 'home' | 'custom';

export interface SkillResourceEntry {
  path: string;
  bytes: number;
}

export interface SkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  version?: string;
  namespace?: string;
  source: SkillSource;
  sourceLabel: string;
  location: string;
  relativeLocation?: string;
  hasBody: boolean;
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
}

export interface SkillRecord extends SkillSummary {
  body: string;
  frontMatter: Record<string, string>;
  references: SkillResourceEntry[];
  scripts: SkillResourceEntry[];
  assets: SkillResourceEntry[];
  aliases: string[];
  filePath: string;
}

export interface SkillRepositoryOptions {
  workingDir: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  extraPaths?: string[];
}
