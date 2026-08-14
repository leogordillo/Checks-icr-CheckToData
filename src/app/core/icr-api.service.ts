import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { EndorseResponse, PredictResponse } from './models';

export interface PredictOptions {
  signature?: boolean;
  includeEvidence?: boolean;
}

export interface ClassifyEndorseOptions {
  includeEvidence?: boolean;
}

@Injectable({ providedIn: 'root' })
export class IcrApiService {
  /** Container Apps cold starts have been observed to exceed 60s; keep this generous to avoid false timeouts. */
  private static readonly REQUEST_TIMEOUT_MS = 90_000;

  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  predict(image: File, options: PredictOptions = {}): Observable<PredictResponse> {
    const form = new FormData();
    form.append('image', image, image.name);
    form.append('use_internal_ocr', 'true');
    form.append('signature', String(!!options.signature));
    form.append('include_evidence', String(!!options.includeEvidence));
    return this.http
      .post<PredictResponse>(`${this.baseUrl}/predict`, form)
      .pipe(timeout(IcrApiService.REQUEST_TIMEOUT_MS));
  }

  classifyEndorse(image: File, options: ClassifyEndorseOptions = {}): Observable<EndorseResponse> {
    const form = new FormData();
    form.append('image', image, image.name);
    form.append('include_evidence', String(!!options.includeEvidence));
    return this.http
      .post<EndorseResponse>(`${this.baseUrl}/classify/endorse`, form)
      .pipe(timeout(IcrApiService.REQUEST_TIMEOUT_MS));
  }

  /** Fire-and-forget ping to wake a scaled-to-zero container before the user submits a check. */
  warmUp(): void {
    this.http
      .get(`${this.baseUrl}/health`)
      .pipe(catchError(() => of(null)))
      .subscribe();
  }
}
