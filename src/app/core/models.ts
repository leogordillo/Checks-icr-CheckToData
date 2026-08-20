/**
 * `entities` is a flat bag keyed by UPPERCASE field name, not a map of
 * `{text, score}` objects. Each recognized field (e.g. `PAYEE`) has a
 * sibling `<FIELD>_CONF` (0-1 score) and optionally `<FIELD>_CONF_REASONS`
 * (human-readable scoring explanation) and `<FIELD>_NORMALIZED`. A handful
 * of standalone booleans (e.g. `AMOUNT_MATCHES_AMOUNT_WORDS`) can also
 * appear. Use `entities.util.ts` helpers to read out of this bag safely.
 *
 * A `<FIELD>_CONF` can be an explicit `null` (see the check-type keys below):
 * that means "no evidence", which is not the same as a score of zero.
 */
export type EntitiesBag = Record<string, string | number | boolean | null>;

/**
 * Check type comes back as two *independent* axes rather than one class, because
 * all four combinations occur in practice — an individual can write a payroll-like
 * check, and a company can write one that is not payroll. Both keys are always
 * present in `entities`, and neither is ever asserted by elimination: when the
 * evidence does not support a class the API returns `UNKNOWN` with a null `_CONF`.
 */
export type CheckAccountType = 'BUSINESS' | 'PERSONAL' | 'UNKNOWN';
export type CheckPurpose = 'PAYROLL' | 'UNKNOWN';

export interface NormalizedProperties {
  amount_normalized?: string | null;
  amount_words_normalized?: string | null;
  date_normalized?: string | null;
  payee_normalized?: string | null;
  maker_normalized?: string | null;
  maker_address_normalized?: string | null;
  bank_name_normalized?: string | null;
  check_number_normalized?: string | null;
  micr_line_normalized?: string | null;
  /**
   * The three parts the MICR line parses into. They are a breakdown of
   * `micr_line_normalized`, not separately extracted fields, so they carry no
   * confidence of their own and are rendered under the MICR row rather than as
   * rows of their own.
   */
  micr_routing_number?: string | null;
  micr_account_number?: string | null;
  micr_check_number?: string | null;
}

export interface SignatureClassificationResult {
  signed: boolean;
  label: string;
  score: number;
}

export interface SignatureClassificationItem {
  enabled: boolean;
  status: 'ok' | 'error';
  result?: SignatureClassificationResult;
  error?: { type: string; message: string };
  processing_ms?: number;
}

export interface ClassificationBlock {
  signature?: SignatureClassificationItem;
}

export interface PredictResponse {
  file_name: string;
  entities: EntitiesBag;
  normalized_properties?: NormalizedProperties;
  ocr_source: string;
  image_normalization_ms: number;
  ocr_ms: number;
  ocr_mapping_ms: number;
  inference_ms: number;
  total_processing_ms: number;
  classification?: ClassificationBlock;
}

export interface EndorseResponse {
  file_name: string;
  endorsed: boolean;
  label: string;
  score: number;
  image_normalization_ms: number;
  inference_ms: number;
  total_processing_ms: number;
}

export type DemoStatus = 'idle' | 'processing' | 'results' | 'error';

export type ConfidenceLevel = 'high' | 'good' | 'medium' | 'low';

export interface ConfidenceTone {
  level: ConfidenceLevel;
  bar: string;
  bg: string;
  fg: string;
  icon: string;
  labelKey: 'conf_high' | 'conf_good' | 'conf_med' | 'conf_low';
}
