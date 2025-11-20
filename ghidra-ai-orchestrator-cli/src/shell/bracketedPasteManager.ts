const BRACKETED_PASTE_START = '\u001b[200~';
const BRACKETED_PASTE_END = '\u001b[201~';

export interface BracketedPasteResult {
  handled: boolean;
  result?: string;
}

/**
 * Collects bracketed paste fragments emitted by readline.
 * The terminal wraps clipboard content between start/end sequences
 * so this helper rebuilds the original multi-line block and hands
 * one normalized string back to the shell once the closing marker
 * arrives. When support is disabled, it simply reports that the
 * line should flow through the legacy heuristic path.
 */
export class BracketedPasteManager {
  private readonly enabled: boolean;
  private active = false;
  private bufferedParts: string[] = [];
  private pendingOutput = '';
  private pendingNewline = false;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  process(line: string): BracketedPasteResult {
    if (!this.enabled) {
      return { handled: false };
    }

    let cursor = line;
    let touched = this.active;

    while (true) {
      if (this.active) {
        if (this.pendingNewline) {
          this.bufferedParts.push('\n');
          this.pendingNewline = false;
        }

        const endIndex = cursor.indexOf(BRACKETED_PASTE_END);
        if (endIndex === -1) {
          this.bufferedParts.push(cursor);
          this.pendingNewline = true;
          return { handled: true };
        }

        const chunk = cursor.slice(0, endIndex);
        this.bufferedParts.push(chunk);
        this.pendingOutput += this.bufferedParts.join('');
        this.bufferedParts = [];
        this.active = false;
        cursor = cursor.slice(endIndex + BRACKETED_PASTE_END.length);
        touched = true;
        continue;
      }

      const startIndex = cursor.indexOf(BRACKETED_PASTE_START);
      if (startIndex === -1) {
        if (touched) {
          this.pendingOutput += cursor;
          const result = this.pendingOutput;
          this.pendingOutput = '';
          return { handled: true, result };
        }

        return { handled: false };
      }

      touched = true;
      this.pendingOutput += cursor.slice(0, startIndex);
      cursor = cursor.slice(startIndex + BRACKETED_PASTE_START.length);
      this.active = true;
      this.bufferedParts = [];
      this.pendingNewline = false;

      if (!cursor.length) {
        this.pendingNewline = true;
        return { handled: true };
      }
    }
  }

  reset(): void {
    this.active = false;
    this.bufferedParts = [];
    this.pendingOutput = '';
    this.pendingNewline = false;
  }
}
