import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { PredictResponse } from './models';

/** Server-side error codes the gate reacts to. */
export type AccessError =
  | 'invalid_key'
  | 'expired'
  | 'exhausted'
  | 'rate_limited'
  | 'send_failed'
  | 'unknown';

export interface AccessBalance {
  ok: boolean;
  /** Runs left; null when the key is unlimited. */
  remaining: number | null;
  unlimited: boolean;
}

export interface RegisterPayload {
  name: string;
  company: string;
  email: string;
  /** Honeypot — always empty for real users. */
  website: string;
}

/**
 * Numeric run outcome sent to use.php. Deliberately contains nothing from the
 * check itself: no image, no file name, no extracted values. Extending this
 * interface with check contents would break the site's public privacy promise.
 */
export interface RunMetrics {
  success: boolean;
  total_ms: number | null;
  avg_conf: number | null;
  field_count: number | null;
  with_back: boolean;
  cold_start: boolean;
}

const KEY_STORAGE = 'checktodata_demo_key';
const REMAINING_STORAGE = 'checktodata_demo_remaining';

@Injectable({ providedIn: 'root' })
export class DemoAccessService {
  private readonly http = inject(HttpClient);

  /**
   * localStorage is a UX cache only: the authoritative balance lives server-side
   * in SQLite, and every `authorize` re-checks it there. Editing the browser
   * copy changes nothing but the label.
   */
  private readonly keySignal = signal<string | null>(readStorage(KEY_STORAGE));
  private readonly remainingSignal = signal<number | null>(readRemaining());
  private readonly unlimitedSignal = signal(false);

  readonly key = this.keySignal.asReadonly();
  readonly remaining = this.remainingSignal.asReadonly();
  readonly unlimited = this.unlimitedSignal.asReadonly();

  register(payload: RegisterPayload): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('register.php', payload);
  }

  /** Validates a typed-in key without consuming quota. */
  check(key: string): Observable<AccessBalance> {
    return this.http.post<AccessBalance>('use.php', { action: 'check', key });
  }

  /** Consumes one run. Call only right before actually executing. */
  authorize(): Observable<AccessBalance> {
    return this.http.post<AccessBalance>('use.php', { action: 'authorize', key: this.keySignal() });
  }

  /** Best-effort: a lost metrics beacon must never disturb the visitor. */
  reportMetrics(metrics: RunMetrics): void {
    this.http
      .post('use.php', { action: 'metrics', key: this.keySignal(), ...metrics })
      .subscribe({ error: () => undefined });
  }

  storeKey(key: string, balance: AccessBalance): void {
    this.keySignal.set(key);
    this.applyBalance(balance);
    writeStorage(KEY_STORAGE, key);
  }

  applyBalance(balance: AccessBalance): void {
    this.remainingSignal.set(balance.remaining);
    this.unlimitedSignal.set(balance.unlimited);
    writeStorage(REMAINING_STORAGE, balance.remaining === null ? '' : String(balance.remaining));
  }

  /** Forgets the stored key (e.g. the server no longer recognizes it). */
  clear(): void {
    this.keySignal.set(null);
    this.remainingSignal.set(null);
    this.unlimitedSignal.set(false);
    writeStorage(KEY_STORAGE, null);
    writeStorage(REMAINING_STORAGE, null);
  }

  /** Maps an HTTP failure from register/use into a gate-actionable code. */
  static errorCode(err: unknown): AccessError {
    if (err instanceof HttpErrorResponse) {
      const code = (err.error as { error?: string } | null)?.error;
      if (
        code === 'invalid_key' ||
        code === 'expired' ||
        code === 'exhausted' ||
        code === 'send_failed'
      ) {
        return code;
      }
      if (err.status === 429) return 'rate_limited';
    }
    return 'unknown';
  }

  /**
   * Technical cause the server attaches only when its config has debug enabled.
   * Surfaced verbatim so a misconfigured mailbox is diagnosable from the browser
   * instead of requiring access to the hosting error log.
   */
  static errorDetail(err: unknown): string | null {
    if (err instanceof HttpErrorResponse) {
      const detail = (err.error as { detail?: string } | null)?.detail;
      if (typeof detail === 'string' && detail !== '') return detail;
    }
    return null;
  }

  /**
   * Derives the run metrics from an API response. Only aggregates leave this
   * function — never the entity values themselves.
   */
  static metricsFrom(
    result: PredictResponse | null,
    opts: { success: boolean; clientMs: number; withBack: boolean; coldStart: boolean },
  ): RunMetrics {
    let avgConf: number | null = null;
    let fieldCount: number | null = null;

    if (result) {
      const scores = Object.entries(result.entities)
        .filter(([k, v]) => k.endsWith('_CONF') && typeof v === 'number')
        .map(([, v]) => v as number);
      if (scores.length) {
        avgConf = scores.reduce((a, b) => a + b, 0) / scores.length;
        fieldCount = scores.length;
      }
    }

    return {
      success: opts.success,
      total_ms: Math.round(result ? result.total_processing_ms : opts.clientMs),
      avg_conf: avgConf,
      field_count: fieldCount,
      with_back: opts.withBack,
      cold_start: opts.coldStart,
    };
  }
}

function readStorage(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v !== '' ? v : null;
  } catch {
    return null;
  }
}

function readRemaining(): number | null {
  const v = readStorage(REMAINING_STORAGE);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    /* private browsing etc. — the server remains authoritative anyway */
  }
}
