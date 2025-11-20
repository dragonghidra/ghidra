import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, Signal, computed, effect, inject, signal } from '@angular/core';
import {
  Firestore,
  QueryConstraint,
  collection,
  query,
  orderBy,
  limit,
  collectionData,
  DocumentData
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../environments/environment';
import { AgentAuthService } from './agent-auth.service';

export interface AgentRun {
  id: string;
  projectId: string;
  status: string;
  profileId: string;
  connectorId: string;
  prompt: string;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface AgentRunCreationResult {
  id: string;
  status: string;
}

@Injectable({ providedIn: 'root' })
export class AgentRunStore {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly firestore = this.isBrowser ? inject(Firestore) : null;
  private readonly functions = this.isBrowser ? inject(Functions) : null;
  private readonly auth = inject(AgentAuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly runsState = signal<AgentRun[]>([]);
  private readonly loadingState = signal(true);
  private readonly errorState = signal<string | null>(null);

  private readonly projectId = environment.defaults.projectId;

  readonly runs: Signal<AgentRun[]> = this.runsState.asReadonly();
  readonly isLoading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly hasRuns = computed(() => this.runsState().length > 0);

  private hasBound = false;

  constructor() {
    if (!this.isBrowser) {
      this.loadingState.set(false);
      return;
    }

    if (!this.projectId) {
      this.errorState.set('No default project configured in environment.defaults.projectId');
      this.loadingState.set(false);
      return;
    }

    effect(() => {
      const user = this.auth.user();
      const loading = this.auth.loading();

      if (loading) {
        this.loadingState.set(true);
        return;
      }

      if (!user) {
        this.loadingState.set(false);
        this.errorState.set('Sign in to view Firebase agent runs.');
        return;
      }

      if (!this.hasBound) {
        this.bindRunsFeed();
        this.hasBound = true;
      }
    });
  }

  private bindRunsFeed(): void {
    const firestore = this.firestore;
    if (!firestore) {
      this.errorState.set('Firebase Firestore is unavailable in this environment.');
      this.loadingState.set(false);
      return;
    }

    const baseRef = collection(firestore, `projects/${this.projectId}/agentRuns`);
    const constraints: QueryConstraint[] = [
      orderBy('createdAt', 'desc'),
      limit(50)
    ];

    collectionData(query(baseRef, ...constraints), { idField: 'id' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.runsState.set(data.map((doc) => this.deserializeRun(doc)));
          this.loadingState.set(false);
        },
        error: (err) => {
          this.errorState.set(err?.message ?? 'Unable to load agent runs');
          this.loadingState.set(false);
        }
      });
  }

  private deserializeRun(doc: DocumentData): AgentRun {
    const data = doc as Record<string, unknown>;
    return {
      id: (data['id'] as string) ?? '',
      projectId: (data['projectId'] as string) ?? '',
      status: (data['status'] as string) ?? 'queued',
      profileId: (data['profileId'] as string) ?? '',
      connectorId: (data['connectorId'] as string) ?? '',
      prompt: (data['prompt'] as string) ?? '',
      createdBy: (data['createdBy'] as string) ?? '',
      createdAt: this.normalizeTimestamp(data['createdAt']),
      updatedAt: this.normalizeTimestamp(data['updatedAt']),
      startedAt: this.normalizeTimestamp(data['startedAt']),
      completedAt: this.normalizeTimestamp(data['completedAt'])
    };
  }

  private normalizeTimestamp(value: unknown): Date | undefined {
    if (!value) {
      return undefined;
    }
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      try {
        return (value as { toDate: () => Date }).toDate();
      } catch {
        return undefined;
      }
    }
    return value instanceof Date ? value : undefined;
  }

  async createRun(prompt: string): Promise<AgentRunCreationResult> {
    const functions = this.functions;
    if (!functions) {
      throw new Error('Connect to the Firebase Functions backend to create runs.');
    }

    await this.auth.ensureAnonymousSession();

    const callable = httpsCallable(functions, 'createAgentRun');
    const payload = {
      projectId: this.projectId,
      profileId: environment.defaults.profileId,
      connectorId: environment.defaults.connectorId,
      prompt
    };

    const response = await callable(payload);
    const { data } = response as { data: AgentRunCreationResult };
    return data;
  }
}
