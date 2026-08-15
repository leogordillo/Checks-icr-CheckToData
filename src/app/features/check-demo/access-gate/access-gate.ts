import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { DemoAccessService } from '../../../core/demo-access.service';
import { I18nService } from '../../../core/i18n.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Lenient on purpose: the canonical form is normalized server-side. */
const KEY_RE = /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/;

export type GateMode = 'register' | 'key' | 'limit';

/**
 * Modal that gates demo executions behind an emailed access key.
 *
 * Three steps: `register` (name/company/email → key sent by mail), `key` (type
 * the received key; validated against the server without consuming quota) and
 * `limit` (key expired or out of runs → CTA to the contact section).
 */
@Component({
  selector: 'app-access-gate',
  imports: [FormsModule],
  templateUrl: './access-gate.html',
  styleUrl: './access-gate.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccessGateComponent {
  protected readonly i18n = inject(I18nService);
  private readonly access = inject(DemoAccessService);

  readonly mode = input.required<GateMode>();
  readonly limitReason = input<'expired' | 'exhausted'>('exhausted');

  /** The visitor now holds a valid key — the caller resumes the pending run. */
  readonly unlocked = output<void>();
  readonly closed = output<void>();

  protected readonly step = signal<GateMode | null>(null);
  /** input() is the initial step; the signal tracks in-modal navigation. */
  protected readonly activeStep = computed<GateMode>(() => this.step() ?? this.mode());

  protected name = '';
  protected company = '';
  protected email = '';
  protected website = ''; // honeypot — hidden from real users
  protected keyInput = '';

  protected readonly busy = signal(false);
  protected readonly registerError = signal<string | null>(null);
  protected readonly fieldErrors = signal<{ name?: boolean; company?: boolean; email?: boolean }>({});
  protected readonly keyError = signal<string | null>(null);
  protected readonly mailSentTo = signal<string | null>(null);

  goTo(step: GateMode): void {
    this.registerError.set(null);
    this.keyError.set(null);
    this.step.set(step);
  }

  close(): void {
    this.closed.emit();
  }

  submitRegister(): void {
    if (this.busy()) return;
    const t = this.i18n.t();

    const errors = {
      name: this.name.trim() === '' || this.name.trim().length > 120,
      company: this.company.trim() === '' || this.company.trim().length > 160,
      email: !EMAIL_RE.test(this.email.trim()) || this.email.trim().length > 200,
    };
    this.fieldErrors.set(errors);
    if (errors.name || errors.company || errors.email) return;

    this.busy.set(true);
    this.registerError.set(null);

    this.access
      .register({
        name: this.name.trim(),
        company: this.company.trim(),
        email: this.email.trim(),
        website: this.website,
      })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.mailSentTo.set(this.email.trim());
          this.goTo('key');
        },
        error: (err: unknown) => {
          const code = DemoAccessService.errorCode(err);
          const base = code === 'rate_limited' ? t.gate_rate : t.gate_register_failed;
          // Present only while the server runs with debug enabled.
          const detail = DemoAccessService.errorDetail(err);
          this.registerError.set(detail ? `${base} (${detail})` : base);
        },
      });
  }

  submitKey(): void {
    if (this.busy()) return;
    const t = this.i18n.t();

    const raw = this.keyInput.trim();
    if (!KEY_RE.test(raw)) {
      this.keyError.set(t.gate_key_invalid);
      return;
    }

    this.busy.set(true);
    this.keyError.set(null);

    // `check` validates without consuming quota; the run itself authorizes later.
    this.access
      .check(raw)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (balance) => {
          this.access.storeKey(normalizeKey(raw), balance);
          this.unlocked.emit();
        },
        error: (err: unknown) => {
          const code = DemoAccessService.errorCode(err);
          if (code === 'expired' || code === 'exhausted') {
            this.access.storeKey(normalizeKey(raw), { ok: false, remaining: 0, unlimited: false });
            this.goTo('limit');
          } else if (code === 'rate_limited') {
            this.keyError.set(t.gate_rate);
          } else if (code === 'invalid_key') {
            this.keyError.set(t.gate_key_invalid);
          } else {
            this.keyError.set(t.gate_authorize_failed);
          }
        },
      });
  }

  protected readonly limitTitle = computed(() => {
    const t = this.i18n.t();
    return this.limitReason() === 'expired' ? t.gate_expired_title : t.gate_exhausted_title;
  });

  goToContact(): void {
    this.close();
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  onEscape(): void {
    this.close();
  }
}

function normalizeKey(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.slice(0, 4) + '-' + clean.slice(4);
}
