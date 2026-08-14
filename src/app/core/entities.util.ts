import { EntitiesBag } from './models';

/** Reads `<FIELD>` out of the flat entities bag as a display string. */
export function fieldValue(entities: EntitiesBag, field: string): string {
  const v = entities[field];
  if (v === undefined || v === null) return '';
  return String(v);
}

/** Reads `<FIELD>_CONF` out of the flat entities bag; 0 when absent. */
export function fieldScore(entities: EntitiesBag, field: string): number {
  const v = entities[`${field}_CONF`];
  return typeof v === 'number' ? v : 0;
}

/** Reads `<FIELD>_CONF_REASONS`, the human-readable scoring explanation, when present. */
export function fieldReasons(entities: EntitiesBag, field: string): string | undefined {
  const v = entities[`${field}_CONF_REASONS`];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Reads a standalone boolean flag (e.g. `AMOUNT_MATCHES_AMOUNT_WORDS`) out of the bag.
 * Returns `undefined` when the flag is absent, which callers must treat as "unknown"
 * rather than "false" — the API omits it when it could not evaluate the comparison.
 */
export function fieldFlag(entities: EntitiesBag, field: string): boolean | undefined {
  const v = entities[field];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return undefined;
}

/** True when the entities bag has any value at all for `<FIELD>`. */
export function hasField(entities: EntitiesBag, field: string): boolean {
  const v = entities[field];
  return v !== undefined && v !== null && v !== '';
}
