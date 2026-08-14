/**
 * Decodes a TIFF file into a displayable PNG data URL, for preview purposes only.
 * The original file bytes (never this rasterized copy) are what gets sent to the API.
 */
export async function tiffToPreviewDataUrl(file: File): Promise<string> {
  /**
   * utif2 is CommonJS. The production esbuild bundle exposes it only as the namespace's
   * `default`, while the dev server synthesizes named exports — so reading `.decode` off
   * the namespace directly works in dev and is `undefined` in prod. Unwrap defensively.
   */
  const mod = await import('utif2');
  const UTIF = ((mod as unknown as { default?: typeof import('utif2') }).default ??
    mod) as typeof import('utif2');
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  const first = ifds[0];
  UTIF.decodeImage(buffer, first);
  const rgba = UTIF.toRGBA8(first);

  const canvas = document.createElement('canvas');
  canvas.width = first.width;
  canvas.height = first.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable for TIFF preview.');
  const imageData = new ImageData(new Uint8ClampedArray(rgba), first.width, first.height);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
