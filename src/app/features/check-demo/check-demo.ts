import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { forkJoin, of, TimeoutError } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { I18nService } from '../../core/i18n.service';
import { IcrApiService } from '../../core/icr-api.service';
import { DemoStatus, EndorseResponse, PredictResponse } from '../../core/models';
import { loadSampleBack, loadSampleFront } from '../../shared/sample-check.util';
import { UploadDropzoneComponent } from './upload-dropzone/upload-dropzone';
import { ResultsComponent } from '../results/results';

@Component({
  selector: 'app-check-demo',
  imports: [UploadDropzoneComponent, ResultsComponent],
  templateUrl: './check-demo.html',
  styleUrl: './check-demo.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckDemoComponent {
  /** Client-measured latency minus the API's own reported processing time, above which we suspect a cold start. */
  private static readonly COLD_START_GAP_MS = 2500;
  /** Floor below which we never flag a cold start, even if the gap looks large (avoids noise on tiny/fast requests). */
  private static readonly COLD_START_MIN_TOTAL_MS = 4000;

  protected readonly i18n = inject(I18nService);
  private readonly icrApi = inject(IcrApiService);

  protected readonly frontFile = signal<File | null>(null);
  protected readonly backFile = signal<File | null>(null);
  protected readonly optSig = signal(true);
  protected readonly optEv = signal(false);

  protected readonly status = signal<DemoStatus>('idle');
  protected readonly result = signal<PredictResponse | null>(null);
  protected readonly endorseResult = signal<EndorseResponse | null>(null);
  protected readonly errorMsg = signal('');
  protected readonly coldStartDetected = signal(false);

  constructor() {
    effect(() => {
      const s = this.status();
      if (s === 'processing' || s === 'results') {
        queueMicrotask(() => this.scrollToResults());
      }
    });
    this.icrApi.warmUp();
  }

  private scrollToResults(): void {
    const el = document.getElementById('results');
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  protected readonly isProcessing = computed(() => this.status() === 'processing');
  protected readonly hasError = computed(() => this.status() === 'error');
  protected readonly processDisabled = computed(() => !this.frontFile() || this.isProcessing());

  onFrontSelected(file: File): void {
    this.frontFile.set(file);
    this.result.set(null);
    if (this.status() === 'results' || this.status() === 'error') this.status.set('idle');
  }

  onFrontCleared(): void {
    this.frontFile.set(null);
    this.result.set(null);
    this.status.set('idle');
  }

  onBackSelected(file: File): void {
    this.backFile.set(file);
    this.endorseResult.set(null);
  }

  onBackCleared(): void {
    this.backFile.set(null);
    this.endorseResult.set(null);
  }

  toggleSig(): void {
    this.optSig.update((v) => !v);
  }

  toggleEv(): void {
    this.optEv.update((v) => !v);
  }

  async loadSample(): Promise<void> {
    const [front, back] = await Promise.all([loadSampleFront(), loadSampleBack()]);
    this.frontFile.set(front);
    this.backFile.set(back);
    this.result.set(null);
    this.endorseResult.set(null);
    this.status.set('idle');
  }

  processCheck(): void {
    const front = this.frontFile();
    if (!front) return;

    this.status.set('processing');
    this.errorMsg.set('');
    this.result.set(null);
    this.endorseResult.set(null);
    this.coldStartDetected.set(false);

    const clientStart = performance.now();

    const predict$ = this.icrApi.predict(front, {
      signature: this.optSig(),
      includeEvidence: this.optEv(),
    });

    const back = this.backFile();
    const endorse$ = back
      ? this.icrApi.classifyEndorse(back, { includeEvidence: this.optEv() }).pipe(
          catchError(() => of(null)),
        )
      : of(null);

    forkJoin({ predict: predict$, endorse: endorse$ })
      .pipe(
        catchError((err) => {
          this.status.set('error');
          this.errorMsg.set(this.extractErrorMessage(err));
          return of(null);
        }),
        finalize(() => {
          if (this.status() === 'processing') this.status.set('idle');
        }),
      )
      .subscribe((res) => {
        if (!res) return;
        const clientElapsedMs = performance.now() - clientStart;
        const gap = clientElapsedMs - res.predict.total_processing_ms;
        this.coldStartDetected.set(
          clientElapsedMs > CheckDemoComponent.COLD_START_MIN_TOTAL_MS &&
            gap > CheckDemoComponent.COLD_START_GAP_MS,
        );
        this.result.set(res.predict);
        this.endorseResult.set(res.endorse);
        this.status.set('results');
      });
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof TimeoutError) {
      return this.i18n.t().err_timeout;
    }
    if (err && typeof err === 'object' && 'error' in err) {
      const body = (err as { error?: { detail?: string } }).error;
      if (body?.detail) return body.detail;
    }
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: unknown }).message);
    }
    return 'Unknown error';
  }
}
