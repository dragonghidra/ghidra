import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../core/toolRuntime.js';

const execAsync = promisify(exec);

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface PackageLock {
  lockfileVersion?: number;
  dependencies?: Record<string, PackageLockDependency>;
  packages?: Record<string, PackageLockDependency>;
}

interface PackageLockDependency {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  resolved?: string;
  integrity?: string;
  requires?: Record<string, string>;
}

export function createDependencyTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'summarize_dependencies',
      description: 'Summarize dependency counts, categories, and notable packages from package.json.',
      parameters: {
        type: 'object',
        properties: {
          detail: {
            type: 'string',
            enum: ['basic', 'full'],
            description: 'Detail level for the summary (default: basic).',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const pkg = readPackageJson(workingDir);
          if (!pkg) {
            return 'Error: package.json not found.';
          }

          const detail = args['detail'] === 'full' ? 'full' : 'basic';
          return formatDependencySummary(pkg, detail);
        } catch (error) {
          return `Error summarizing dependencies: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'scan_dependency_health',
      description: 'Run npm audit to surface known vulnerabilities (requires npm registry access).',
      parameters: {
        type: 'object',
        properties: {
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 180000).',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const timeoutArg = args['timeout'];
        const timeout =
          typeof timeoutArg === 'number' && Number.isFinite(timeoutArg) && timeoutArg > 0
            ? timeoutArg
            : 180000;

        try {
          const { stdout } = await execAsync('npm audit --json', {
            cwd: workingDir,
            timeout,
            maxBuffer: 1024 * 1024 * 15,
          });
          return formatAuditReport(stdout);
        } catch (error: any) {
          if (error.killed) {
            return `Error: npm audit timed out after ${timeout}ms.`;
          }
          const stdout: string | undefined = error.stdout;
          if (stdout && stdout.trim()) {
            try {
              return formatAuditReport(stdout);
            } catch (parseError) {
              // fall through to generic error
            }
          }
          return `Error running npm audit: ${error.message}. stderr: ${error.stderr ?? 'none'}`;
        }
      },
    },
    {
      name: 'inspect_dependency_tree',
      description: 'Analyze package-lock.json for resolved versions and duplicate dependency instances.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      handler: async () => {
        try {
          const pkg = readPackageJson(workingDir);
          if (!pkg) {
            return 'Error: package.json not found.';
          }

          const lockPath = join(workingDir, 'package-lock.json');
          if (!existsSync(lockPath)) {
            return 'package-lock.json not found. Run npm install to generate it.';
          }

          const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as PackageLock;
          return formatLockSummary(pkg, lock);
        } catch (error) {
          return `Error inspecting dependency tree: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];
}

function readPackageJson(workingDir: string): PackageJson | null {
  const packageJsonPath = join(workingDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
}

function formatDependencySummary(pkg: PackageJson, detail: 'basic' | 'full'): string {
  const deps = Object.entries(pkg.dependencies ?? {});
  const devDeps = Object.entries(pkg.devDependencies ?? {});
  const optionalDeps = Object.entries(pkg.optionalDependencies ?? {});

  const output: string[] = [];
  output.push(`# Dependency summary for ${pkg.name ?? 'package'} v${pkg.version ?? '0.0.0'}`);
  output.push('');
  output.push(`- Production dependencies: ${deps.length}`);
  output.push(`- Dev dependencies: ${devDeps.length}`);
  output.push(`- Optional dependencies: ${optionalDeps.length}`);
  output.push('');

  if (detail === 'full') {
    if (deps.length > 0) {
      output.push('## Production dependencies');
      deps
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([name, version]) => {
          output.push(`- ${name}: ${version}`);
        });
      output.push('');
    }

    if (devDeps.length > 0) {
      output.push('## Dev dependencies');
      devDeps
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([name, version]) => {
          output.push(`- ${name}: ${version}`);
        });
      output.push('');
    }

    if (optionalDeps.length > 0) {
      output.push('## Optional dependencies');
      optionalDeps
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([name, version]) => {
          output.push(`- ${name}: ${version}`);
        });
      output.push('');
    }
  } else {
    if (deps.length > 0) {
      output.push('Top production dependencies:');
      deps
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 10)
        .forEach(([name, version]) => {
          output.push(`- ${name}: ${version}`);
        });
      output.push('');
    }
  }

  return output.join('\n');
}

function formatAuditReport(jsonText: string): string {
  const report = JSON.parse(jsonText);
  const metadata = report.metadata ?? {};
  const vulnerabilityCounts = metadata.vulnerabilities ?? report.vulnerabilities ?? {};
  const output: string[] = [];
  output.push('# npm audit report');
  output.push('');

  if (Object.keys(vulnerabilityCounts).length === 0) {
    output.push('No vulnerabilities reported.');
  } else {
    output.push('## Totals by severity');
    for (const [severity, count] of Object.entries(vulnerabilityCounts)) {
      output.push(`- ${severity}: ${count}`);
    }
    output.push('');
  }

  const vulnerabilities = report.vulnerabilities ?? report.advisories ?? {};
  const entries = Object.entries(vulnerabilities);
  if (entries.length > 0) {
    output.push('## Notable vulnerabilities');
    entries.slice(0, 10).forEach(([name, info]) => {
      const data = info as any;
      const severity = data.severity ?? data.metadata?.severity ?? 'unknown';
      const via = Array.isArray(data.via)
        ? data.via.map((item: any) => (typeof item === 'string' ? item : item.title)).join(', ')
        : '';
      output.push(`- ${name}: severity ${severity}${via ? ` (via ${via})` : ''}`);
      if (data.range) {
        output.push(`  Affected versions: ${data.range}`);
      } else if (data.vulnerable_versions) {
        output.push(`  Affected versions: ${data.vulnerable_versions}`);
      }
      if (data.patch_available || data.fixAvailable) {
        output.push(`  Fix available: ${JSON.stringify(data.patch_available ?? data.fixAvailable)}`);
      }
    });
  } else {
    output.push('No detailed vulnerability entries were returned by npm audit.');
  }

  return output.join('\n');
}

function formatLockSummary(pkg: PackageJson, lock: PackageLock): string {
  const deps = Object.keys(pkg.dependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});

  const output: string[] = [];
  output.push(`# Dependency tree (${pkg.name ?? 'package'})`);
  if (lock.lockfileVersion) {
    output.push(`Lockfile version: ${lock.lockfileVersion}`);
  }
  output.push('');

  if (deps.length > 0) {
    output.push('## Resolved production dependencies');
    deps.forEach((dep) => {
      const version = resolveLockVersion(lock, dep);
      output.push(`- ${dep}: ${version ?? 'unknown version'}`);
    });
    output.push('');
  }

  if (devDeps.length > 0) {
    output.push('## Resolved dev dependencies');
    devDeps.forEach((dep) => {
      const version = resolveLockVersion(lock, dep);
      output.push(`- ${dep}: ${version ?? 'unknown version'}`);
    });
    output.push('');
  }

  const duplicates = detectDuplicateVersions(lock);
  if (duplicates.length > 0) {
    output.push('## Duplicate packages detected');
    duplicates.forEach(({ name, versions }) => {
      output.push(`- ${name}: ${Array.from(versions).join(', ')}`);
    });
  } else {
    output.push('No duplicate package versions detected across the lockfile.');
  }

  return output.join('\n');
}

function resolveLockVersion(lock: PackageLock, name: string): string | null {
  if (lock.dependencies && lock.dependencies[name]?.version) {
    return lock.dependencies[name]!.version ?? null;
  }
  if (lock.packages) {
    const key = name.startsWith('node_modules/') ? name : `node_modules/${name}`;
    const entry = lock.packages[key];
    if (entry?.version) {
      return entry.version;
    }
  }
  return null;
}

function detectDuplicateVersions(lock: PackageLock): Array<{ name: string; versions: Set<string> }> {
  const versionMap = new Map<string, Set<string>>();
  if (!lock.packages) {
    return [];
  }

  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith('node_modules/')) {
      continue;
    }
    const name = key.replace(/^node_modules\//, '');
    if (!versionMap.has(name)) {
      versionMap.set(name, new Set());
    }
    if (entry.version) {
      versionMap.get(name)!.add(entry.version);
    }
  }

  return [...versionMap.entries()]
    .filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => ({ name, versions }));
}
