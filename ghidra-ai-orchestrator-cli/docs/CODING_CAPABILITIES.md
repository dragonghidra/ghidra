# Coding Capability Guide

APT CLI now ships a single-minded coding toolkit. Non-coding suites (DOCX/XLSX editors, cloud office connectors,
or Tavily web search) were removed so every default tool strengthens repo analysis, refactoring, or delivery workflows.
Every capability is implemented as a `CapabilityModule` and registered via `src/contracts/tools.schema.json`, so frontends
and policies stay in sync automatically.

## Core Workspace Control

### Filesystem suite
`read_file`, `write_file`, `list_files`, and `search_files` expose deterministic workspace access with diff previews and a
binary-aware deny list. Writes include before/after hunks so the operator can audit code changes in real time.

```
read_file { "path": "src/core/toolRuntime.ts" }
write_file { "path": "src/new.ts", "content": "export const x = 1;" }
```

### Search suite
`grep_search` and `find_definition` provide regex-aware repo searches plus simple symbol indexing so you can hop to the
definition of a component or function from anywhere in the tree.

### Bash suite
`execute_bash` runs commands inside `<workspace>/.apt/shell-sandbox` with HOME/TMP/XDG rewrites for deterministic
execution. Standard output is summarized inline so shell operations never scroll past the code you are editing.

## Delivery & Validation Loops

### Repo checks suite
`run_repo_checks` detects `npm test`, `npm run build`, and `npm run lint` (or any scripts you pass) and executes them in
sequence, capturing pass/fail status and trimmed logs.

```
run_repo_checks { "scripts": ["test", "lint"], "extraArgs": "--runInBand" }
```

### Development workflow suite
Automates everyday project flows:
- `run_tests` – detects Jest/Vitest/Mocha invocations or falls back to `npm test` with custom patterns.
- `install_dependencies` – wraps npm/yarn/pnpm installs with production-only toggles.
- `check_package_info` – surfaces package name, scripts, dependencies, and metadata.
- `run_build` – executes `npm run build` (or a provided command) with timeout protection.

```
run_tests { "testPattern": "providerFactory.test.ts" }
run_build { "timeout": 420000 }
```

### Testing & coverage suite
- `generate_test_templates` – emits Jest/Vitest/Mocha skeletons for detected functions/classes.
- `run_coverage_analysis` – forces coverage-enabled test runs across popular frameworks.
- `summarize_coverage_report` – reads `coverage/coverage-summary.json` (or a custom path) and reports line/function/branch
  coverage in Markdown.

```
generate_test_templates { "path": "src/runtime/agentSession.ts" }
summarize_coverage_report {}
```

### Skill library suite
Reusable knowledge bundles modeled after Claude Code Skills:
- `ListSkills` – enumerates SKILL.md packages discovered in the workspace or user skill directories.
- `Skill` – loads a SKILL.md (metadata, full body, and bundled `references/`, `scripts/`, `assets/` directories).

```
ListSkills {}
Skill { "skill": "plugin-dev:skill-development", "sections": ["body", "references"] }
```

## Code Intelligence & Quality

### Code analysis suite
Advanced TypeScript/JavaScript analysis via:
- `analyze_code_structure` – extracts functions, classes, interfaces, imports, and exports with line numbers.
- `find_dependencies` – maps every import to local or external modules, ideal for dependency diagrams.
- `check_code_complexity` – reports parameter counts, class metrics, and low/medium/high ratings.

```
analyze_code_structure { "path": "src/core/toolRuntime.ts" }
find_dependencies { "path": "src/config.ts" }
```

### Code quality suite
- `run_lint_checks` – runs ESLint (or `npm run lint`) with pattern/fix toggles.
- `inspect_code_quality` – combines AST metrics (TODO density, comment coverage, function complexity) into a single report.
- `list_lint_rules` – loads eslint.config.js/.eslintrc/package.json eslintConfig to summarize active rules.

```
run_lint_checks { "pattern": "src/**/*.ts", "fix": true }
inspect_code_quality { "path": "src/tools/bashTools.ts" }
```

### Refactoring suite
Pragmatic refactor planning helpers:
- `detect_refactoring_hotspots` – scans a file or directory for functions with high statement counts, complexity, or span.
- `generate_refactor_plan` – targets a symbol and emits a structured checklist plus metrics.
- `analyze_refactor_impact` – summarizes inbound/outbound call graph edges so you can estimate blast radius.

```
detect_refactoring_hotspots { "path": "src/runtime" }
generate_refactor_plan { "path": "src/runtime/universal.ts", "symbol": "createUniversalRuntime" }
```

## Dependency & Runtime Awareness

### Dependency security suite
- `summarize_dependencies` – counts prod/dev/optional dependencies and lists notable packages.
- `scan_dependency_health` – runs `npm audit --json` with friendly summaries (offline tolerant when cached data exists).
- `inspect_dependency_tree` – inspects `package-lock.json` for duplicates, resolved versions, and integrity info.

```
summarize_dependencies { "detail": "full" }
scan_dependency_health { "timeout": 120000 }
```

### Runtime metadata tools
The tool runtime always exposes `context_snapshot`, `capabilities_overview`, and `profile_details` so the model (and the
operator) can confirm what was captured, which tools are enabled, and which profile/temperature is active.

```
context_snapshot {}
capabilities_overview {}
```

## External Context & Integrations

### Web tools suite
- `WebFetch` – deterministic HTML fetcher with auto HTTPS upgrades, redirect reporting, and HTML → Markdown conversion (prefers MCP-provided equivalents when available).
- `WebSearch` – backed by Brave Search (requires `BRAVE_SEARCH_API_KEY`) with SerpAPI as a fallback (`SERPAPI_API_KEY`). Supports domain allow/block lists, includes publication metadata, and returns search blocks ready for citations.

```
WebFetch { "url": "https://example.com/docs", "prompt": "Extract install steps" }
WebSearch { "query": "tsconfig references", "allowed_domains": ["typescriptlang.org"] }
```

### MCP connectors suite
- Loads any `.mcp.json` / `.apt/mcp.json` definitions from the workspace or `~/.apt`.
- Spawns stdio transports (child processes) via the official Model Context Protocol framing and exposes every remote tool as `mcp__<server>__<tool>`.
- Servers can reference `${WORKSPACE_ROOT}`, `${APT_HOME}`, or arbitrary environment variables for commands/args/env fields. Disable a server with `"disabled": true`.

```
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "${WORKSPACE_ROOT}"]
  },
  "asana": {
    "command": "./scripts/mcp-asana.js",
    "cwd": "${WORKSPACE_ROOT}/integrations"
  }
}
```

Every suite can be toggled through `/tools`, and detailed metadata (IDs, scopes, required secrets) stays versioned in
`src/contracts/tools.schema.json`. Use this document as the one-stop reference when reasoning about what the CLI can do in
its current coding-only configuration.
