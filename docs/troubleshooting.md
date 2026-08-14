# Problemas conocidos y trampas resueltas

Dos secciones: lo que **sigue abierto** y hay que tener presente, y lo que **ya se
resolvió** pero conviene documentar porque volvería a morder si alguien toca esa zona.

---

## Abierto

### CORS: la API rechaza todos los orígenes

**Síntoma.** Al procesar un cheque, el navegador muestra un error de red genérico —
`status: 0`, `statusText: undefined`, o *«Missing Allow Origin Header»*. No es un error
HTTP normal: el navegador bloquea la respuesta antes de que llegue al código, así que
Angular no puede reportar nada más específico.

**Causa.** El backend rechaza el *preflight* de **todos** los orígenes probados —
`checktodata.com`, `www.checktodata.com` e incluso `localhost:4200`:

```
OPTIONS /api/predict   Origin: https://checktodata.com   →  400 "Disallowed CORS origin"
```

La lista de orígenes permitidos sale de la variable de entorno `ALLOWED_ORIGINS`, que el
backend lee al arrancar (`app/main.py`). En el despliegue actual quedó con un valor que no
incluye ningún origen real.

**Por qué `/api/health` sí anda.** Es un `GET` simple que no dispara preflight. Que el
health responda 200 **no** significa que CORS esté bien.

**Solución.** No se arregla desde este proyecto: hay que corregir `ALLOWED_ORIGINS` en el
Container App `ocr-ch` para que incluya el dominio del sitio. Mientras siga así, ningún
build —local o publicado— va a poder llamar a `/predict` desde el navegador.

### Arranque en frío de la API

El Container App escala a cero, así que **el primer request después de un rato tarda
bastante más** que los siguientes.

Lo que ya hace el sitio para amortiguarlo:

- Un `warmUp()` que pega un `GET /api/health` al cargar la demo, para ir despertando el
  contenedor antes de que el usuario suba un cheque (`src/app/core/icr-api.service.ts`).
- Un timeout generoso de **90 s** en las llamadas a la API.
- Detección de arranque en frío: si el tiempo medido por el cliente supera por mucho al
  que informa la API, se muestra un aviso aclarando que esa medición no refleja la
  latencia real del servicio.
- Si aun así se agota el timeout, el mensaje de error lo explica y sugiere reintentar, en
  lugar de mostrar un error genérico.

Si los timeouts persisten, hay que subir el valor o revisar el arranque del contenedor —
no es algo que se resuelva del lado del sitio.

---

## Resuelto (no repetir)

### Los TIFF no se previsualizaban, sólo en producción

**Síntoma.** Al subir un `.tif`, no aparecía la vista previa. El archivo **sí** quedaba
cargado y la API lo procesaba bien. En `npm start` funcionaba perfecto; sólo fallaba en el
sitio publicado, sin ningún error en consola.

**Causa.** `utif2` es un módulo CommonJS. El build de producción lo empaqueta exponiendo
únicamente `default`:

```js
export default mt();   // ← final del chunk generado
```

El código hacía:

```ts
const UTIF = await import('utif2');
UTIF.decode(buffer);      // undefined en producción → TypeError
```

En desarrollo funcionaba porque el dev server sintetiza *named exports* para dependencias
CommonJS. En producción no, así que `UTIF.decode` era `undefined`.

**Por qué costó tanto encontrarlo.** El `.catch()` que envolvía la conversión descartaba el
error en silencio y dejaba la vista previa vacía. No había síntoma visible: ni error en
consola, ni request fallido, ni nada en la interfaz. **El bug real fue tanto la interop
como el error silenciado.**

**Solución** (`src/app/shared/tiff-preview.util.ts`): desenvolver `default` de forma
defensiva.

```ts
const mod = await import('utif2');
const UTIF = (mod as any).default ?? mod;
```

**Lecciones para el futuro:**

- Al importar dinámicamente una dependencia CommonJS, contemplá siempre `default ?? mod`.
  Los avisos `Module 'X' is not ESM` del build son la pista de qué paquetes están en
  riesgo.
- **Nunca descartes un error en un `catch` vacío.** Ese `catch` ahora hace `console.error`.
- Un bug que sólo aparece en producción hay que reproducirlo **sirviendo el `dist/`
  localmente**, no en el dev server. Eso descarta el hosting y aísla el problema al build
  en un paso.

### Diagnosticar un bug que sólo pasa en producción

Método que funcionó, por si hace falta repetirlo:

1. Servir `dist/checkicr-web/browser/` con cualquier servidor estático local. Si el bug
   reproduce, **no es el hosting**: es el build.
2. Comprobar que los chunks se descargan bien (código 200 y `Content-Type` de JavaScript,
   no HTML).
3. Leer el bundle compilado en la zona sospechosa. El código minificado es incómodo pero
   muestra exactamente qué se ejecuta — fue lo que reveló el `t.decode` sobre un namespace
   que no tenía ese método.

Un detalle que costó tiempo: **los `console.log` de la aplicación no siempre se capturan**
al automatizar el navegador, y en producción pueden estar optimizados. Verificar contra el
DOM real (¿apareció el elemento?, ¿se habilitó el botón?) es mucho más confiable que
depender de logs inyectados.
