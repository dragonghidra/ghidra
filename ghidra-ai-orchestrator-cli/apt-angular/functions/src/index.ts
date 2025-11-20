import admin from 'firebase-admin';
import { DocumentReference, FieldValue, Firestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { AgentCommandSchema, AgentRunCreateSchema, AgentRunFiltersSchema } from './lib/run-schemas.js';
import { assertProjectMember, assertProjectRole, buildProjectRunRef } from './lib/project-access.js';

setGlobalOptions({
  region: 'us-central1',
  memory: '512MiB',
  maxInstances: 20
});

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const firestore: Firestore = admin.firestore();

export const createAgentRun = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in');
  }

  const payload = AgentRunCreateSchema.parse(request.data);
  await assertProjectRole(firestore, payload.projectId, request.auth.uid, ['admin', 'editor']);

  const runRef = buildProjectRunRef(firestore, payload.projectId);
  const now = FieldValue.serverTimestamp();

  await runRef.set({
    projectId: payload.projectId,
    profileId: payload.profileId,
    connectorId: payload.connectorId,
    createdBy: request.auth.uid,
    status: 'queued',
    metadata: payload.metadata ?? {},
    schedule: payload.schedule ?? null,
    prompt: payload.prompt,
    createdAt: now,
    updatedAt: now
  });

  return {
    id: runRef.id,
    status: 'queued'
  };
});

export const issueCommand = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in');
  }

  const payload = AgentCommandSchema.parse(request.data);
  await assertProjectMember(firestore, payload.projectId, request.auth.uid);

  const commandsRef = firestore
    .collection(`projects/${payload.projectId}/agentRuns/${payload.runId}/commands`)
    .doc();

  await commandsRef.set({
    text: payload.text,
    kind: payload.kind,
    authorUid: request.auth.uid,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp()
  });

  return { id: commandsRef.id };
});

export const listConnectors = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in');
  }

  const payload = AgentRunFiltersSchema.pick({ projectId: true }).parse(request.data);
  await assertProjectMember(firestore, payload.projectId, request.auth.uid);

  const snapshot = await firestore.collection(`projects/${payload.projectId}/connectors`).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
});

export const agentApi = onRequest(async (req: Request, res: Response) => {
  if (req.path === '/health') {
    res.json({ status: 'ok' });
    return;
  }

  res.status(404).json({ error: 'Endpoint not implemented yet' });
});

export const ssrApp = onRequest(async (_req: Request, res: Response) => {
  res.status(501).send('SSR handler not wired yet. Deploy the Angular SSR bundle to Cloud Run.');
});

export const demoAgentExecutor = onDocumentCreated(
  'projects/{projectId}/agentRuns/{runId}',
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }

    const run = snapshot.data();
    if (!run || run.status !== 'queued') {
      return;
    }

    const runRef = snapshot.ref;
    await runRef.update({
      status: 'running',
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    await appendRunEvent(runRef, {
      type: 'log',
      level: 'info',
      message: `demo agent ${snapshot.id} booted via Cloud Functions`,
      createdAt: FieldValue.serverTimestamp()
    });

    await appendRunEvent(runRef, {
      type: 'message',
      role: 'assistant',
      content: `Pretending to work on: ${run.prompt}`,
      createdAt: FieldValue.serverTimestamp()
    });

    await runRef.update({
      status: 'succeeded',
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }
);

async function appendRunEvent(runRef: DocumentReference, payload: Record<string, unknown>) {
  await runRef.collection('events').doc().set(payload);
}
