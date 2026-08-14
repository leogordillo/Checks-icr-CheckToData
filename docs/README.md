# CheckToData — documentación del sitio

Landing page y demo interactiva de CheckToData (`checktodata.com`). Angular 22, sin
backend propio salvo un único script PHP para el formulario de contacto.

## Índice

| Documento | Para qué |
|---|---|
| [deployment.md](deployment.md) | Cómo compilar y publicar el sitio por FTP en Donweb |
| [contact-form.md](contact-form.md) | Formulario de contacto: configuración de credenciales, arquitectura, diagnóstico |
| [troubleshooting.md](troubleshooting.md) | Problemas conocidos y trampas ya resueltas |

## Panorama general

```
Navegador ──► checktodata.com (Donweb, detrás de Cloudflare)
               │
               ├── index.html + JS/CSS  ← el SPA de Angular
               ├── contact.php          ← formulario de contacto → SMTP de Donweb
               └── fetch a la API ─────► ocr-ch...azurecontainerapps.io/api
                                          (FastAPI + ONNX, repo aparte)
```

El sitio es **estático**: se sirve tal cual desde el hosting compartido. Las dos únicas
piezas dinámicas son:

- **`contact.php`**, que corre en el propio hosting y manda mail por SMTP.
- **La API de inferencia**, que vive en Azure Container Apps y es un proyecto separado
  (`Checks-icr-fastapi`). El sitio sólo la consume.

## Estructura del proyecto

```
CheckToData/
├── src/
│   ├── app/
│   │   ├── core/            servicios transversales (i18n, API, toasts)
│   │   ├── features/        secciones de la página (hero, demo, contacto…)
│   │   └── shared/          utilidades y componentes reutilizables
│   └── environments/        URL de la API por entorno
├── public/                  copiado tal cual a la raíz publicada (incluye contact.php)
├── deploy/                  plantillas de configuración del servidor (no se publican)
├── docs/                    esta documentación
└── dist/checkicr-web/browser/   ← salida del build, lo que se sube por FTP
```

Todo lo que esté en `public/` termina en la raíz del sitio publicado. Por eso
`contact.php` vive ahí: sobrevive a cada build sin pasos manuales.

En cambio `deploy/` **no** se publica: contiene la plantilla de credenciales que se sube
por separado y fuera del web root (ver [contact-form.md](contact-form.md)).

## Comandos

```bash
npm start        # servidor de desarrollo en http://localhost:4200
npm run build    # build de producción → dist/checkicr-web/browser/
npm test         # tests unitarios (Vitest)
```

> `npm start` levanta el sitio pero **no** ejecuta PHP, así que el formulario de contacto
> no funciona en desarrollo. Ver [contact-form.md](contact-form.md#probar-en-desarrollo).

## Idiomas

La página está en español e inglés, con **inglés por defecto**. El diccionario completo
está en `src/app/core/i18n.service.ts`; ambos idiomas comparten el mismo juego de claves y
TypeScript falla el build si a uno le falta alguna.

La elección del visitante se guarda en `localStorage` bajo la clave `checkicr_lang`. Quien
ya eligió idioma conserva el suyo aunque cambie el valor por defecto.
