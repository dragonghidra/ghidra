# Firebase Hosting Deployment Plan for the Cloud Agent

This guide links the APT Angular dashboard, the Firebase-backed persistence model, and the APT CLI runtime so a background cloud agent can execute real work (tests, builds, deployments) while the UI streams live Firestore updates.

## Prerequisites

- Firebase project `apt-agents` with Hosting, Firestore, Functions, and Cloud Run APIs enabled.
- Local Firebase CLI + Admin credentials (service account JSON exported with `roles/editor` + `roles/firebase.admin`).
- Node.js 20+, npm, and the repo root checked out so both the CLI (`dist/bin/apt.js`) and the Angular workspace share the same files.

## 1. Configure Angular + Firebase

1. Populate both environment files with the production Firebase config (`src/environments/environment*.ts`). The Angular build now embeds the `apt-agents` API key so AngularFire can authenticate.
2. Keep `environment.defaults.projectId` in sync with the Firestore document you want to target so `AgentRunStore` points at the correct `projects/<id>/agentRuns` path.

## 2. Seed `projects/<id>` + connectors

Security rules in `firebase/firestore.rules` expect every authenticated user to have an explicit role under `projects/<id>.members`. The quickest bootstrap path is the helper that now ships inside the Functions workspace:

```bash
cd apt-angular/functions
npm install
GOOGLE_APPLICATION_CREDENTIALS=/path/to/admin.json \
npm run bootstrap:project -- --projectId=production --ownerUid=<uid> --member=<teammate:editor>
```

`scripts/bootstrap-project.mjs` writes:
- `projects/<id>` with `ownerUid`, `members`, `status: 'active'`, and timestamps.
- Default connectors under `projects/<id>/connectors`:
  - `mock-gateway` for deterministic demo transcripts.
  - `local-cli` to mirror a real APT CLI session via `npm run ui:cli -- apt --profile apt-code`.
  - `firebase-cloud-agent` describing the Cloud Run worker that can build + deploy the Angular SSR bundle, release Firebase Functions, and run repo health audits.

Run the script in every environment (dev, staging, prod) so the Angular UI and callable Functions share the same ACLs and connector catalog.

After seeding, the Angular Connector Gallery calls `listConnectors` to show each definition (status, runtime, playbooks) so operators can verify that the bootstrap step worked before they launch runs from the UI.

## 3. Cloud agent responsibilities

| Playbook | Trigger | What it does |
| --- | --- | --- |
| `repo_health_audit` | Manual or scheduled via Cloud Tasks | Launches the APT CLI through the `local-cli` connector, runs `npm run lint`, `npm test`, and emits coverage/artifact summaries into `projects/<id>/agentRuns/<runId>/events`. |
| `deploy_hosting_bundle` | Manual from Run Board (`createAgentRun`) or chained after a successful audit | Runs `ng build --configuration production` from `apt-angular`, uploads the SSR bundle to Firebase Hosting target `app`, and logs the deployment version + Hosting channel URL. |
| `functions_release` | Manual or after merges that touch `functions/src/**` | Executes `npm run build` inside `apt-angular/functions` and calls `firebase deploy --only functions` so callable APIs (`createAgentRun`, `issueCommand`, `listConnectors`, demo executor) stay in sync with TypeScript sources. |

Each playbook should be represented as a connector metadata entry (see `firebase-cloud-agent` in the bootstrap script) so the UI can surface which workflows exist and the backend can translate a run request into concrete steps.

## 4. Execution pipeline

1. **Run creation** – `functions/src/index.ts:createAgentRun` validates payloads against `AgentRunCreateSchema` and persists `status: queued` records under `projects/<id>/agentRuns`.
2. **Dispatch** – A Cloud Tasks queue (`agent-executor`) or Firestore trigger fans runs out to a Cloud Run service. The worker pulls the run metadata, loads the connector definition (mock/local CLI/cloud agent) from `projects/<id>/connectors`, and spins up the relevant executor.
3. **Agent runtime** – The worker wraps the existing `src/runtime/agentHost.ts` contract from the CLI package so multi-step tool execution stays identical in the cloud. Commands (from `projects/<id>/agentRuns/<runId>/commands`) flow back through Functions via `issueCommand`.
4. **Streaming + artifacts** – Worker writes incremental updates inside `projects/<id>/agentRuns/<runId>/events`, mirrors large assets (diffs, build logs) to Cloud Storage, and stores signed URLs inside the event payload. Firestore Security Rules already gate these writes to principals with the `runExecutor` custom claim.
5. **Completion** – Worker patches the run document with `status`, `startedAt`, `completedAt`, and any structured metrics so the Angular Run Board can filter and archive history efficiently.

## 5. Hosting + Functions deployment flow

1. **Firestore + Storage guardrails**
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
2. **Cloud Functions** (Node 22 runtime as defined in `firebase.json`):
   ```bash
   cd apt-angular/functions
   npm run build
   firebase deploy --only functions
   ```
3. **Angular SSR bundle to Hosting target `app`**:
   ```bash
   cd apt-angular
   npm run build
   firebase deploy --only hosting:app
   ```
4. **Cloud Run worker**:
   - Build an image that installs the repo root, calls `npm install && npm run build` for the CLI, and exposes an HTTP endpoint that receives Cloud Tasks payloads (projectId/runId/connectorId).
   - Grant the service account `roles/firestore.user`, `roles/cloudtasks.queueAdmin`, `roles/secretmanager.secretAccessor`, and `roles/firebasehosting.admin` (needed for CLI-driven deployments).
   - Wire a Cloud Scheduler or Firestore trigger to enqueue `repo_health_audit` runs nightly so the agent keeps exercising the repo.

## 6. Validation & rollback

- Use `firebase emulators:start --import <seed>` locally with the bootstrap script output to validate security rules before touching prod.
- After each deployment, run `npm start` in `apt-angular` to verify the Run Board lists `projects/<id>/agentRuns` and the connector gallery surfaces the newly seeded records.
- Firestore `projects/<id>` should show `ownerUid` + `members` in the console; connectors should include the three seeded entries plus any custom connectors you add later.
- Hosting rollout can be validated quickly via `firebase hosting:channel:deploy preview` before promoting to the live channel.
- Keep a GitHub Action or Cloud Build trigger ready to redeploy the previous Hosting release (`firebase hosting:rollback`) if the Angular bundle regresses.

This playbook keeps the repo, Firebase security model, and the APT runtime aligned so the “cloud agent” can perform useful work—running audits, shipping SSR bundles, and releasing Functions—while the Angular dashboard mirrors every step in real time.
