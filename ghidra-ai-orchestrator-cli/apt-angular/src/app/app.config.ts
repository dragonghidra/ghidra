import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth, connectAuthEmulator, signInAnonymously } from '@angular/fire/auth';
import { provideFirestore, getFirestore, connectFirestoreEmulator } from '@angular/fire/firestore';
import { provideFunctions, getFunctions, connectFunctionsEmulator } from '@angular/fire/functions';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const auth = getAuth();
      if (environment.emulator?.auth) {
        connectAuthEmulator(auth, `http://${environment.emulator.auth.host}:${environment.emulator.auth.port}`, {
          disableWarnings: true
        });
      }

      if (!auth.currentUser) {
        signInAnonymously(auth).catch(() => {
        });
      }
      return auth;
    }),
    provideFirestore(() => {
      const firestore = getFirestore();
      if (environment.emulator?.firestore) {
        connectFirestoreEmulator(
          firestore,
          environment.emulator.firestore.host,
          environment.emulator.firestore.port
        );
      }
      return firestore;
    }),
    provideFunctions(() => {
      const functions = getFunctions(undefined, environment.defaults.region);
      if (environment.emulator?.functions) {
        connectFunctionsEmulator(
          functions,
          environment.emulator.functions.host,
          environment.emulator.functions.port
        );
      }
      return functions;
    })
  ]
};