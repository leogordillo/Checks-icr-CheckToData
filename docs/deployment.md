# Publicación del sitio

El sitio se publica subiendo archivos estáticos por FTP a un hosting compartido de
**Donweb**, con **Cloudflare** por delante. No hay pipeline de CI: el deploy es manual.

## 1. Compilar

```bash
npm run build
```

La salida queda en:

```
dist/checkicr-web/browser/
```

**Esa carpeta interior `browser/` es la que se publica**, no `dist/` ni
`dist/checkicr-web/`. Angular deja junto a ella un `3rdpartylicenses.txt` y un
`prerendered-routes.json` que no forman parte del sitio y no hace falta subir.

Contenido típico de un build:

| Archivo | Qué es |
|---|---|
| `index.html` | Punto de entrada |
| `main-XXXXXXXX.js` | Bundle principal de la aplicación |
| `chunk-XXXXXXXX.js` (grande, ~108 kB) | Decodificador de TIFF (`utif2`), se carga bajo demanda |
| `chunk-XXXXXXXX.js` (chico) | Código compartido |
| `styles-XXXXXXXX.css` | Estilos |
| `contact.php` | Endpoint del formulario de contacto |
| `register.php`, `use.php`, `demo-common.php` | Acceso a la demo: registro, cupos y métricas (ver [demo-access.md](demo-access.md)) |
| `CheckToData*.png/.jpg`, `favicon.ico` | Logos, favicon e imagen para redes sociales |

Los nombres llevan un hash que **cambia en cada build**. Eso importa: ver
[Errores frecuentes](#errores-frecuentes-al-deployar).

## 2. Subir por FTP

Subí **todo el contenido** de `dist/checkicr-web/browser/` a la carpeta que sirve el
sitio (la que contiene `index.html`; en Donweb suele ser `public_html/`).

Recomendación: **reemplazá la carpeta completa** en vez de ir archivo por archivo. Como
los nombres tienen hash, un deploy parcial deja un `index.html` nuevo apuntando a chunks
que no existen, y la página carga rota o a medias.

Los chunks viejos que queden huérfanos no rompen nada, pero conviene limpiarlos de vez en
cuando para que la carpeta no crezca sin control.

> **Los `.php` van dentro del web root, junto a `index.html`.** Son endpoints que el
> navegador invoca por URL; fuera del web root responden `404 File not found.` Lo único
> que va un nivel arriba es el archivo de credenciales (y la base `.sqlite`, que se crea
> sola ahí). Ver el árbol en [contact-form.md](contact-form.md).

### Lo que NO se sube

- `deploy/` — es la plantilla de credenciales, va **fuera** del web root y se sube una
  única vez a mano (ver [contact-form.md](contact-form.md)).
- `node_modules/`, `src/`, `docs/` — nada de eso tiene que estar en el servidor.

## 3. Verificar

Después de subir:

1. Abrí `checktodata.com` en una ventana privada (evita el caché del navegador).
2. Revisá la consola del navegador: no debería haber errores de recursos 404.
3. Probá la demo con un PNG y con un TIFF — el TIFF ejercita el chunk lazy, que es
   justamente lo que un deploy incompleto deja roto.
4. Probá el formulario de contacto y confirmá que llega el mail.

### Caché de Cloudflare

El sitio está detrás de Cloudflare. Como los archivos llevan hash en el nombre, un deploy
normal se ve enseguida sin purgar nada. La excepción es `index.html`, que conserva el
mismo nombre: si tras subir seguís viendo la versión anterior, purgá la caché de
Cloudflare o probá con `?cb=123` al final de la URL para saltearla.

## Configuración por entorno

La URL de la API vive en `src/environments/`:

| Archivo | Se usa en |
|---|---|
| `environment.ts` | `npm start` (desarrollo) |
| `environment.prod.ts` | `npm run build` (producción) |

Hoy **ambos apuntan al mismo Container App de Azure**, así que en desarrollo se consume la
API real. Si en algún momento aparece un entorno de staging, este es el archivo a tocar.

## Errores frecuentes al deployar

**La página carga en blanco o a medias.** Casi siempre es un deploy parcial: el
`index.html` nuevo referencia un `main-*.js` o `chunk-*.js` que no llegó a subirse. Mirá
la pestaña Network buscando un 404 sobre un `.js`. Solución: volver a subir la carpeta
completa.

**Un archivo `.js` responde HTML en vez de JavaScript.** Es una regla de reescritura del
hosting mandando todo a `index.html`. En un sitio de una sola página como este no hace
falta ninguna regla de reescritura; si aparece, hay que excluir los archivos que existen
de verdad.

**Se ve la versión anterior.** Caché de Cloudflare sobre `index.html`. Purgar o probar con
un parámetro de query.

**El formulario de contacto responde `server_misconfigured`.** No es un problema del
build: falta el archivo de credenciales en el servidor. Ver
[contact-form.md](contact-form.md).
