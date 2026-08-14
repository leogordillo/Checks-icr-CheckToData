import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error';

export interface Toast {
  kind: ToastKind;
  title: string;
  body?: string;
}

/** How long a toast stays up before dismissing itself. */
const AUTO_DISMISS_MS = 6000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly current = signal<Toast | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly toast = this.current.asReadonly();

  show(toast: Toast): void {
    this.clearTimer();
    this.current.set(toast);
    this.timer = setTimeout(() => this.dismiss(), AUTO_DISMISS_MS);
  }

  success(title: string, body?: string): void {
    this.show({ kind: 'success', title, body });
  }

  error(title: string, body?: string): void {
    this.show({ kind: 'error', title, body });
  }

  dismiss(): void {
    this.clearTimer();
    this.current.set(null);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
