/**
 * `entities` is a flat bag keyed by UPPERCASE field name, not a map of
 * `{text, score}` objects. Each recognized field (e.g. `PAYEE`) has a
 * sibling `<FIELD>_CONF` (0-1 score) and optionally `<FIELD>_CONF_REASONS`
 * (human-readable scoring explanation) and `<FIELD>_NORMALIZED`. A handful
 * of standalone booleans (e.g. `AMOUNT_MATCHES_AMOUNT_WORDS`) can also
 * appear. Use `entities.util.ts` helpers to read out of this bag safely.
 */
export type EntitiesBag = Record<string, string | number | boolean>;

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
