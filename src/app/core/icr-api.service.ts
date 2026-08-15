import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, of, timer } from 'rxjs';
import { catchError, retry, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { EndorseResponse, PredictResponse } from './models';

export interface PredictOptions {
  signature?: boolean;
  includeEvidence?: boolean;
}

export interface ClassifyEndorseOptions {
  includeEvidence?: boolean;
}

/**
 * A scaled-to-zero Container App does NOT hold the request while the replica
 * boots: the ingress rejects it in about a second with a 503 that carries no CORS
 * headers, so the browser reports it as a network failure (status 0). Waiting
 * longer therefore achieves nothing — the only cure is to try again until the
 * container answers.
 */
function isColdStartFailure(err: unknown): boolean {
  return err instanceof HttpErrorResponse && (err.status === 0 || err.status === 503);
}

/** Backoff between attempts, in ms. Spans ~45s, enough for the model to load. */
const COLD_START_BACKOFF_MS = [2_000, 5_000, 8_000, 12_000, 15_000];

@Injectable({ providedIn: 'root' })
export class IcrApiService {
  /** Overall budget, retries included. */
  private static readonly REQUEST_TIMEOUT_MS = 120_000;

  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  /**
   * True while a request is being retried because the engine is still booting.
   * Drives the "warming up" copy so the wait is explained rather than silent.
   */
  private readonly waking = signal(false);
  readonly wakingUp = this.waking.asReadonly();

  predict(image: File, options: PredictOptions = {}): Observable<PredictResponse> {
    const form = new FormData();
    form.append('image', image, image.name);
    form.append('use_internal_ocr', 'true');
    form.append('signature', String(!!options.signature));
    form.append('include_evidence', String(!!options.includeEvidence));
    return this.withColdStartRetry(
      this.http.post<PredictResponse>(`${this.baseUrl}/predict`, form),
    );
  }

  classifyEndorse(image: File, options: ClassifyEndorseOptions = {}): Observable<EndorseResponse> {
    const form = new FormData();
    form.append('image', image, image.name);
    form.append('include_evidence', String(!!options.includeEvidence));
    return this.withColdStartRetry(
      this.http.post<EndorseResponse>(`${this.baseUrl}/classify/endorse`, form),
    );
  }

  /** Resets the banner between runs. */
  resetWakingState(): void {
    this.waking.set(false);
  }

  /**
   * Retries only the cold-start signature; a genuine error (bad file, 4xx, 5xx
   * from the app itself) surfaces immediately instead of being retried blindly.
   */
  private withColdStartRetry<T>(source: Observable<T>): Observable<T> {
    return source.pipe(
      retry({
        count: COLD_START_BACKOFF_MS.length,
        delay: (error: unknown, retryIndex: number) => {
          if (!isColdStartFailure(error)) {
            throw error;
          }
          this.waking.set(true);
          return timer(COLD_START_BACKOFF_MS[retryIndex - 1] ?? 15_000);
        },
      }),
      timeout(IcrApiService.REQUEST_TIMEOUT_MS),
    );
  }

  /** Fire-and-forget ping to wake a scaled-to-zero container before the user submits. */
  warmUp(): void {
    this.http
      .get(`${this.baseUrl}/health`)
      .pipe(catchError(() => of(null)))
      .subscribe();
  }
}
