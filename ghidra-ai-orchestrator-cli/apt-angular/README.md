# Angular SSR APT mirror

> Commands in this document assume you are inside the `apt-angular/` folder at the repo root.

This app mirrors the dual-profile feed that the APT CLI (general + APT Code) prints inside the terminal. Angular now runs in SSR mode so the Express host can keep an in-process session open with whatever agent backend you point it at (local CLI, mock data, or a remote Cloud Run instance).

## Quick start

```bash
npm install
npm run dev:ssr
# http://localhost:4200 mirrors the mock CLI feed
```

Need a live feed from your real workspace? This package already links the sibling `apt-ui-cli` module, so you can spin up the CLI bridge directly:

```bash
npm run ui:cli -- diag
```

From the repo root you can also run `./scripts/full-stack.sh` to automate the installation + build + SSR launch process. The script wires `apt-ui` into the backend using `AGENT_SOURCE=local-cli`, so the dashboard is immediately connected to a live APT session without any manual environment juggling.

The `ui:cli` script behaves like running `apt-ui` globally—you can forward any APT CLI arguments after the `--`.

When you are ready to share or test production output, build everything once and boot the compiled server entry:

```bash
npm run build
npm run serve:ssr
```

## MVP front end helpers

The SSR bundle now includes three surfaces that make the Firebase agent workflow useful long before you deploy anything:

1. **Terminal mirror** – the hero grid mirrors the APT CLI (general + APT Code) (mock data by default or the real CLI when you flip `AGENT_SOURCE=local-cli`).
2. **Run Board** – backed by Firebase Auth/Firestore via `AgentRunStore`. Once you populate `projects/<id>` it streams `agentRuns`, shows prompts/statuses, and lets you call `createAgentRun` directly from the page.
3. **Connector gallery** – a new section under the Run Board that calls the `listConnectors` callable and renders every connector + playbook your project exposes. Use the refresh button to pull updates or troubleshoot missing playbooks.

Both the Run Board and the connector cards rely on the bootstrap script below so make sure `projects/<id>` exists before expecting real data.

## Firebase Hosting & Background Agents

The Angular bundle now ships with Firebase scaffolding so you can deploy the SSR UI and a basic background agent that streams run metadata to Firestore.

1. Fill in the Firebase web config inside `src/environments/environment.ts` (prod) and `src/environments/environment.development.ts` (local emulator). Set `defaults.projectId` to a project document that exists in Firestore with your UID mapped to `admin` in `members`.
2. Bootstrap the Firestore `projects/<id>` document and default connector catalog so security rules have something to validate:
   ```bash
   cd functions
   npm install
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/admin.json \\
   npm run bootstrap:project -- --projectId=demo --ownerUid=<your-uid> --member=<collaborator:editor>
   ```
   The script lives in `functions/scripts/bootstrap-project.mjs` and seeds a mock gateway, the local APT CLI bridge, and a `firebase-cloud-agent` connector that knows how to deploy Hosting + Functions.
3. Install AngularFire + Firebase deps (`npm install`) and run `npm start` to verify the Run Board pulls data from `projects/<id>/agentRuns`.
4. Deploy the Firestore/Storage rules and indexes:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
5. Deploy Cloud Functions (includes `createAgentRun`, `issueCommand`, `listConnectors`, and the demo executor that marks queued runs as `succeeded` with sample events):
   ```bash
   cd functions
   npm install
   npm run build
   firebase deploy --only functions
   ```
6. Deploy Hosting once SSR output is ready:
   ```bash
   npm run build
   firebase deploy --only hosting
   ```

Launching a run from the new Run Board automatically calls `createAgentRun` via Firebase Functions, and the `demoAgentExecutor` trigger creates placeholder events so you can validate persistence + security rules before wiring real MCP connectors.

## Session access & modular renderers

- The server now supports pluggable session access policies. Set `SESSION_ACCESS_MODE` to `public`, `firebase`, or `passphrase`. For passphrase-gated runs, provide `SESSION_PASSPHRASE`. Use the new `/api/session/:id/access` endpoint to exchange a passphrase or Firebase ID token for a short-lived HttpOnly cookie. The Angular mirror automatically calls this endpoint whenever you update credentials, so SSE connections never leak secrets via query strings.
- Open the “Session settings” drawer (top of the hero) to manage session id, passphrase, and Firebase tokens. If you expose a Firebase config via `window.APT_FIREBASE_CONFIG` the drawer enables a Google sign-in button; the resulting ID token is forwarded to the backend and stored securely via cookies.
- Multiple session runtimes can coexist via the `SessionRegistry`. Each runtime keeps its own orchestrator, gateway (mock/local CLI/mirror/remote/persistent), and access controller so you can mirror a local CLI session while also relaying a hosted agent.
- Message rendering is now modular. `MessageRendererRegistryService` routes each `ChatMessage` through the first renderer whose predicate matches, so connector-specific visualizations can ship as standalone Angular modules without touching `app.html`. `DefaultChatMessageRendererComponent` keeps the tmux-inspired layout for standard output, while custom renderers can focus on structured payloads.
- Tools can attach structured metadata via the new `extensions` field on `ChatMessage` or by emitting `SessionEvent` entries of type `extension`. The Angular UI renders these blocks through the `ExtensionRendererRegistryService`; add-on packages can register bespoke components the same way the default renderer does.

## Pluggable persistence sources

Set `AGENT_SOURCE` to choose which backend drives the session mirror:

- `jsonl-store` – Fetches an append-only JSONL feed (e.g., S3/GCS object) and polls it for new `SessionEvent` lines. Configure with `JSONL_STORE_URL`, `JSONL_STORE_POLL_MS`, and optional `JSONL_STORE_LABEL`.
- `redis-stream` – Tails a Redis stream (`XADD` records with an `event` field) and forwards entries as session events. Configure `REDIS_STREAM_URL`, `REDIS_STREAM_KEY`, and optionally `REDIS_STREAM_POLL_MS` / `REDIS_STREAM_LABEL`.
- `temporal-workflow` – Reads workflow history from any HTTP endpoint that returns `{ snapshot, events }` JSON and optionally relays commands via `TEMPORAL_COMMAND_URL`. Set `TEMPORAL_HISTORY_URL`, `TEMPORAL_POLL_MS`, and `TEMPORAL_LABEL`.

All persistence adapters plug into `SessionRegistry`, so switching from the local CLI to a hosted Redis stream is a one-line environment change with no Angular/UI refactors.

### HMR via `ng serve`

If you prefer Angular's hot-module reloading, keep the apt-ui backend running (for example `npm run dev:ssr` or any other process that exposes the `/api/session` endpoints) and start `ng serve` in a second terminal:

```bash
# optional: override the backend URL (defaults to http://localhost:4000)
export APT_UI_BACKEND_URL=http://localhost:4000
npm start
```

The CLI dev server now proxies `/api/**` requests and the SSE stream to the backend, so the standalone frontend stays fully wired to live workspace data.

## Runtime overview

```
┌─────────────────────┐    SSE / REST      ┌──────────────────────────┐
│ Angular SSR (App)   │╌╌╌╌╌╌╌╌╌╌╌╌╌╌▶ │ SessionOrchestrator        │
│  AgentSessionService│◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐│  (src/backend/session/*)  │
└─────────────────────┘                    │        │                 │
                                           │        ▼                 │
                                           │  AgentGateway (mock /    │
                                           │  local-cli / remote)     │
                                           └────────┬─────────────────┘
                                                    │
                                         child_process / HTTP / mocks
```

- `src/backend/session/session-orchestrator.ts` keeps an in-memory snapshot of the current chat feed, telemetry meters, and shortcuts.
- `src/backend/gateways/*` exposes pluggable connectors:
  - `MockGateway` streams the same scripted data the UI originally shipped with.
  - `LocalCliGateway` spawns your local `apt --profile <name> --json …` (or any CLI that emits line-delimited JSON) and forwards stdout/stderr into the session.
  - `RemoteAgentGateway` polls a remote HTTP endpoint (for Cloud Run or another SSR host) so you can daisy-chain APT mirrors.
- `src/server.ts` exposes three REST endpoints that the Angular side consumes:
  - `GET /api/session` returns the latest snapshot used for SSR + hydration.
  - `GET /api/session/stream` is a server-sent-events channel for real-time mirror updates.
  - `POST /api/session/commands` pushes terminal input back to the upstream gateway (local CLI stdin today).
- `src/app/services/agent-session.service.ts` is the single client entry point. It bootstraps via HTTP during SSR, opens the SSE stream when running in the browser, and publishes Angular signals that the rest of the component tree consumes.

## Switching data sources

| Mode          | Env                                 | Notes                                                                                   |
|---------------|-------------------------------------|-----------------------------------------------------------------------------------------|
| Mock (default)| _none_                              | Uses the scripted chatfeed that shipped with the static page.                           |
| Local CLI     | `AGENT_SOURCE=local-cli`            | Spawns whatever command you pass through `LOCAL_CLI_COMMAND`. Works best with JSON logs.|
| Mirror file   | `AGENT_SOURCE=mirror-file`          | Tails the `.jsonl` mirror written by `apt-ui` / APT CLI for a read-only replay. |
| Remote cloud  | `AGENT_SOURCE=remote-cloud`         | Polls another SSR host that already exposes `/api/session`. Useful for Cloud Run.       |

### Local CLI bridge

```bash
AGENT_SOURCE=local-cli \
LOCAL_CLI_COMMAND="apt --profile apt-code --json" \
LOCAL_CLI_CWD=$PWD \
npm run serve:ssr
```

Because the repo already links `apt-ui`, you can also drive the CLI through the helper script and keep arguments scoped to this workspace:

```bash
AGENT_SOURCE=local-cli \
LOCAL_CLI_COMMAND="npm run ui:cli -- apt --profile general --json" \
LOCAL_CLI_CWD=$HOME/GitHub/project \
npm run serve:ssr
```

Flags you can use:

- `LOCAL_CLI_JSON` (default `true`): set to `false` to treat stdout as plain text instead of NDJSON.
- `LOCAL_CLI_ENV='{"OPENAI_API_KEY":"..."}'`: JSON stringified env vars forwarded to the spawned process.
- `SESSION_ID`: override the label shown in the UI.

The gateway writes whatever you type into the browser input back to the CLI process via stdin, so you can keep any APT CLI profile running headless and steer it from the mirror.

### Remote mirrors / Cloud Run

```
AGENT_SOURCE=remote-cloud \
REMOTE_AGENT_URL="https://apt-cloud-run.example.com" \
REMOTE_AGENT_TOKEN="bearer token if needed" \
npm run serve:ssr
```

The remote instance just needs to expose the same `/api/session` + `/api/session/stream` contract, so you can chain SSR pods or attach to `apt share --live` output.

### Mirror an existing APT CLI session

Launch APT CLI through `apt-ui` (or any process that writes the JSONL mirror) and point the Angular server at the file it prints in the banner:

```
AGENT_SOURCE=mirror-file \
APT_UI_MIRROR_FILE=/Users/bo/GitHub/workspace/.apt-ui/mirror/apt-2025-11-16T17-20-58-852Z.jsonl \
npm run dev:ssr
```

The backend tails the log, emits every stdout/stderr line as chat messages, and surfaces process lifecycle events in the ops panel. Set `APT_UI_SESSION_ID` (or `SESSION_ID`) if you want the dashboard to label the session differently from the filename. If you omit `APT_UI_MIRROR_FILE` the server now looks for the newest `.jsonl` inside `<workspace>/.apt-ui/mirror/`, where the workspace is derived from `APT_UI_WORKSPACE`, `WORKSPACE`, or the current working directory. That means you can simply run `apt-ui` in the same repo and start the Angular server without any extra configuration—the freshest mirror file will be picked up automatically.

## Angular notes

- `npm run dev:ssr` runs the hybrid dev server (browser+server bundles + Express host).
- `App` is now a thin template-only shell; all real data flows through `AgentSessionService`.
- Signals keep the DOM in sync as SSE events arrive, so the UI behaves like the tmux feed you see in APT CLI.
- Tailwind styles live in `src/app/app.css` and target the new banners/status badges that visualize connection state.

Feel free to add additional gateways (gRPC, WebSocket, etc.) by implementing `AgentGateway` and registering it inside `src/backend/session/orchestrator-factory.ts`.
