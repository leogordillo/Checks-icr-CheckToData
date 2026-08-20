import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { I18nService } from '../../core/i18n.service';
import { scorePct, tone } from '../../core/confidence';
import { fieldFlag, fieldReasons, fieldScore, fieldScoreOrNull, fieldValue, hasField } from '../../core/entities.util';
import { DemoStatus, EndorseResponse, PredictResponse } from '../../core/models';
import { SignatureBlockComponent } from './signature-block/signature-block';
import { EndorsementBlockComponent } from './endorsement-block/endorsement-block';
import { RawJsonPanelComponent } from './raw-json-panel/raw-json-panel';

type Face = 'front' | 'back';

/**
 * The four bands the results table reads in. They are marked with a divider rather
 * than with header rows: the table is already 12 rows tall, and four more rows of
 * chrome would push the classification band below the fold on a laptop.
 */
export type RowGroup = 'amount' | 'parties' | 'document' | 'classification';

interface FrontFieldDef {
  /** Uppercase key as it appears in the flat `entities` bag, e.g. `PAYEE`. */
  key: string;
  labelKey: keyof ReturnType<I18nService['t']>;
  normalizedKey?: keyof NonNullable<PredictResponse['normalized_properties']>;
  group: RowGroup;
  wide?: boolean;
}

/** Verdict of comparing the numeric amount (CAR) against the written one (LAR). */
type CarLarStatus = 'match' | 'mismatch' | 'unknown';

type I18nKey = keyof ReturnType<I18nService['t']>;

/** One of the two check-type axes returned in `entities`. */
interface CheckTypeDef {
  key: 'CHECK_ACCOUNT_TYPE' | 'CHECK_PURPOSE';
  labelKey: I18nKey;
  descKey: I18nKey;
  /** Maps each enum value the API can return to its translated label. */
  valueKeys: Record<string, I18nKey>;
}

/** A parsed part of the MICR line, shown as a breakdown rather than a row. */
export interface MicrPart {
  label: string;
  value: string;
}

/** Band membership, plus the flag that draws the divider above a band's first row. */
interface Grouped {
  group: RowGroup;
  /** Set on the first row of every band except the first, where the header rule already divides. */
  groupStart?: boolean;
}

export interface FieldRow extends Grouped {
  kind: 'field';
  key: string;
  label: string;
  value: string;
  normalized: string;
  showNormalized: boolean;
  score: number;
  reasons?: string;
  tone: ReturnType<typeof tone>;
  /** Only populated for the MICR row; empty everywhere else. */
  micrParts?: MicrPart[];
}

/**
 * One check-type axis. Kept apart from `FieldRow` because its score is nullable:
 * the API reports `null` when it found no evidence for a class, and that has to
 * render as "no evidence" rather than as a 0% bar.
 */
export interface CheckTypeRow extends Grouped {
  kind: 'checkType';
  key: 'CHECK_ACCOUNT_TYPE' | 'CHECK_PURPOSE';
  label: string;
  value: string;
  desc: string;
  score: number | null;
  reasons?: string;
  tone: ReturnType<typeof tone> | null;
}

export interface CarLarRow extends Grouped {
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

export type ResultRow = FieldRow | CarLarRow | CheckTypeRow;

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

/**
 * Row order is the reading order of the table, grouped by what each field is about.
 *
 * The amounts lead because the CAR/LAR mismatch is the highest-consequence thing on the
 * page, and it should not need a scroll. Maker address follows the maker it belongs to
 * rather than trailing the list, which is where it sat only because it was added last.
 * Order is otherwise free: `scoredKeys` only maps over this array, so the average and
 * field-count chips are unaffected by it.
 */
const FRONT_FIELD_DEFS: FrontFieldDef[] = [
  { key: 'AMOUNT', labelKey: 'f_amount', normalizedKey: 'amount_normalized', group: 'amount' },
  { key: 'AMOUNT_WORDS', labelKey: 'f_amount_words', normalizedKey: 'amount_words_normalized', group: 'amount' },
  { key: 'PAYEE', labelKey: 'f_payee', normalizedKey: 'payee_normalized', group: 'parties' },
  { key: 'MAKER', labelKey: 'f_maker', normalizedKey: 'maker_normalized', group: 'parties' },
  { key: 'MAKER_ADDRESS', labelKey: 'f_maker_addr', normalizedKey: 'maker_address_normalized', group: 'parties' },
  { key: 'DATE', labelKey: 'f_date', normalizedKey: 'date_normalized', group: 'document' },
  { key: 'BANK_NAME', labelKey: 'f_bank', normalizedKey: 'bank_name_normalized', group: 'document' },
  { key: 'CHECK_NUMBER', labelKey: 'f_check_number', normalizedKey: 'check_number_normalized', group: 'document' },
  { key: 'MICR_LINE', labelKey: 'f_micr_line', normalizedKey: 'micr_line_normalized', group: 'document', wide: true },
];

/** The parts the MICR line breaks down into, in the order they appear on the check. */
const MICR_PART_DEFS: { normalizedKey: keyof NonNullable<PredictResponse['normalized_properties']>; labelKey: I18nKey }[] = [
  { normalizedKey: 'micr_routing_number', labelKey: 'f_micr_routing' },
  { normalizedKey: 'micr_account_number', labelKey: 'f_micr_account' },
  { normalizedKey: 'micr_check_number', labelKey: 'f_micr_check' },
];

const CHECK_TYPE_DEFS: CheckTypeDef[] = [
  {
    key: 'CHECK_ACCOUNT_TYPE',
    labelKey: 'f_check_account_type',
    descKey: 'check_account_type_desc',
    valueKeys: { BUSINESS: 'ct_business', PERSONAL: 'ct_personal', UNKNOWN: 'ct_unknown' },
  },
  {
    key: 'CHECK_PURPOSE',
    labelKey: 'f_check_purpose',
    descKey: 'check_purpose_desc',
    valueKeys: { PAYROLL: 'ct_payroll', UNKNOWN: 'ct_unknown' },
  },
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
  /** The API is being retried because the engine is still booting. */
  readonly wakingUp = input(false);

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

    // The raw CAR is already a numeric string, so falling back to it is safe. The raw LAR
    // is a phrase: running it through `parseAmount` would keep whatever stray digits the
    // ICR read ("... and 400" -> 400.00) and invent an amount nobody wrote. The LAR may
    // only come from a value the backend already validated as money; without it the
    // verdict is "not verifiable".
    const carNum = parseAmount(r.normalized_properties?.amount_normalized ?? rawCar);
    const larNum = parseAmount(r.normalized_properties?.amount_words_normalized);
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
      group: 'amount',
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

  /**
   * The two check-type axes, rendered last because they describe the document as a
   * whole rather than a region of it.
   *
   * Like CAR/LAR these are derived, so they stay out of `scoredKeys` and therefore out
   * of the average-confidence and field-count chips — but unlike CAR/LAR the API does
   * attach a real score, so they show a bar when there is one to show.
   */
  protected readonly checkTypeRows = computed<CheckTypeRow[]>(() => {
    const r = this.result();
    const t = this.i18n.t();
    if (!r) return [];

    const rows: CheckTypeRow[] = [];
    for (const def of CHECK_TYPE_DEFS) {
      const raw = fieldValue(r.entities, def.key);
      // Absent entirely: an older API build that predates check type. Skip the row
      // rather than showing an "undetermined" verdict the engine never issued.
      if (raw === '') continue;

      const valueKey = def.valueKeys[raw.toUpperCase()];
      const score = fieldScoreOrNull(r.entities, def.key);
      rows.push({
        kind: 'checkType',
        key: def.key,
        group: 'classification',
        label: t[def.labelKey],
        // An unmapped value means the API grew a class the front end doesn't know
        // about yet; show it raw instead of mislabeling it as undetermined.
        value: valueKey ? t[valueKey] : raw,
        desc: t[def.descKey],
        score,
        reasons: fieldReasons(r.entities, def.key),
        tone: score !== null ? tone(score) : null,
      });
    }
    return rows;
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
        group: def.group,
        label: t[def.labelKey],
        value,
        normalized: normalizedStr,
        showNormalized: !!normalizedStr && normalizedStr.trim() !== value.trim(),
        score: fieldScore(r.entities, def.key),
        reasons: fieldReasons(r.entities, def.key),
        tone: tone(fieldScore(r.entities, def.key)),
        micrParts: def.key === 'MICR_LINE' ? this.micrParts() : undefined,
      });

      // Sits right below the two amounts it compares, where an operator reads them.
      if (def.key === 'AMOUNT_WORDS') {
        const carLar = this.carLarRow();
        if (carLar) rows.push(carLar);
      }
    }

    rows.push(...this.checkTypeRows());

    // Marks band boundaries after the fact rather than at push time, so the divider
    // follows whatever rows actually made it in: a band whose rows were all skipped
    // (check type against an older API) leaves no stray rule behind.
    let previousGroup: RowGroup | null = null;
    for (const row of rows) {
      row.groupStart = previousGroup !== null && row.group !== previousGroup;
      previousGroup = row.group;
    }

    return rows;
  });

  /**
   * Routing / account / check number, as parsed out of the MICR line.
   *
   * These live only in `normalized_properties` — there is no `MICR_ROUTING` entity and
   * so no score of their own. They render as a breakdown inside the MICR row instead of
   * as three rows, which would otherwise need a confidence column we'd have to invent.
   */
  private readonly micrParts = computed<MicrPart[]>(() => {
    const np = this.result()?.normalized_properties;
    const t = this.i18n.t();
    if (!np) return [];
    return MICR_PART_DEFS.flatMap((def) => {
      const value = np[def.normalizedKey];
      return value ? [{ label: t[def.labelKey], value: String(value) }] : [];
    });
  });

  protected readonly elapsedLabel = computed(() => this.elapsedSec().toFixed(1) + 's');

  /**
   * A run that passes this mark is being served by a container that had to boot.
   * Saying so while the visitor waits keeps a 30s first run from reading as a
   * hang — silence is what makes it feel broken.
   */
  private static readonly SLOW_RUN_HINT_SEC = 5;

  protected readonly showWakingNotice = computed(
    () => this.isProcessing() && (this.wakingUp() || this.elapsedSec() > ResultsComponent.SLOW_RUN_HINT_SEC),
  );

  protected readonly signatureResult = computed(() => this.result()?.classification?.signature?.result);
  protected readonly showSignature = computed(
    () => this.hasResults() && this.showSignatureToggleOn() && !!this.signatureResult(),
  );

  /**
   * +1 for the derived CAR/LAR row and +2 for the check-type axes, so the placeholder
   * matches the final row count.
   */
  protected readonly skeletonCards = computed(() =>
    Array.from({ length: FRONT_FIELD_DEFS.length + 1 + CHECK_TYPE_DEFS.length }, (_, i) => i),
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
