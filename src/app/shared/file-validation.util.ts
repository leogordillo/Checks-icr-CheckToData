export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['png', 'tif', 'tiff'];
/** Matches the input `accept` attribute — the backend (image_service.normalize_to_png) only accepts PNG and TIFF. */
export const ACCEPTED_INPUT_ATTR = '.png,.tif,.tiff,image/png,image/tiff';

export type FileValidationError = 'unsupported_format' | 'too_large' | null;

export function validateCheckImage(file: File): FileValidationError {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ACCEPTED_EXTENSIONS.includes(ext)) return 'unsupported_format';
  if (file.size > MAX_FILE_SIZE_BYTES) return 'too_large';
  return null;
}

export function isTiff(file: File | { name: string }): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'tif' || ext === 'tiff';
}

export function formatBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
