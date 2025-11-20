# Modular Runtime Refactor Plan

## Design Philosophy

**Maximal reliability during interoperability** through:
- **Interface contracts**: Versioned JSON schemas for all module boundaries
- **Dependency injection**: Zero hard-coded dependencies between layers
- **Platform abstraction**: Core logic never imports Node.js-specific APIs directly
- **Transport agnostic**: Tools/providers work over HTTP, WebSocket, IPC, or direct calls

## Runtime Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   CLI    │  │  Browser │  │   HTTP   │  │  VS Code │   │
│  │  Shell   │  │    UI    │  │   API    │  │Extension │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    INTERFACE LAYER                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │        AgentController (versioned contract)           │  │
│  │   • send(message) → AsyncIterator<AgentEvent>        │  │
│  │   • switchModel(provider, model)                      │  │
│  │   • registerToolSuite(suite)                          │  │
│  │   • getCapabilities() → CapabilityManifest           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      CORE LAYER                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Agent   │  │   Tool   │  │ Provider │  │ Context  │   │
│  │ Runtime  │  │ Runtime  │  │ Registry │  │ Manager  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   ADAPTER LAYER                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   Node   │  │ Browser  │  │   HTTP   │  │  Remote  │   │
│  │Adapters  │  │ Adapters │  │ Adapters │  │ Adapters │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  PLATFORM LAYER                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Node.js  │  │ Browser  │  │  Deno    │  │   Bun    │   │
│  │  Runtime │  │  Runtime │  │  Runtime │  │  Runtime │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Key Principles

### 1. Interface Contracts (Stable Front-End)
Every layer exposes versioned TypeScript interfaces that compile to JSON schemas:
- `AgentController` v1.0: Core agent interaction
- `ToolSuite` v1.0: Tool registration
- `ProviderAdapter` v1.0: LLM provider integration
- `ContextAdapter` v1.0: Workspace/environment access

### 2. Platform Abstraction
Core modules never import platform-specific APIs:
```typescript
// ❌ BAD: Core imports Node.js directly
import { readFileSync } from 'node:fs';

// ✅ GOOD: Core depends on abstraction
interface FileSystemAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}
```

### 3. Dependency Injection
All dependencies flow inward through constructors:
```typescript
class AgentRuntime {
  constructor(
    private provider: LLMProvider,
    private toolRuntime: ToolRuntime,
    private contextAdapter: ContextAdapter
  ) {}
}
```

### 4. Transport Agnostic Tools
Tools communicate via serializable messages:
```typescript
interface ToolExecutionRequest {
  toolId: string;
  parameters: Record<string, unknown>;
  executionId: string;
}

interface ToolExecutionResponse {
  executionId: string;
  result: string | { error: string };
}
```

## Module Structure

```
src/
├── contracts/          # Versioned interface definitions
│   ├── v1/
│   │   ├── agent.ts
│   │   ├── tool.ts
│   │   ├── provider.ts
│   │   └── context.ts
│   └── schemas/        # JSON Schema exports
│
├── core/               # Platform-agnostic business logic
│   ├── agent/
│   │   ├── runtime.ts
│   │   └── controller.ts
│   ├── tools/
│   │   ├── registry.ts
│   │   └── executor.ts
│   ├── providers/
│   │   └── registry.ts
│   └── context/
│       └── manager.ts
│
├── adapters/           # Platform-specific implementations
│   ├── node/
│   │   ├── filesystem.ts
│   │   ├── process.ts
│   │   └── index.ts
│   ├── browser/
│   │   ├── filesystem.ts   # IndexedDB/OPFS
│   │   ├── process.ts      # Web Workers
│   │   └── index.ts
│   ├── http/
│   │   ├── client.ts
│   │   └── server.ts
│   └── remote/
│       └── rpc.ts
│
├── plugins/            # Modular tool/provider plugins
│   ├── tools/
│   │   ├── filesystem/
│   │   ├── bash/
│   │   ├── search/
│   │   └── custom/
│   └── providers/
│       ├── openai/
│       ├── anthropic/
│       ├── deepseek/
│       └── custom/
│
├── frontends/          # Different presentation layers
│   ├── cli/
│   │   ├── shell.ts
│   │   └── commands.ts
│   ├── http/
│   │   ├── server.ts
│   │   └── routes.ts
│   ├── browser/
│   │   ├── ui.ts
│   │   └── worker.ts
│   └── vscode/
│       └── extension.ts
│
└── runtime/            # Runtime composition
    ├── node.ts         # Node.js runtime
    ├── browser.ts      # Browser runtime
    ├── cloud.ts        # Cloud function runtime
    └── universal.ts    # Universal factory
```

## Implementation Phases

### Phase 1: Extract Contracts (Non-Breaking)
1. Define versioned interfaces in `contracts/v1/`
2. Make existing code implement these contracts
3. Add JSON schema generation

### Phase 2: Abstract Platform APIs
1. Create adapter interfaces
2. Implement Node.js adapters
3. Refactor core to use adapters

### Phase 3: Plugin System
1. Extract tools into plugins
2. Extract providers into plugins
3. Create plugin loader

### Phase 4: Additional Frontends
1. HTTP API server
2. Browser runtime
3. Cloud function wrapper

### Phase 5: Remote Execution
1. RPC protocol for remote tools
2. Distributed tool execution
3. Cloud-native deployment

## Benefits

### For Reliability
- **Versioned contracts** prevent breaking changes
- **Platform abstraction** isolates failure domains
- **Dependency injection** enables comprehensive testing

### For Interoperability
- **Transport agnostic** tools work anywhere
- **Standard protocols** enable language-agnostic clients
- **JSON schemas** provide machine-readable contracts

### For Extensibility
- **Plugin system** allows third-party tools/providers
- **Adapter pattern** supports new platforms
- **Registry pattern** enables runtime composition

### For Deployment
- **Browser compatible** core runs in WebAssembly
- **Cloud native** adapters for serverless
- **Edge deployable** with minimal dependencies
