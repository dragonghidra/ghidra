# Modular Runtime Overview

This project now ships a modular runtime stack so the same agent core can
power the CLI, browser sandboxes, HTTP workers, or remote/cloud targets
without duplicating wiring code.

## Runtime Layers

- **Adapters** (`src/adapters/*`) describe the execution surface. Every adapter
  implements `RuntimeAdapter` from `src/adapters/types.ts` and returns the
  capability modules that should be loaded for that environment.
- **Universal runtime** (`src/runtime/universal.ts`) constructs the `AgentHost`,
  loads whichever capability modules the adapter exposes, and returns the
  hydrated `AgentSession`.
- **Environment-specific helpers**
  - `createNodeRuntime()` loads the Node adapter (filesystem/search/bash).
  - `createBrowserRuntime()` is browser-safe and only loads explicitly provided modules.
  - `createCloudRuntime()` wires remote/RPC modules for serverless or workers.

Frontends (CLI, HTTP server, etc.) now call the helper that matches their
environment instead of instantiating `AgentHost` manually.

## Provider Plugins

Default providers were moved into discrete plugins under `src/plugins/providers/`:

- `openai/` registers the Responses API client.
- `anthropic/` registers the Messages API client.
- `deepseek/` registers DeepSeek via the OpenAI-compatible Chat Completions path.
- `xai/` registers Grok models through xAI's OpenAI-compatible Chat Completions API.

`registerDefaultProviderPlugins()` (called inside `AgentSession`) guarantees
these plugins are loaded once, and additional providers can register
themselves by calling `registerProvider()` before a session starts.

## Tool/Capability Plugins

`src/plugins/tools/registry.ts` is a small plugin registry for tool suites:

- Plugins declare their supported targets (`node`, `browser`, `cloud`, or `universal`)
  and return one or more `CapabilityModule` instances.
- `registerDefaultNodeToolPlugins()` adds the built-in filesystem, search, and
  bash capabilities implemented in `src/capabilities/`.
- `instantiateToolPlugins(target, context)` resolves the enabled plugins when
  an adapter boots. The Node adapter filters them based on the runtime options.

Custom tool plugins can register themselves at startup, which makes the CLI,
browser workers, and future runtimes pick them up automatically.

## Frontend Integration

`src/shell/shellApp.ts` now bootstraps the CLI by calling `createNodeRuntime()`.
This ensures:

1. Provider plugins are registered before models are loaded.
2. The Node adapter loads deterministic filesystem/search/bash suites.
3. Future capability modules (e.g., Google Sheets, cloud storage) can be added
   by registering additional plugins without editing the CLI.

HTTP servers, browser workers, or VS Code extensions only need to choose an
adapter, optionally register their own plugins, and then hydrate `AgentSession`
through the universal runtime helper.

## Extending the System

1. **Custom providers**: implement a plugin next to the existing entries in
   `src/plugins/providers/` and call it when your frontend starts.
2. **Custom tools**: register a `ToolPlugin` that returns one or more capability
   modules (filesystem wrappers, SaaS connectors, etc.).
3. **New adapters**: implement `RuntimeAdapter` for the new environment and plug
   it into `createUniversalRuntime()`.

This layout keeps core logic environment-agnostic while letting each runtime
compose exactly the providers, tools, and modules it needs.
