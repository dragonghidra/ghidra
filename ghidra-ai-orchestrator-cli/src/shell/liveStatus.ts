export type LiveStatusTone = 'info' | 'success' | 'warning' | 'danger';

export interface LiveStatusState {
  text: string;
  detail?: string;
  tone?: LiveStatusTone;
  startedAt: number;
}

export type LiveStatusListener = (state: LiveStatusState | null) => void;

interface LiveStatusOptions {
  tone?: LiveStatusTone;
  detail?: string;
}

export class LiveStatusTracker {
  private base: LiveStatusState | null = null;
  private readonly overrides = new Map<string, LiveStatusState>();
  private readonly overrideOrder: string[] = [];
  private readonly listeners = new Set<LiveStatusListener>();

  subscribe(listener: LiveStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  setBase(text: string | null, options: LiveStatusOptions = {}): void {
    if (!text?.trim()) {
      this.base = null;
      this.emit();
      return;
    }
    this.base = this.buildState(text, options);
    this.emit();
  }

  pushOverride(id: string, text: string, options: LiveStatusOptions = {}): void {
    if (!id?.trim() || !text?.trim()) {
      return;
    }
    this.overrides.set(id, this.buildState(text, options));
    if (!this.overrideOrder.includes(id)) {
      this.overrideOrder.push(id);
    }
    this.emit();
  }

  clearOverride(id: string): void {
    if (!id?.trim()) {
      return;
    }
    this.overrides.delete(id);
    const index = this.overrideOrder.indexOf(id);
    if (index >= 0) {
      this.overrideOrder.splice(index, 1);
    }
    this.emit();
  }

  clearOverrides(): void {
    this.overrides.clear();
    this.overrideOrder.length = 0;
    this.emit();
  }

  reset(): void {
    this.base = null;
    this.clearOverrides();
  }

  private currentState(): LiveStatusState | null {
    for (let index = this.overrideOrder.length - 1; index >= 0; index -= 1) {
      const id = this.overrideOrder[index]!;
      const state = this.overrides.get(id);
      if (state) {
        return state;
      }
    }
    return this.base;
  }

  private buildState(text: string, options: LiveStatusOptions): LiveStatusState {
    return {
      text: text.trim(),
      detail: options.detail?.trim() || undefined,
      tone: options.tone,
      startedAt: Date.now(),
    };
  }

  private emit(): void {
    const state = this.currentState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
