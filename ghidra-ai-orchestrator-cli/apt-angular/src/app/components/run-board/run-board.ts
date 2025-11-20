import { Component, computed, inject, signal } from '@angular/core';
import { NgClass, NgFor, NgIf, DatePipe } from '@angular/common';
import { AgentRunStore } from '../../services/agent-run.store';

@Component({
  selector: 'app-run-board',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, DatePipe],
  templateUrl: './run-board.html',
  styleUrls: ['./run-board.css']
})
export class RunBoardComponent {
  private readonly store = inject(AgentRunStore);

  protected readonly runs = this.store.runs;
  protected readonly isLoading = this.store.isLoading;
  protected readonly error = this.store.error;
  protected readonly prompt = signal('');
  protected readonly creating = signal(false);

  protected statusClass = computed(() => {
    return (status: string) => {
      switch (status) {
        case 'succeeded':
          return 'status-pill--success';
        case 'running':
        case 'streaming':
          return 'status-pill--info';
        case 'failed':
          return 'status-pill--danger';
        default:
          return 'status-pill--muted';
      }
    };
  });

  protected onPromptInput(event: Event): void {
    this.prompt.set((event.target as HTMLInputElement).value);
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const trimmed = this.prompt().trim();
    if (!trimmed || this.creating()) {
      return;
    }

    this.creating.set(true);
    try {
      await this.store.createRun(trimmed);
      this.prompt.set('');
    } finally {
      this.creating.set(false);
    }
  }
}
