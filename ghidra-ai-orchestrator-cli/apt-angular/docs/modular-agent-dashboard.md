# Modular Agent Dashboard & Firebase Orchestration Design

## Goals & Non-Negotiables
- Mirror the tmux-style dual-agent feed that already exists in `src/app/app.html` while allowing multiple heterogeneous agents (MCP servers, SaaS backends, local CLIs) to run concurrently.
- Runs must continue after a browser tab closes; every run produces durable artifacts, logs, and metadata the user can open later.
- The Angular UI should be modular so a new connector or visualization can slot in without refactoring the rest of the tree.
- Deploy the UI to Firebase Hosting and offload long-running execution to Firebase-backed infrastructure (2nd-gen Functions or Cloud Run) so sessions remain alive in the background.
- Store run history + custom agent configuration in a persistence layer that supports real-time streaming, efficient querying, and long-lived retention.

## High-Level Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│ Firebase Hosting (Angular SSR bundle)                                 │
│  ├─ AgentWorkspaceModule (router shell)                               │
│  ├─ RunBoardModule (list + filters)                                   │
│  └─ AgentCanvasModule (active run detail)                             │
└──────▲────────────────────────────────────────────────────────────────┘
       │ HTTPS / Firestore streams
┌──────┴────────────────────────────────────────────────────────────────┐
│ Firebase Functions (2nd gen HTTPS + callable)                         │
│  ├─ createAgentRun()  validate payload, persist run draft             │
│  ├─ issueCommand()    push ad-hoc prompts / interrupts                │
│  └─ listConnectors()  surface MCP/server catalog                      │
└──────▲────────────────────────────────────────────────────────────────┘
       │ Pub/Sub / Cloud Tasks events (decouple UI lifespan)
┌──────┴────────────────────────────────────────────────────────────────┐
│ Agent Executor (Cloud Run service or longer-lived Function)           │
│  ├─ AgentHost runtime (mirrors src/runtime/agentHost.ts contract)     │
│  ├─ Connector adapters (MCP, REST, CLI, custom tool suites)           │
│  └─ Stream broker (writes Firestore docs + Cloud Storage artifacts)   │
└──────▲────────────────────────────────────────────────────────────────┘
       │ Firestore / Cloud Storage
┌──────┴────────────────────────────────────────────────────────────────┐
│ Persistence Tier                                                      │
│  ├─ Firestore: agentRuns, connectors, runEvents subcollections        │
│  └─ Cloud Storage / BigQuery: large diffs, transcripts, analytics     │
└───────────────────────────────────────────────────────────────────────┘
```

## Angular Frontend Composition

### Workspace shell
- **AgentWorkspaceModule** becomes the top-level route wrapper. It loads the current user profile, fetches `agentRuns` metadata, and injects feature modules via `NgComponentOutlet`. This keeps the SSR-friendly `app.html` hero but gates all authed behavior behind Firebase Auth / App Check.

### Run discovery & history
- **RunBoardModule**: virtualized table/grid fed by an `AgentRunStore` signal service. Supports filters (agent profile, connector, status) and exposes actions (resume, duplicate, pin). Runs highlight whether they stream from Firestore in real time or are archived.
- **SavedQueriesComponent**: lets users save queries (e.g., “Show APT runs hitting MCP:github”). Each saved query stores Firestore composite-index metadata so Cloud Functions can hydrate it quickly.

### Active run canvas
- **AgentCanvasModule**: splits into three resizable panes:
  1. **TimelinePane** streams `runEvents` (chat messages, diffs) using Angular CDK virtual-scroll to handle thousands of lines.
  2. **ArtifactPane** lists artifacts emitted by the backend (files, patches, URLs). Clicking an artifact fetches either a signed Cloud Storage URL or edge-cached content.
  3. **ControlPane** houses the command input, status badges, and `ConnectorStack` view so users can see which tool suites are active.
- **Module Federation for visualizers**: each artifact advertises a MIME-like type (e.g., `diff/unified`, `notebook/v1`). The UI lazy-loads a renderer via Angular’s `loadComponent` so new connectors bring their own visual module without touching the canvas core.

### Connector library
- **ConnectorGalleryModule** surfaces every MCP server / remote integration registered in Firestore’s `connectors` collection. Each connector entry exposes:
  - human-readable label and badge (provider, capability tags),
  - requirements (secrets, scopes, workspace selectors),
  - version + availability.
- **ConnectorWizardComponent** drives onboarding. When a user clicks “add connector,” the wizard triggers Cloud Functions to create a Secret Manager entry, run OAuth, or fetch MCP metadata. Wizard progress/state stores in the browser until the backend confirms activation.

### State management
- `AgentRunStore` (signal-based service) wraps AngularFire SDK calls. It multiplexes:
  - SSR bootstrap (initial snapshot via `/api/session` analog) for SEO and fast first paint.
  - Firestore listeners for run metadata + events.
  - Command dispatch via HTTPS callable functions, with optimistic UI updates + rollback on errors.
- Stores stay thin; complex logic (retry policies, permission checks) lives server-side so a closed tab does not affect execution.

## Backend Execution Model

1. **Run creation**
   - Frontend posts to `createAgentRun` (HTTPS Function).
   - Function validates payload (agent profile, connector refs, prompt, schedule) against Firestore Security Rules + custom claims.
   - Function writes `agentRuns/{runId}` with status `queued`, and enqueues a Cloud Task that targets the Agent Executor endpoint with runId + auth context. Using Cloud Tasks guarantees the run starts even if Firebase Functions throttles, and gives retries/backoff for free.

2. **Agent Executor**
   - Implemented as a Cloud Run service (recommended) or a long-running 2nd-gen Function. Cloud Run is preferable because runs may stream for minutes+; it can hold open bi-directional MCP connections and maintain WebSocket tunnels.
   - Executor bootstraps the existing Node `AgentHost` runtime (`src/runtime/agentHost.ts`) so capability modules are reused. Connector adapters map to MCP servers, CLI shells, or SaaS APIs and expose the same `ToolSuite` contract.
   - Execution loop emits structured events (`RunEventMessage`, `RunEventDiff`, `RunEventLog`). The executor writes each event to `agentRuns/{id}/events/{eventId}` (batched writes to stay under Firestore throughput limits) and stores bulky payloads (diff blobs, archives) in Cloud Storage, referencing them from the Firestore event.

3. **Streaming updates**
   - Angular clients subscribe to Firestore subcollections; offline clients rely on Firestore’s local cache to browse history.
   - For SSR or environments that prefer SSE/WebSockets, expose `/api/agentRuns/:id/stream` via a function that tails Firestore and emits consolidated events. This is similar to today’s `/api/session/stream` contract but works per-run.

4. **Commands & interrupts**
   - Users can send follow-up commands even when a run is in progress. `issueCommand` writes to `agentRuns/{id}/commands/{commandId}`; the executor listens (Firestore listener or Pub/Sub) and forwards them to the running agent loop (stdin for CLI connectors, MCP tool call, etc.).

5. **Lifecycle management**
   - Status machine: `draft → queued → running → streaming → succeeded|failed|cancelled`.
   - TTL policies run in a scheduled Function that archives completed runs after N days by copying their documents to Coldline Storage and pruning high-volume Firestore collections.

## Connector & MCP Extensibility
- **Connector schema (Firestore `connectors` collection)**:
  ```json
  {
    "id": "mcp.github",
    "type": "mcp",
    "capabilities": ["repo_search", "pr_review"],
    "requiresSecret": true,
    "configurationSchema": { ... JSON Schema ... },
    "toolSuites": ["capability.mcp.github"],
    "status": "active"
  }
  ```
- Backend `ConnectorRegistry` loads all active connectors and instantiates capability modules before the `AgentHost` session starts. Modules can wrap:
  - Local CLI (spawned child_process) from the existing `LocalCliGateway`.
  - Remote MCP servers (via WebSockets / SSE).
  - SaaS APIs (Google Sheets, Slack, etc.) using service accounts stored in Secret Manager.
- Frontend uses the same metadata to render badges, gating UI interactions via feature flags when a connector is disabled.

## Persistence Strategy & Firestore Evaluation

### Where Firestore fits well
- **Run metadata & configurations**: Documents are naturally hierarchical (project → agentRuns → events). Firestore’s real-time listeners power the live UI without an additional SSE layer, and Security Rules allow per-user / per-project ACLs.
- **Connector catalog & user preferences**: Typically small, strongly consistent documents that benefit from offline caching.
- **Command queueing**: Subcollections keep the write throughput distributed; `onWrite` triggers (2nd-gen Functions) can react to new commands instantly.

### Firestore limitations
- Document size cap (1 MiB) makes it a poor fit for large diffs or binary artifacts. Streaming every token as a separate doc is also expensive (write billing per event) and can hit the 10K writes/sec limit quickly when many runs are active.
- Querying across millions of historical events for analytics is cumbersome; Firestore lacks server-side joins and full-text search, so retrospective insights need another store.
- Long-term retention costs accumulate because Firestore is priced per document, not GB; storing years of verbose logs is expensive relative to Cloud Storage or BigQuery long-term pricing.

### Recommended hybrid
1. **Firestore (primary index)**
   - Collections: `projects`, `agentRuns`, `agentRuns/{id}/events`, `agentRuns/{id}/commands`, `connectors`, `agentProfiles`.
   - Use batched writes to append events in 5–10 message bundles to lower write amplification.
   - Store only summaries in each event (e.g., `<2 KB snippet`); include pointers to external artifacts.
2. **Cloud Storage**
   - Persist complete transcripts, diffs, ZIP bundles, or MCP-exported files.
   - Retain signed URLs or `gs://` references in the corresponding Firestore event.
3. **BigQuery (optional)**
   - Stream Firestore change logs into BigQuery via Dataflow (Firestore → BigQuery connector). Provides cheap analytics without bloating Firestore.
4. **Secret Manager**
   - Store actual credentials or connector secrets; Firestore only keeps references and redacted metadata.

**Conclusion:** Firestore should remain the primary index for run history metadata and agent configuration because it gives real-time updates directly to the Angular UI and integrates with Firebase security. However, it should be paired with Cloud Storage (and optionally BigQuery) for large artifacts + analytics to avoid cost/performance pitfalls. This hybrid approach also keeps the door open if future MCP connectors require relational schemas; those can live in Cloud SQL while the UI continues to read metadata from Firestore.

## Firestore Rules & Indexes
- `projects/{projectId}` documents carry an `ownerUid` and `members` map (`uid -> admin|editor|viewer`). All downstream collections reference the same membership checks so ACLs stay centralized.
- `projects/{projectId}/agentRuns/{runId}` restricts writes to admins/editors, while server-side Cloud Run executors gain access via the `runExecutor` custom claim. Clients can attach commands through `commands` subcollections; stream events remain write-only for backend actors.
- `projects/{projectId}/connectors/{connectorId}` is admin-only for mutations. Read access extends to any member so the Angular Connector Gallery can render metadata.
- Global `agentProfiles/{profileId}` docs are readable by any authenticated user but mutable only through backend automation (`request.auth.token.server == true`).
- Composite indexes (status + createdAt, connectorId + status + createdAt) unlock paginated history queries, while an `events` group index keeps timeline panes snappy.
- See `firebase/firestore.rules` and `firebase/firestore.indexes.json` for the exact implementation deployed to the `apt-agents` project.

## Deployment on Firebase
- **Hosting**: Build the Angular SSR bundle (`ng run apt-angular:serve-ssr`) and deploy via `firebase deploy --only hosting`. Configure rewrites to route `/api/**` to the Functions region so SSR + APIs share cookies.
- **Functions (2nd gen)**: Deploy `createAgentRun`, `issueCommand`, `listConnectors`, `agentStream` (SSE proxy), and scheduled maintenance jobs. Use the `minInstances` flag for low-latency command fan-out.
- **Cloud Run**: Deploy the Agent Executor as a separate service triggered by Cloud Tasks. Grant it `roles/firestore.user`, `roles/secretmanager.secretAccessor`, and connector-specific scopes.
- **Security**: Enforce App Check, Firebase Auth (or enterprise SSO) for frontend access. Use Firestore Security Rules to scope `agentRuns` to owners/collaborators and require Cloud Functions-generated custom claims for admin actions.

## Implementation Phases
1. **Modularize the Angular UI**: Introduce `AgentRunStore`, break the current `App` template into the modules outlined above, and wire SSR hydration through Firebase Hosting.
2. **Persistence foundation**: Define Firestore collections, indexes, and security rules. Implement AngularFire services + mock data to validate the UI before wiring real agents.
3. **Backend executor**: Build the Cloud Function + Cloud Run pipeline, reuse `AgentHost` to orchestrate actual agent runs, and emit run events into Firestore.
4. **Connector + MCP onboarding**: Ship the Connector Gallery + Wizard, integrate Secret Manager flows, and allow users to register external MCP servers.
5. **Archival + analytics**: Add Storage + BigQuery export jobs, TTL policies, and dashboards for run insights.

This design lets the Angular app stay lightweight and modular while Firebase handles hosting, auth, and real-time persistence. The Cloud Run executor ensures agents keep running after the browser closes, and the Firestore-centered metadata model keeps historical runs queryable even as new MCP connectors join the platform.
