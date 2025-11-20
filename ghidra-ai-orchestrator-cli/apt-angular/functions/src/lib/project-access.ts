import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export type ProjectRole = 'admin' | 'editor' | 'viewer';

export interface ProjectDocument {
  ownerUid: string;
  members: Record<string, ProjectRole>;
  status?: 'active' | 'archived';
}

export interface ProjectAssertion {
  project: ProjectDocument;
  role: ProjectRole;
}

export async function assertProjectRole(
  firestore: Firestore,
  projectId: string,
  uid: string,
  allowed: ProjectRole[]
): Promise<ProjectAssertion> {
  const snapshot = await firestore.doc(`projects/${projectId}`).get();
  if (!snapshot.exists) {
    throw new HttpsError('not-found', `Project ${projectId} does not exist`);
  }

  const project = snapshot.data() as ProjectDocument;
  if (!project.members) {
    throw new HttpsError('permission-denied', 'Project membership has not been configured');
  }

  const role = project.members[uid];
  if (!role || !allowed.includes(role)) {
    throw new HttpsError('permission-denied', 'You do not have sufficient access to this project');
  }

  if (project.status === 'archived') {
    throw new HttpsError('failed-precondition', 'Project is archived');
  }

  return { project, role };
}

export async function assertProjectMember(
  firestore: Firestore,
  projectId: string,
  uid: string
): Promise<ProjectAssertion> {
  return assertProjectRole(firestore, projectId, uid, ['admin', 'editor', 'viewer']);
}

export function buildProjectRunRef(firestore: Firestore, projectId: string, runId?: string) {
  const runs = firestore.collection(`projects/${projectId}/agentRuns`);
  return runId ? runs.doc(runId) : runs.doc();
}

export function buildProjectConnectorRef(firestore: Firestore, projectId: string, connectorId?: string) {
  const connectors = firestore.collection(`projects/${projectId}/connectors`);
  return connectorId ? connectors.doc(connectorId) : connectors.doc();
}
