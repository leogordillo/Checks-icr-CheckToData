import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { I18nService } from '../../core/i18n.service';
import { scorePct, tone } from '../../core/confidence';
import { fieldFlag, fieldReasons, fieldScore, fieldValue, hasField } from '../../core/entities.util';
import { DemoStatus, EndorseResponse, PredictResponse } from '../../core/models';
import { SignatureBlockComponent } from './signature-block/signature-block';
import { EndorsementBlockComponent } from './endorsement-block/endorsement-block';
import { RawJsonPanelComponent } from './raw-json-panel/raw-json-panel';

type Face = 'front' | 'back';

interface FrontFieldDef {
  /** Uppercase key as it appears in the flat `entities` bag, e.g. `PAYEE`. */
  key: string;
  labelKey: keyof ReturnType<I18nService['t']>;
  normalizedKey?: keyof NonNullable<PredictResponse['normalized_properties']>;
  wide?: boolean;
}

/** Verdict of comparing the numeric amount (CAR) against the written one (LAR). */
type CarLarStatus = 'match' | 'mismatch' | 'unknown';

export interface FieldRow {
  kind: 'field';
  key: string;
  label: string;
  value: string;
  normalized: string;
  showNormalized: boolean;
  score: number;
  reasons?: string;
  tone: ReturnType<typeof tone>;
}

export interface CarLarRow {
  kind: 'carLar';
  key: 'CAR_LAR';
  label: string;
  desc: string;
  car: string;
  lar: string;
  status: CarLarStatus;
  badge: string;
  note?: string;
  colors: { bar: string; bg: string; fg: string };
}

export type ResultRow = FieldRow | CarLarRow;

const CAR_LAR_COLORS: Record<CarLarStatus, { bar: string; bg: string; fg: string }> = {
  match: { bar: '#16A34A', bg: '#EAFAF0', fg: '#15803D' },
  mismatch: { bar: '#DC2626', bg: '#FDE7E7', fg: '#B01D1D' },
  unknown: { bar: '#A1A1AA', bg: '#F4F4F5', fg: '#52525B' },
};

/**
 * Parses a normalized money string ("1250.00") into a number. Returns null when the
 * value is absent or not parseable, which is what drives the "not verifiable" verdict.
 */
function parseAmount(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = String(value).replace(/[^\d.,-]/g, '').trim();
  if (cleaned === '') return null;
  // The normalized form uses a dot decimal separator; strip grouping commas only.
  const n = Number(cleaned.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Reuses whatever currency symbol the raw amount carried, rather than inventing one. */
function currencySymbol(rawAmount: string): string {
  const m = rawAmount.trim().match(/^([^\d\s-]+)/);
  return m ? m[1] : '';
}

function formatAmount(n: number, symbol: string): string {
  return symbol + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const FRONT_FIELD_DEFS: FrontFieldDef[] = [
  { key: 'PAYEE', labelKey: 'f_payee', normalizedKey: 'payee_normalized' },
  { key: 'MAKER', labelKey: 'f_maker', normalizedKey: 'maker_normalized' },
  { key: 'AMOUNT', labelKey: 'f_amount', normalizedKey: 'amount_normalized' },
  { key: 'AMOUNT_WORDS', labelKey: 'f_amount_words', normalizedKey: 'amount_words_normalized' },
  { key: 'DATE', labelKey: 'f_date', normalizedKey: 'date_normalized' },
  { key: 'BANK_NAME', labelKey: 'f_bank', normalizedKey: 'bank_name_normalized' },
  { key: 'CHECK_NUMBER', labelKey: 'f_check_number', normalizedKey: 'check_number_normalized' },
  { key: 'MICR_LINE', labelKey: 'f_micr_line', normalizedKey: 'micr_line_normalized', wide: true },
  { key: 'MAKER_ADDRESS', labelKey: 'f_maker_addr', normalizedKey: 'maker_address_normalized' },
];

@Component({
  selector: 'app-results',
  imports: [SignatureBlockComponent, EndorsementBlockComponent, RawJsonPanelComponent],
  templateUrl: './results.html',
  styleUrl: './results.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsComponent {
  protected readonly i18n = inject(I18nService);

  readonly status = input.required<DemoStatus>();
  readonly result = input<PredictResponse | null>(null);
  readonly endorseResult = input<EndorseResponse | null>(null);
  readonly errorMsg = input('');
  readonly showSignatureToggleOn = input(false);
  readonly coldStartDetected = input(false);

  readonly retry = output<void>();

  protected readonly copyState = signal<'idle' | 'copied'>('idle');
  protected readonly activeFace = signal<Face>('front');

  protected readonly isProcessing = computed(() => this.status() === 'processing');
  protected readonly hasResults = computed(() => this.status() === 'results' && !!this.result());
  protected readonly hasError = computed(() => this.status() === 'error');
  protected readonly visible = computed(() => this.isProcessing() || this.hasResults() || this.hasError());
  protected readonly hasBoth = computed(() => !!this.endorseResult());

  protected readonly elapsedSec = signal(0);
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      if (this.isProcessing()) {
        const start = performance.now();
        this.elapsedSec.set(0);
        this.elapsedTimer = setInterval(() => {
          this.elapsedSec.set((performance.now() - start) / 1000);
        }, 100);
      } else if (this.elapsedTimer) {
        clearInterval(this.elapsedTimer);
        this.elapsedTimer = null;
      }
    });
    destroyRef.onDestroy(() => {
      if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    });
  }

  protected readonly showFrontContent = computed(() => this.hasResults() && this.activeFace() === 'front');
  protected readonly showBackContent = computed(
    () => this.hasResults() && this.activeFace() === 'back' && this.hasBoth(),
  );

  private readonly scoredKeys = computed(() => FRONT_FIELD_DEFS.map((d) => d.key));

  protected readonly avgConfidence = computed(() => {
    const r = this.result();
    if (!r) return 0;
    const scores = this.scoredKeys()
      .filter((key) => hasField(r.entities, key))
      .map((key) => fieldScore(r.entities, key));
    if (!scores.length) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  });

  protected readonly avgTone = computed(() => tone(this.avgConfidence()));

  protected readonly headerChips = computed(() => {
    const r = this.result();
    const t = this.i18n.t();
    if (!r) return [];
    const latencySec = (r.total_processing_ms / 1000).toFixed(2) + 's';
    const fieldsCount = this.scoredKeys().filter((key) => hasField(r.entities, key)).length;
    const scopeVal = this.hasBoth() ? t.scope_both : t.scope_front;
    return [
      { label: t.chip_confidence, value: (this.avgConfidence() * 100).toFixed(1) + '%', dot: this.avgTone().bar },
      { label: t.chip_latency, value: latencySec, dot: '#0E9C9C' },
      { label: t.chip_fields, value: String(fieldsCount), dot: '#6D42D9' },
      { label: t.chip_scope, value: scopeVal, dot: '#B45309' },
    ];
  });

  /**
   * The CAR/LAR control: does the numeric amount agree with the amount in words?
   *
   * Derived, not extracted — so it is deliberately kept out of `scoredKeys`, which feeds
   * the average-confidence and field-count chips. It carries a verdict, not a score, so
   * it renders a badge instead of a confidence bar.
   */
  protected readonly carLarRow = computed<CarLarRow | null>(() => {
    const r = this.result();
    const t = this.i18n.t();
    if (!r) return null;

    const rawCar = fieldValue(r.entities, 'AMOUNT');
    const rawLar = fieldValue(r.entities, 'AMOUNT_WORDS');
    if (rawCar === '' && rawLar === '') return null;

    const carNum = parseAmount(r.normalized_properties?.amount_normalized ?? rawCar);
    const larNum = parseAmount(r.normalized_properties?.amount_words_normalized ?? rawLar);
    const symbol = currencySymbol(rawCar);

    // The API's own verdict wins when present; comparing the normalized numbers is the
    // fallback for responses that omit the flag.
    const apiFlag = fieldFlag(r.entities, 'AMOUNT_MATCHES_AMOUNT_WORDS');
    let status: CarLarStatus;
    if (apiFlag !== undefined) {
      status = apiFlag ? 'match' : 'mismatch';
    } else if (carNum !== null && larNum !== null) {
      // Money: compare to cents, avoiding float noise.
      status = Math.abs(carNum - larNum) < 0.005 ? 'match' : 'mismatch';
    } else {
      status = 'unknown';
    }

    const badge =
      status === 'match' ? t.cotejo_match : status === 'mismatch' ? t.cotejo_nomatch : t.cotejo_unknown;
    const note =
      status === 'mismatch'
        ? t.car_lar_note_mismatch
        : status === 'unknown'
          ? t.car_lar_note_unknown
          : undefined;

    return {
      kind: 'carLar',
      key: 'CAR_LAR',
      label: t.f_car_lar,
      desc: t.car_lar_desc,
      car: carNum !== null ? formatAmount(carNum, symbol) : rawCar || '—',
      lar: larNum !== null ? formatAmount(larNum, symbol) : '—',
      status,
      badge,
      note,
      colors: CAR_LAR_COLORS[status],
    };
  });

  protected readonly tableRows = computed<ResultRow[]>(() => {
    const r = this.result();
    const t = this.i18n.t();
    if (!r) return [];

    const rows: ResultRow[] = [];

    for (const def of FRONT_FIELD_DEFS) {
      const normalized = def.normalizedKey ? r.normalized_properties?.[def.normalizedKey] : null;
      const value = fieldValue(r.entities, def.key);
      const normalizedStr = normalized || '';
      rows.push({
        kind: 'field',
        key: def.key,
        label: t[def.labelKey],
        value,
        normalized: normalizedStr,
        showNormalized: !!normalizedStr && normalizedStr.trim() !== value.trim(),
        score: fieldScore(r.entities, def.key),
        reasons: fieldReasons(r.entities, def.key),
        tone: tone(fieldScore(r.entities, def.key)),
      });

      // Sits right below the two amounts it compares, where an operator reads them.
      if (def.key === 'AMOUNT_WORDS') {
        const carLar = this.carLarRow();
        if (carLar) rows.push(carLar);
      }
    }

    return rows;
  });

  protected readonly elapsedLabel = computed(() => this.elapsedSec().toFixed(1) + 's');

  protected readonly signatureResult = computed(() => this.result()?.classification?.signature?.result);
  protected readonly showSignature = computed(
    () => this.hasResults() && this.showSignatureToggleOn() && !!this.signatureResult(),
  );

  /** +1 for the derived CAR/LAR row, so the placeholder matches the final row count. */
  protected readonly skeletonCards = computed(() =>
    Array.from({ length: FRONT_FIELD_DEFS.length + 1 }, (_, i) => i),
  );

  protected readonly scorePctFmt = scorePct;

  protected readonly rawPayload = computed(() =>
    JSON.stringify({ predict: this.result(), endorse: this.endorseResult() }, null, 2),
  );

  setFace(face: Face): void {
    this.activeFace.set(face);
  }

  async onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.rawPayload());
    } catch {
      /* clipboard unavailable — ignore */
    }
    this.copyState.set('copied');
    setTimeout(() => this.copyState.set('idle'), 1400);
  }

  onDownload(): void {
    const blob = new Blob([this.rawPayload()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'checkicr_response.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 400);
  }

  onRetry(): void {
    this.retry.emit();
  }
}
