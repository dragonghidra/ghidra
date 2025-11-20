import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SkillRepository } from '../src/skills/skillRepository.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/skills/workspace', import.meta.url));

describe('SkillRepository', () => {
  it('loads workspace and nested Claude Code skills', () => {
    const repository = new SkillRepository({ workingDir: fixtureRoot, env: {} });
    const skills = repository.listSkills();
    const sample = skills.find((skill) => skill.slug === 'sample-skill');
    assert.ok(sample, 'expected sample skill to be discovered');
    assert.equal(sample?.hasReferences, true);
    assert.equal(sample?.hasScripts, true);
    assert.equal(sample?.hasAssets, true);

    const nested = skills.find((skill) => skill.id.includes('command-development'));
    assert.ok(nested, 'expected nested plugin skill to be discovered');
    assert.equal(nested?.namespace, 'claude-code:plugins:plugin-dev');
  });

  it('resolves skills by slug and namespace', () => {
    const repository = new SkillRepository({ workingDir: fixtureRoot, env: {} });
    const bySlug = repository.getSkill('sample-skill');
    assert.ok(bySlug);
    assert.equal(bySlug?.name, 'Sample Skill');

    const byNamespace = repository.getSkill('claude-code:plugins:plugin-dev:command-development');
    assert.ok(byNamespace);
    assert.equal(byNamespace?.name, 'Command Development');
  });

  it('refresh picks up new files after initial load', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'skill-repo-'));
    const repository = new SkillRepository({ workingDir: tempDir, env: {} });
    assert.equal(repository.listSkills().length, 0);

    const skillDir = join(tempDir, 'skills', 'transient');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: Transient Skill
description: Created during tests.
---

# Temporary Skill

Used to confirm refresh() rescans directories.
`
    );

    assert.equal(repository.listSkills().length, 0, 'cache should not refresh automatically');
    repository.refresh();
    const refreshed = repository.listSkills();
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0]?.slug, 'transient-skill');
  });
});
