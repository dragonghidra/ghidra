import type { FirebaseOptions } from '@angular/fire/app';

type EmulatorHost = {
  host: string;
  port: number;
};

type EmulatorConfig = {
  auth: EmulatorHost;
  firestore: EmulatorHost;
  functions: EmulatorHost;
};

type EnvironmentConfig = {
  production: boolean;
  firebase: FirebaseOptions;
  defaults: {
    projectId: string;
    profileId: string;
    connectorId: string;
    region: string;
  };
  emulator: EmulatorConfig | null;
};

const firebaseConfig: FirebaseOptions = {
  apiKey: 'AIzaSyCGz7NZd38ZY8hJkB26ej2oUCdPgJo6eiA',
  authDomain: 'apt-agents.firebaseapp.com',
  projectId: 'apt-agents',
  storageBucket: 'apt-agents.firebasestorage.app',
  messagingSenderId: '392993175297'
};

export const environment: EnvironmentConfig = {
  production: true,
  firebase: firebaseConfig,
  defaults: {
    projectId: 'default-project',
    profileId: 'apt-code',
    connectorId: 'mock-gateway',
    region: 'us-central1'
  },
  emulator: null
};
