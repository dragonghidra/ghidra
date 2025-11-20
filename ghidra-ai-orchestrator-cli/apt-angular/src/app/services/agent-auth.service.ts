import { isPlatformBrowser } from '@angular/common';
import { Injectable, effect, inject, signal, PLATFORM_ID } from '@angular/core';
import {
  Auth,
  User,
  authState,
  signInAnonymously,
  signOut,
  updateProfile
} from '@angular/fire/auth';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AgentAuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly auth = this.isBrowser ? inject(Auth) : null;
  private readonly userState = signal<User | null>(this.auth?.currentUser ?? null);
  private readonly loadingState = signal(true);

  readonly user = this.userState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  constructor() {
    if (!this.auth) {
      this.userState.set(null);
      this.loadingState.set(false);
      return;
    }

    authState(this.auth)
      .pipe(takeUntilDestroyed())
      .subscribe((user) => {
        this.userState.set(user);
        this.loadingState.set(false);
      });

    effect(() => {
      if (!this.userState() && !this.loadingState()) {
        this.ensureAnonymousSession().catch(() => {
        });
      }
    });
  }

  async ensureAnonymousSession(displayName?: string): Promise<void> {
    if (!this.auth) {
      return;
    }

    if (this.auth.currentUser) {
      if (displayName && !this.auth.currentUser.displayName) {
        await updateProfile(this.auth.currentUser, { displayName });
      }
      return;
    }

    this.loadingState.set(true);
    try {
      const credential = await signInAnonymously(this.auth);
      if (displayName) {
        await updateProfile(credential.user, { displayName });
      }
    } finally {
      this.loadingState.set(false);
    }
  }

  async signOut(): Promise<void> {
    if (!this.auth) {
      return;
    }

    await signOut(this.auth);
  }
}
