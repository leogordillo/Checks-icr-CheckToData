import { Injectable, computed, signal } from '@angular/core';

export type Lang = 'es' | 'en';

const es = {
    nav_product: 'Producto', nav_how: 'Cómo funciona', nav_contact: 'Contacto',
    hero_pill: 'Motor ICR para cheques bancarios',
    hero_title: 'Extracción de datos de cheques con confianza medible',
    hero_sub: 'Motor ICR entrenado sobre LayoutLMv3 que devuelve campos normalizados, línea MICR desglosada y clasificación de firma y endoso con score de confianza por campo.',
    metrics_title: 'Rendimiento en producción',
    metric_fields: 'Campos extraídos', metric_acc: 'Precisión promedio', metric_lat: 'Latencia media',
    demo_title: 'Probá el motor con tu propio cheque', demo_sub: 'La respuesta que ves acá es la misma que consume tu integración.',
    api_ok: 'API operativa',
    slot_front: 'Frente del cheque', slot_back: 'Dorso del cheque',
    required: 'Requerido', optional: 'Opcional',
    dz_primary: 'Arrastrá una imagen o buscá en tu equipo', max_size: 'máx. 10 MB',
    back_note: 'Requerido solo para verificar endoso',
    accepted_formats: 'PNG, TIF/TIFF',
    process: 'Procesar cheque', load_sample: 'Usar cheque de ejemplo',
    opt_sig: 'Detección de firma', opt_ev: 'Incluir evidencia',
    confidence: 'Confianza',
    total_time: 'Tiempo total',
    extracted: 'Campos extraídos',
    col_field: 'Campo', col_value: 'Valor extraído', col_conf: 'Confianza',
    copy_json: 'Copiar JSON', copied: 'Copiado', download_json: 'Descargar .json',
    raw_json: 'Ver respuesta cruda de la API',
    how_kicker: 'Cómo funciona', how_title: 'Del cheque al JSON en cuatro pasos',
    how_1t: 'Ingesta', how_1d: 'Subí una imagen PNG o TIFF del cheque. Sin preprocesamiento manual.',
    how_2t: 'Normalización + OCR', how_2d: 'Se corrige perspectiva y ruido, se ejecuta OCR y se tokeniza el documento.',
    how_3t: 'Inferencia ICR', how_3d: 'LayoutLMv3 identifica y clasifica cada campo con score por token.',
    how_4t: 'Salida estructurada', how_4d: 'JSON con valores crudos, normalizados y MICR desglosado.',
    how_5t: 'Verificación de firma y endoso', how_5d: 'Un modelo de visión entrenado a medida detecta la presencia de firma y verifica el endoso del dorso, con su propio score de confianza.',
    spec_kicker: 'Producto', spec_title: 'Ficha técnica',
    spec_fields: 'Campos soportados', spec_fields_v: '9 (payee, maker, amount, amount_words, date, bank, check_number, MICR line, maker_address)',
    spec_formats: 'Formatos aceptados', spec_formats_v: 'PNG, TIF/TIFF · hasta 10 MB',
    spec_lat: 'Latencia típica', spec_lat_v: '1.1 – 1.4 s por cheque (p95)',
    spec_deploy: 'Modo de despliegue', spec_deploy_v: 'Cloud gestionada o on-premise (Docker / Kubernetes)',
    spec_base: 'Modelo base', spec_base_v: 'LayoutLMv3 fine-tuned · ONNX Runtime',
    spec_api: 'Protocolo', spec_api_v: 'REST, multipart/form-data, respuesta JSON',
    spec_sec: 'Seguridad', spec_sec_v: 'TLS 1.3, sin persistencia de imágenes, aislamiento por tenant',
    contact_kicker: 'Contacto', contact_title: 'Hablemos de su integración',
    f_name: 'Nombre', f_email: 'Email corporativo', f_company: 'Empresa', f_message: 'Mensaje', f_submit: 'Enviar',
    err_email: 'Ingresá un email corporativo válido',
    err_name_required: 'Ingresá tu nombre',
    err_message_required: 'Escribí tu consulta',
    err_field_too_long: 'El texto supera el largo máximo permitido',
    f_sending: 'Enviando…',
    contact_ok_title: 'Mensaje enviado',
    contact_ok_body: 'Gracias por escribirnos. Respondemos en menos de un día hábil.',
    contact_err_title: 'No pudimos enviar el mensaje',
    contact_err_body: 'Probá de nuevo en unos minutos, o escribinos directamente a info@checktodata.com.',
    contact_err_rate: 'Recibimos varios mensajes desde tu conexión. Esperá un rato antes de volver a intentar.',
    contact_direct: 'Directo', contact_note: 'Respondemos en menos de un día hábil. Podemos coordinar una prueba con tus propias imágenes bajo NDA.',
    privacy: 'Privacidad', terms: 'Términos',
    err_title: 'No pudimos procesar el cheque',
    retry: 'Reintentar',
    f_amount: 'Monto', f_amount_words: 'Monto en letras', f_date: 'Fecha', f_payee: 'Beneficiario', f_maker: 'Librador', f_maker_addr: 'Domicilio del librador', f_bank: 'Banco', f_check_number: 'Número de cheque', f_micr_line: 'Línea MICR', f_micr_routing: 'MICR · Routing', f_micr_account: 'MICR · Cuenta', f_micr_check: 'MICR · Nro. de cheque',
    results_kicker: 'Resultado de la extracción', results_title: 'Datos extraídos',
    chip_confidence: 'Confianza', chip_latency: 'Latencia', chip_fields: 'Campos', chip_scope: 'Alcance',
    scope_front: 'Frente', scope_both: 'Frente + dorso',
    tab_front: 'Frente', tab_back: 'Dorso',
    sub_signature: 'Firma',
    verdict_kicker: 'Verificación de endoso',
    verdict_valid: 'Endoso válido', verdict_absent: 'Endoso ausente', verdict_illegible: 'Endoso ilegible',
    cotejo_kicker: 'Cotejo frente ↔ dorso',
    cotejo_front: 'Beneficiario (frente)', cotejo_back: 'Endosatario (dorso)',
    cotejo_match: 'Coincide', cotejo_nomatch: 'No coincide', cotejo_unknown: 'No verificable',
    f_car_lar: 'Cotejo CAR–LAR',
    car_lar_desc: 'CAR: importe en números · LAR: importe en letras',
    car_lar_note_mismatch: 'Los importes no coinciden. El importe en letras (LAR) prevalece legalmente sobre el importe en números (CAR).',
    car_lar_note_unknown: 'Falta uno de los dos importes o no pudo normalizarse, así que el cotejo no puede confirmarse.',
    cotejo_note: 'La API de verificación de endoso no expone el endosatario del dorso, por lo que este cotejo no puede confirmarse automáticamente hoy.',
    sig_detected: 'Firma detectada', sig_not_detected: 'Firma no detectada',
    conf_high: 'alta', conf_good: 'buena', conf_med: 'revisar', conf_low: 'baja',
    err_unsupported_format: 'Formato no soportado. Usá PNG o TIFF.',
    err_too_large: 'El archivo supera el tamaño máximo de 10 MB.',
    cold_start_title: 'Esta respuesta fue más lenta de lo habitual',
    cold_start_body: 'La API estaba en reposo y tuvo que reactivarse, así que esta medición no refleja la latencia real del servicio. Volvé a ejecutar la prueba para medirla.',
    run_again: 'Volver a ejecutar',
    processing_status: 'Procesando cheque…',
    err_timeout: 'La API estaba en reposo y tardó más de lo esperado en reactivarse. Probá de nuevo: la próxima ejecución debería ser rápida.',
};

const en: Record<keyof typeof es, string> = {
    nav_product: 'Product', nav_how: 'How it works', nav_contact: 'Contact',
    hero_pill: 'ICR engine for bank checks',
    hero_title: 'Check data extraction with measurable confidence',
    hero_sub: 'ICR engine fine-tuned on LayoutLMv3, returning normalized fields, parsed MICR line, signature and endorsment classification with per-field confidence scores.',
    metrics_title: 'Production performance',
    metric_fields: 'Fields extracted', metric_acc: 'Average precision', metric_lat: 'Mean latency',
    demo_title: 'Try the engine with your own check', demo_sub: 'The response you see here is what your integration consumes.',
    api_ok: 'API operational',
    slot_front: 'Check front', slot_back: 'Check back',
    required: 'Required', optional: 'Optional',
    dz_primary: 'Drop an image or browse your computer', max_size: 'max 10 MB',
    back_note: 'Required only to verify endorsement',
    accepted_formats: 'PNG, TIF/TIFF',
    process: 'Process check', load_sample: 'Use sample check',
    opt_sig: 'Signature detection', opt_ev: 'Include evidence',
    confidence: 'Confidence',
    total_time: 'Total time',
    extracted: 'Extracted fields',
    col_field: 'Field', col_value: 'Extracted value', col_conf: 'Confidence',
    copy_json: 'Copy JSON', copied: 'Copied', download_json: 'Download .json',
    raw_json: 'View raw API response',
    how_kicker: 'How it works', how_title: 'From check to JSON in four steps',
    how_1t: 'Ingest', how_1d: 'Upload a PNG or TIFF of the check. No manual preprocessing.',
    how_2t: 'Normalization + OCR', how_2d: 'Perspective and noise are corrected, OCR runs and the document is tokenized.',
    how_3t: 'ICR inference', how_3d: 'LayoutLMv3 identifies and classifies each field with per-token scores.',
    how_4t: 'Structured output', how_4d: 'JSON with raw values, normalized values, and parsed MICR.',
    how_5t: 'Signature and endorsement check', how_5d: 'A purpose-built vision model detects signature presence and verifies the back-side endorsement, each with its own confidence score.',
    spec_kicker: 'Product', spec_title: 'Technical spec',
    spec_fields: 'Supported fields', spec_fields_v: '9 (payee, maker, amount, amount_words, date, bank, check_number, MICR line, maker_address)',
    spec_formats: 'Accepted formats', spec_formats_v: 'PNG, TIF/TIFF · up to 10 MB',
    spec_lat: 'Typical latency', spec_lat_v: '0.75 – 1.4 s per check (p95)',
    spec_deploy: 'Deployment mode', spec_deploy_v: 'Managed cloud or on-premise (Docker / Kubernetes)',
    spec_base: 'Base model', spec_base_v: 'LayoutLMv3 fine-tuned · ONNX Runtime',
    spec_api: 'Protocol', spec_api_v: 'REST, multipart/form-data, JSON response',
    spec_sec: 'Security', spec_sec_v: 'TLS 1.3, no image persistence, per-tenant isolation',
    contact_kicker: 'Contact', contact_title: 'Let’s talk about your integration',
    f_name: 'Name', f_email: 'Work email', f_company: 'Company', f_message: 'Message', f_submit: 'Send',
    err_email: 'Enter a valid work email',
    err_name_required: 'Enter your name',
    err_message_required: 'Write your enquiry',
    err_field_too_long: 'This text exceeds the maximum allowed length',
    f_sending: 'Sending…',
    contact_ok_title: 'Message sent',
    contact_ok_body: 'Thanks for reaching out. We respond within one business day.',
    contact_err_title: 'We couldn’t send your message',
    contact_err_body: 'Please try again in a few minutes, or email us directly at info@checktodata.com.',
    contact_err_rate: 'We’ve received several messages from your connection. Please wait a while before trying again.',
    contact_direct: 'Direct', contact_note: 'We respond within one business day. Happy to run a pilot on your own images under NDA.',
    privacy: 'Privacy', terms: 'Terms',
    err_title: 'We couldn’t process the check',
    retry: 'Retry',
    f_amount: 'Amount', f_amount_words: 'Amount in words', f_date: 'Date', f_payee: 'Payee', f_maker: 'Maker', f_maker_addr: 'Maker address', f_bank: 'Bank', f_check_number: 'Check number', f_micr_line: 'MICR line', f_micr_routing: 'MICR · Routing', f_micr_account: 'MICR · Account', f_micr_check: 'MICR · Check number',
    results_kicker: 'Extraction result', results_title: 'Extracted data',
    chip_confidence: 'Confidence', chip_latency: 'Latency', chip_fields: 'Fields', chip_scope: 'Scope',
    scope_front: 'Front', scope_both: 'Front + back',
    tab_front: 'Front', tab_back: 'Back',
    sub_signature: 'Signature',
    verdict_kicker: 'Endorsement verification',
    verdict_valid: 'Endorsement valid', verdict_absent: 'Endorsement missing', verdict_illegible: 'Endorsement illegible',
    cotejo_kicker: 'Front ↔ back match',
    cotejo_front: 'Payee (front)', cotejo_back: 'Endorsee (back)',
    cotejo_match: 'Matches', cotejo_nomatch: 'Does not match', cotejo_unknown: 'Not verifiable',
    f_car_lar: 'CAR–LAR check',
    car_lar_desc: 'CAR: numeric amount · LAR: written amount',
    car_lar_note_mismatch: 'The amounts differ. The written amount (LAR) legally prevails over the numeric amount (CAR).',
    car_lar_note_unknown: 'One of the two amounts is missing or could not be normalized, so the comparison cannot be confirmed.',
    cotejo_note: 'The endorsement verification API does not expose the back-side endorsee, so this match cannot be confirmed automatically today.',
    sig_detected: 'Signature detected', sig_not_detected: 'Signature not detected',
    conf_high: 'high', conf_good: 'good', conf_med: 'review', conf_low: 'low',
    err_unsupported_format: 'Unsupported format. Use PNG or TIFF.',
    err_too_large: 'File exceeds the 10 MB size limit.',
    cold_start_title: 'This response was slower than usual',
    cold_start_body: 'The API was asleep and had to wake up, so this measurement doesn’t reflect the service’s real latency. Run it again to measure it.',
    run_again: 'Run again',
    processing_status: 'Processing check…',
    err_timeout: 'The API was asleep and took longer than expected to wake up. Try again: the next run should be fast.',
};

const DICT: Record<Lang, typeof es> = { es, en };

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly langSignal = signal<Lang>(this.readStoredLang());

  readonly lang = this.langSignal.asReadonly();
  readonly t = computed(() => DICT[this.langSignal()]);

  setLang(lang: Lang): void {
    this.langSignal.set(lang);
    try {
      localStorage.setItem('checkicr_lang', lang);
    } catch {
      /* ignore storage errors (private browsing, etc.) */
    }
  }

  private readStoredLang(): Lang {
    try {
      const stored = localStorage.getItem('checkicr_lang');
      if (stored === 'en' || stored === 'es') return stored;
    } catch {
      /* ignore */
    }
    return 'en';
  }
}
