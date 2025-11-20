# Skill System Overview

APT CLI now mirrors Claude Code's **Skill** tooling so you can bundle reusable workflows, policies, and domain
knowledge inside `SKILL.md` packages. Skills are automatically discovered and exposed through the new `ListSkills` and
`Skill` tools plus a `/skills` slash command (see README).

## Where skills live

The CLI scans these locations (in order of precedence):

1. `<workspace>/skills/**/SKILL.md`
2. `<workspace>/.claude/skills/**/SKILL.md`
3. `<workspace>/.apt/skills/**/SKILL.md`
4. Any nested directory under the workspace that contains a `SKILL.md` (so Claude Code plugins checked into the repo work
   out of the box, e.g. `claude-code/plugins/plugin-dev/skills/*/SKILL.md`)
5. `~/.claude/skills/**/SKILL.md`
6. `~/.apt/skills/**/SKILL.md`
7. Any directory listed in `APT_SKILLS_DIRS` (use `:` as the separator, `;` on Windows)

Each skill directory may also contain optional `references/`, `scripts/`, and `assets/` folders. The loader emits a
resource inventory so the model knows which supporting files exist before reading them.

## Tooling

| Tool        | Description                                                                                   |
|-------------|-----------------------------------------------------------------------------------------------|
| `ListSkills` | Scans for all SKILL packages and prints name, namespace-qualified slug, path, and resources. |
| `Skill`      | Loads a single SKILL by name/slug/path and returns metadata, body, and optional resource lists. |

Both tools accept `refresh_cache: true` to force a re-scan when new skills are added during a live session.

## Output format

`ListSkills` emits Claude-style summaries:

```
ListSkills {}
```

> Discovered 3 skills:
> - plugin-dev:command-development — Command authoring workflow for Claude plugins
>   Source: workspace:skills • Path: claude-code/plugins/plugin-dev/skills/command-development
>   Body ✅ | References ✅ | Scripts ✅ | Assets —

`Skill` emits a Markdown document that includes:

- ID + namespace + absolute/relative path
- Front-matter metadata (description, version, custom keys)
- Full SKILL body (procedures, guidance, triggers, etc.)
- Inventories for `references/`, `scripts/`, and `assets/` with human-readable sizes

Example:

```
Skill {
  "skill": "plugin-dev:skill-development",
  "sections": ["metadata", "body", "references"]
}
```

## Tips

- Store private or workspace-specific skills under `.claude/skills` so they remain Git-ignored while still discoverable.
- Use namespaces (e.g. `plugin-dev:skill-development`) to avoid collisions; they are derived from the directory path.
- Keep SKILL front matter up to date—`name`, `description`, and `version` are all surfaced to the AI before loading the
  full body, just like Claude Code.
- When bundling large reference files, prefer the `references/` directory so the agent can selectively `read_file` them
  instead of bloating the main SKILL body.
