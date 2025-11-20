import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, Signal, effect, inject, signal } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { environment } from '../../environments/environment';
import { AgentAuthService } from './agent-auth.service';

export interface AgentConnector {
  id: string;
  name: string;
  kind: string;
  status: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface ListConnectorsPayload {
  projectId: string;
}

@Injectable({ providedIn: 'root' })
export class AgentConnectorStore {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly functions = this.isBrowser ? inject(Functions) : null;
  private readonly auth = inject(AgentAuthService);

  private readonly connectorsState = signal<AgentConnector[]>([]);
  private readonly loadingState = signal(true);
  private readonly errorState = signal<string | null>(null);

  private readonly projectId = environment.defaults.projectId;
  private readonly listConnectorsFn = this.functions
    ? httpsCallable<ListConnectorsPayload, AgentConnector[]>(this.functions, 'listConnectors')
    : null;

  private hasFetched = false;

  readonly connectors: Signal<AgentConnector[]> = this.connectorsState.asReadonly();
  readonly isLoading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  constructor() {
    if (!this.isBrowser || !this.listConnectorsFn) {
      this.loadingState.set(false);
      return;
    }

    if (!this.projectId) {
      this.errorState.set('Set environment.defaults.projectId to load connector metadata.');
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
        this.errorState.set('Sign in to view available connectors.');
        return;
      }

      if (!this.hasFetched) {
        this.refresh().catch(() => {
        });
      }
    });
  }

  async refresh(): Promise<void> {
    const listConnectorsFn = this.listConnectorsFn;
    if (!this.projectId || !listConnectorsFn) {
      return;
    }

    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      await this.auth.ensureAnonymousSession();
      const response = await listConnectorsFn({ projectId: this.projectId });
      const connectors = Array.isArray(response.data) ? response.data : [];
      this.connectorsState.set(connectors);
      this.hasFetched = true;
    } catch (error) {
      this.errorState.set(
        error instanceof Error ? error.message : 'Unable to load connector metadata from Firebase.'
      );
    } finally {
      this.loadingState.set(false);
    }
  }
}
