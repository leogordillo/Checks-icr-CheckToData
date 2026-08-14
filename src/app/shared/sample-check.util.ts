/** Synthetic sample check artwork (front/back), ported from the design mock. Rasterized to real PNG Files so "load sample" exercises the actual API, not a mocked response. */

const FRONT_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 920 400'>
  <defs>
    <pattern id='p' width='6' height='6' patternUnits='userSpaceOnUse'><path d='M0 6L6 0' stroke='#eef0f5' stroke-width='.5'/></pattern>
  </defs>
  <rect width='920' height='400' fill='#f8f7f1'/>
  <rect x='8' y='8' width='904' height='384' fill='none' stroke='#c8cdd6' stroke-width='1'/>
  <rect x='8' y='8' width='904' height='384' fill='url(#p)'/>
  <text x='40' y='52' font-family='Georgia, serif' font-size='22' font-weight='700' fill='#1f2b4b'>BANCO NACIONAL</text>
  <text x='40' y='72' font-family='Helvetica' font-size='10' fill='#5a6478'>SUCURSAL 0142 · CENTRO</text>
  <text x='740' y='52' font-family='Helvetica' font-size='10' fill='#5a6478'>FECHA</text>
  <text x='740' y='72' font-family='Helvetica' font-size='14' fill='#1a1a1a'>15 / 03 / 2026</text>
  <text x='740' y='92' font-family='Helvetica' font-size='10' fill='#5a6478'>N°</text>
  <text x='770' y='92' font-family='Helvetica' font-size='14' fill='#1a1a1a' font-weight='600'>0004521</text>
  <text x='40' y='150' font-family='Helvetica' font-size='11' fill='#5a6478'>PÁGUESE A LA ORDEN DE</text>
  <line x1='40' y1='172' x2='650' y2='172' stroke='#a8b0bf' stroke-width='.6'/>
  <text x='80' y='168' font-family='Georgia, serif' font-size='18' fill='#1a1a1a'>Acme Industrial S.A.</text>
  <rect x='680' y='128' width='190' height='52' fill='#ffffff' stroke='#8f97a8' stroke-width='.8'/>
  <text x='690' y='150' font-family='Helvetica' font-size='9' fill='#5a6478'>$</text>
  <text x='700' y='163' font-family='Helvetica' font-size='20' font-weight='700' fill='#1a1a1a'>1,250.00</text>
  <text x='40' y='210' font-family='Helvetica' font-size='11' fill='#5a6478'>LA SUMA DE</text>
  <line x1='40' y1='232' x2='860' y2='232' stroke='#a8b0bf' stroke-width='.6'/>
  <text x='80' y='228' font-family='Georgia, serif' font-size='16' fill='#1a1a1a'>Un mil doscientos cincuenta con 00/100 pesos</text>
  <text x='40' y='290' font-family='Helvetica' font-size='10' fill='#5a6478'>Roberto Martínez López</text>
  <text x='40' y='306' font-family='Helvetica' font-size='10' fill='#5a6478'>Av. Corrientes 1234, CABA</text>
  <line x1='560' y1='330' x2='830' y2='330' stroke='#a8b0bf' stroke-width='.6'/>
  <text x='585' y='325' font-family='"Segoe Script", cursive' font-size='18' fill='#2a3f6d' font-style='italic'>Roberto Martínez</text>
  <text x='620' y='344' font-family='Helvetica' font-size='9' fill='#5a6478'>FIRMA AUTORIZADA</text>
  <rect x='0' y='348' width='920' height='40' fill='#f2f0e8'/>
  <text x='80' y='378' font-family='"Courier New", monospace' font-size='22' letter-spacing='4' fill='#1a1a1a'>⑈004521⑈  ⑆021000021⑆  1234567890⑈</text>
</svg>`;

const BACK_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 920 400'>
  <rect width='920' height='400' fill='#f8f7f1'/>
  <rect x='8' y='8' width='904' height='384' fill='none' stroke='#c8cdd6' stroke-width='1'/>
  <rect x='40' y='40' width='840' height='40' fill='none' stroke='#a8b0bf' stroke-dasharray='4 3' stroke-width='.6'/>
  <text x='52' y='64' font-family='Helvetica' font-size='10' fill='#5a6478'>ENDOSAR AQUÍ · ENDORSE HERE</text>
  <line x1='60' y1='140' x2='720' y2='140' stroke='#a8b0bf' stroke-width='.6'/>
  <text x='100' y='134' font-family='"Segoe Script", cursive' font-size='20' fill='#2a3f6d' font-style='italic'>Acme Industrial S.A. · Juan Pérez</text>
  <text x='60' y='170' font-family='Helvetica' font-size='10' fill='#5a6478'>CUIT 30-71234567-8 · CTA 1234567890</text>
  <text x='60' y='310' font-family='Helvetica' font-size='9' fill='#8a92a2'>NO ESCRIBA NI FIRME DEBAJO DE ESTA LÍNEA</text>
  <line x1='40' y1='320' x2='880' y2='320' stroke='#c8cdd6' stroke-width='.6'/>
</svg>`;

async function svgToPngFile(svg: string, fileName: string): Promise<File> {
  const svgUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = svgUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 920;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable for sample check rendering.');
  ctx.drawImage(img, 0, 0, 920, 400);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Failed to rasterize sample check to PNG.');
  return new File([blob], fileName, { type: 'image/png' });
}

export function loadSampleFront(): Promise<File> {
  return svgToPngFile(FRONT_SVG, 'sample_front.png');
}

export function loadSampleBack(): Promise<File> {
  return svgToPngFile(BACK_SVG, 'sample_back.png');
}
