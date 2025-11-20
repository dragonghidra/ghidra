import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface DiffSegment {
  type: 'added' | 'removed';
  lineNumber: number;
  content: string;
}

export function buildDiffSegments(previous: string, next: string): DiffSegment[] {
  const before = normalizeNewlines(previous);
  const after = normalizeNewlines(next);

  if (before === after) {
    return [];
  }

  const gitSegments = tryBuildWithGit(before, after);
  if (gitSegments) {
    return gitSegments;
  }

  return buildNaiveDiff(before, after);
}

export function formatDiffLines(diff: DiffSegment[]): string[] {
  if (!diff.length) {
    return [];
  }
  const width = Math.max(
    1,
    ...diff.map((entry) => Math.max(1, entry.lineNumber).toString().length)
  );

  return diff.map((entry) => {
    const prefix = entry.type === 'added' ? '+' : '-';
    const lineNumber = Math.max(1, entry.lineNumber);
    const body = entry.content.length > 0 ? entry.content : '[empty line]';
    const paddedNumber = lineNumber.toString().padStart(width, ' ');
    return `${prefix} L${paddedNumber} | ${body}`;
  });
}

function tryBuildWithGit(before: string, after: string): DiffSegment[] | null {
  let tempDir: string | null = null;
  try {
    tempDir = mkdtempSync(join(tmpdir(), 'apt-diff-'));
    const originalPath = join(tempDir, 'before.txt');
    const updatedPath = join(tempDir, 'after.txt');
    writeFileSync(originalPath, before, 'utf8');
    writeFileSync(updatedPath, after, 'utf8');

    const result = spawnSync(
      'git',
      ['--no-pager', 'diff', '--no-index', '--unified=0', '--color=never', '--', originalPath, updatedPath],
      { encoding: 'utf8' }
    );

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return null;
      }
      return null;
    }

    if (typeof result.status === 'number' && result.status > 1) {
      return null;
    }

    return parseUnifiedDiff(result.stdout);
  } catch {
    return null;
  } finally {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function parseUnifiedDiff(output: string): DiffSegment[] {
  if (!output.trim()) {
    return [];
  }

  const lines = output.split('\n');
  const segments: DiffSegment[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) {
      continue;
    }
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match?.[1] && match?.[2]) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      continue;
    }

    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      continue;
    }

    if (line.startsWith('Binary ')) {
      continue;
    }

    if (line.startsWith('\\')) {
      continue;
    }

    if (line.startsWith('+')) {
      segments.push({ type: 'added', lineNumber: newLine, content: line.slice(1) });
      newLine += 1;
      continue;
    }

    if (line.startsWith('-')) {
      segments.push({ type: 'removed', lineNumber: oldLine, content: line.slice(1) });
      oldLine += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      oldLine += 1;
      newLine += 1;
      continue;
    }
  }

  return segments;
}

function buildNaiveDiff(before: string, after: string): DiffSegment[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const max = Math.max(a.length, b.length);
  const segments: DiffSegment[] = [];

  for (let index = 0; index < max; index += 1) {
    const left = a[index];
    const right = b[index];

    if (left === right) {
      continue;
    }

    if (typeof left === 'string') {
      segments.push({ type: 'removed', lineNumber: index + 1, content: left });
    }

    if (typeof right === 'string') {
      segments.push({ type: 'added', lineNumber: index + 1, content: right });
    }
  }

  return segments;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function splitLines(value: string): string[] {
  if (!value) {
    return [];
  }
  const normalized = normalizeNewlines(value);
  return normalized.split('\n');
}
