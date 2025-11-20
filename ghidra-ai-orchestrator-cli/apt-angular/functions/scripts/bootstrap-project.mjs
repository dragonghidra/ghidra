#!/usr/bin/env node
import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

function parseArgs(argv) {
  const result = { member: [], seedConnectors: 'true' };
  for (const token of argv) {
    if (!token.startsWith('--')) {
      continue;
    }
    const [rawKey, rawValue] = token.slice(2).split('=');
    const key = rawKey.trim();
    if (key === 'member') {
      if (rawValue) {
        result.member.push(rawValue.trim());
      }
      continue;
    }
    result[key] = rawValue === undefined ? 'true' : rawValue.trim();
  }
  return result;
}

function coerceRole(role) {
  if (!role) {
    return 'viewer';
  }
  const normalized = role.toLowerCase();
  if (['admin', 'editor', 'viewer'].includes(normalized)) {
    return normalized;
  }
  console.warn(`Unknown role "${role}" provided. Falling back to 'viewer'.`);
  return 'viewer';
}

function applyMemberArgs(ownerUid, memberArgs) {
  const members = { [ownerUid]: 'admin' };
  for (const entry of memberArgs) {
    const [uid, role] = entry.split(':');
    if (!uid) {
      continue;
    }
    members[uid] = coerceRole(role);
  }
  return members;
}

function defaultConnectors(projectId) {
  return [
    {
      id: 'mock-gateway',
      name: 'Mock Gateway',
      kind: 'mock',
      description: 'Streams deterministic demo transcripts so the Angular UI can be validated without live backends.',
      status: 'ready',
      metadata: {
        sampleRuns: 3,
        emitsArtifacts: false
      }
    },
    {
      id: 'local-cli',
      name: 'Local APT CLI Bridge',
      kind: 'local-cli',
      description: 'Spawns the APT CLI from this repo so you can mirror real workstation sessions into Firestore.',
      status: 'ready',
      metadata: {
        command: 'npm run ui:cli -- apt --profile apt-code',
        cwd: process.env.LOCAL_CLI_CWD ?? '$REPO_ROOT',
        requiresSsh: false,
        forwardsStdIn: true
      }
    },
    {
      id: 'firebase-cloud-agent',
      name: 'Firebase Cloud Agent',
      kind: 'cloud-agent',
      description:
        'Cloud Run worker that uses src/runtime/agentHost.ts to execute longer workflows, validate repos, and deploy the Angular SSR bundle to Firebase Hosting.',
      status: 'ready',
      metadata: {
        projectId,
        runtime: 'cloud-run',
        taskQueue: 'agent-executor',
        supportedPlaybooks: [
          {
            id: 'repo_health_audit',
            description: 'Runs lint + unit tests via the APT CLI, writes summaries to projects/<id>/agentRuns events.',
            actions: ['npm run lint', 'npm test', 'upload coverage diff artifact']
          },
          {
            id: 'deploy_hosting_bundle',
            description: 'Builds Angular SSR output and deploys to Firebase Hosting target "app".',
            actions: ['npm run build --workspace apt-angular', 'firebase deploy --only hosting:app']
          },
          {
            id: 'functions_release',
            description: 'Compiles /functions (Node 22) and deploys callable APIs.',
            actions: ['cd apt-angular/functions', 'npm run build', 'firebase deploy --only functions']
          }
        ],
        observability: {
          runEvents: true,
          storageArtifacts: true
        }
      }
    }
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args.projectId;
  const ownerUid = args.ownerUid;

  if (!projectId || !ownerUid) {
    console.error('Usage: npm run bootstrap:project -- --projectId=<id> --ownerUid=<uid> [--member=<uid:role>]');
    process.exit(1);
  }

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: args.firebaseProject ?? process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT
    });
  }

  const firestore = admin.firestore();
  const members = applyMemberArgs(ownerUid, args.member ?? []);

  const projectDoc = {
    ownerUid,
    members,
    status: 'active',
    updatedAt: FieldValue.serverTimestamp()
  };

  if (args.projectName) {
    projectDoc.name = args.projectName;
  }
  if (args.ownerEmail) {
    projectDoc.ownerEmail = args.ownerEmail;
  }

  await firestore.doc(`projects/${projectId}`).set(projectDoc, { merge: true });
  console.log(`Ensured projects/${projectId} exists with ${Object.keys(members).length} member(s).`);

  if (args.seedConnectors !== 'false') {
    const connectors = defaultConnectors(projectId);
    const connectorCollection = firestore.collection(`projects/${projectId}/connectors`);
    for (const connector of connectors) {
      await connectorCollection.doc(connector.id).set(
        {
          ...connector,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }
    console.log(`Seeded ${connectors.length} connector definitions.`);
  } else {
    console.log('Skipping connector seeding because --seedConnectors=false');
  }
}

main().catch((error) => {
  console.error('Failed to bootstrap project document:', error);
  process.exit(1);
});
