# Formulario de contacto

El formulario de la sección **Contacto** envía un mail a `info@checktodata.com` usando el
servidor SMTP del propio hosting de Donweb.

## Puesta en marcha (una sola vez)

Sin este paso el formulario responde `server_misconfigured` y no envía nada.

### 1. Preparar el archivo de credenciales

Copiá la plantilla [`deploy/checktodata-mail-config.example.php`](../deploy/checktodata-mail-config.example.php)
y renombrá la copia a **`checktodata-mail-config.php`** (sin `.example`).

Ya viene con el servidor, el puerto y el usuario cargados. Lo único que falta es la
contraseña del buzón:

```php
'password' => 'PUT-THE-MAILBOX-PASSWORD-HERE',
```

Poné ahí la contraseña real de `info@checktodata.com`, entre comillas simples. Caracteres
como `@`, `*` o `$` no necesitan escaparse dentro de comillas simples en PHP.

### 2. Subirlo FUERA del web root

Este archivo va **un nivel arriba** de la carpeta que sirve el sitio:

```
/home/tuusuario/
├── checktodata-mail-config.php   ← SOLO este archivo va acá (no accesible por HTTP)
├── checktodata-demo.sqlite       ← se crea sola, también fuera del web root
└── public_html/                  ← el web root
    ├── index.html
    ├── contact.php               ← los .php van ACÁ ADENTRO
    ├── register.php
    ├── use.php
    ├── demo-common.php
    └── main-XXXXXXXX.js
```

En FileZilla: parate en la carpeta donde ves `index.html`, subí un nivel con `..`, y
soltá **el archivo de credenciales** ahí.

> **Los `.php` del sitio NO se mueven.** Sólo el archivo de credenciales y la base de
> datos viven fuera del web root. `contact.php`, `register.php`, `use.php` y
> `demo-common.php` son endpoints que el navegador invoca por URL: si los sacás del web
> root dejan de existir para el mundo y toda llamada responde `404 File not found.`
>
> La separación es entre **código** (público, tiene que ser alcanzable) y **secretos**
> (nunca alcanzables). `demo-common.php` puede estar en el web root sin riesgo: no
> contiene credenciales — las lee del archivo de afuera — y responde 404 si se lo pide
> directamente.

`contact.php` lo busca solo, uno y dos niveles hacia arriba, así que con esa ubicación
funciona sin tocar código.

### Por qué fuera del web root

Si quedara junto a `contact.php`, cualquiera podría pedir
`https://checktodata.com/checktodata-mail-config.php`. Normalmente PHP lo ejecutaría y no
devolvería nada visible, **pero si PHP estuviera deshabilitado o mal configurado, Apache
lo serviría como texto plano con la contraseña a la vista**. Fuera del web root no existe
URL que llegue a él.

Por la misma razón el archivo real está en `.gitignore`: al repositorio sólo va la
plantilla, nunca una copia con la contraseña.

## Cómo funciona

```
Formulario (Angular)
      │  POST contact.php   {name, email, company, message, website}
      ▼
contact.php  ── valida ── honeypot ── rate limit ── SMTP ──► a0161088.ferozo.com:465
      │                                                              │
      └─── JSON {ok:true} ó {ok:false, error, fields} ◄──────────────┘
```

Cliente y endpoint se sirven **desde el mismo dominio**, así que no interviene CORS. Fue
un motivo de peso para resolverlo con PHP en el propio hosting en lugar de agregarlo a la
API de Azure (ver [troubleshooting.md](troubleshooting.md#cors-la-api-rechaza-todos-los-orígenes)).

### Archivos involucrados

| Archivo | Rol |
|---|---|
| `public/contact.php` | Endpoint: valida y envía por SMTP |
| `deploy/checktodata-mail-config.example.php` | Plantilla de credenciales |
| `src/app/features/contact/contact.ts` | Validación de cliente, estados, envío |
| `src/app/features/contact/contact.html` | Campos, errores y honeypot |
| `src/app/core/toast.service.ts` | Avisos de éxito y error |
| `src/app/shared/toast/` | Componente visual del aviso |

### Envío SMTP sin dependencias

`contact.php` implementa un cliente SMTP mínimo sobre `ssl://` (puerto 465, TLS
implícito). **No usa PHPMailer ni Composer**, justamente para no tener que subir una
carpeta `vendor/` por FTP y mantenerlo en un único archivo autocontenido.

Contempla los detalles del protocolo que suelen romperse al hacerlo a mano: respuestas
multilínea, *dot-stuffing* en el bloque `DATA`, y finales de línea CRLF.

### Cabecera `From` y entregabilidad

El mail sale **desde `info@checktodata.com`**, con la dirección del visitante en
`Reply-To`. Es deliberado: poner al visitante en `From` hace fallar SPF/DKIM y el mensaje
termina en spam o rebotado. Respondiendo al mail le contestás igual al visitante.

Si los mensajes llegan a spam, revisá que el dominio tenga SPF, DKIM y DMARC configurados
en el DNS.

## Protecciones

| Mecanismo | Detalle |
|---|---|
| **Validación doble** | Cliente y servidor validan por separado. La del cliente es sólo UX: se saltea trivialmente, por eso el servidor no confía en ella. |
| **Honeypot** | Un campo `website` oculto fuera de pantalla. Los humanos no lo ven; los bots lo completan. Si viene con contenido, el servidor responde `200 OK` y no envía nada — el bot no recibe señal de que fue detectado. |
| **Rate limit** | 5 envíos por hora por IP, con contador en archivo y lock. Si no puede escribir el contador, deja pasar el envío en vez de bloquear a un usuario real. |
| **Inyección de cabeceras** | Cualquier salto de línea en nombre, email o empresa es rechazado; es el vector clásico para inyectar destinatarios. |
| **Límites de longitud** | Definidos en `MAX_LENGTHS` y replicados en el cliente. **Si cambiás uno, cambiá el otro.** |

El honeypot depende de que el campo siga oculto y con `tabindex="-1"`. Si se toca ese
markup, hay que verificar que no aparezca en pantalla ni en el orden de tabulación.

## Comportamiento visible

| Situación | Qué ve el usuario |
|---|---|
| Campos incompletos o email inválido | Error debajo del campo. No se llama al servidor. |
| Enviando | Botón deshabilitado con spinner y texto «Enviando…» |
| Éxito | Toast verde y formulario vacío |
| Falla de envío (5xx) | Toast rojo **conservando lo escrito**, para no obligar a reescribir |
| Demasiados intentos (429) | Toast rojo con el texto específico de límite alcanzado |
| Rechazo de validación del servidor (422) | Error debajo del campo correspondiente, sin toast |

Los toasts se cierran solos a los 6 segundos, o con la ×.

## Probar en desarrollo

`npm start` sirve el sitio con el dev server de Angular, que **no ejecuta PHP**. El
formulario valida y muestra estados, pero el POST a `contact.php` falla siempre.

Para probar el circuito completo hay dos caminos:

- Levantar el `dist/` con un servidor que soporte PHP (XAMPP, Laragon, `php -S`).
- Probar directamente contra el sitio publicado.

La lógica de interfaz (validación, estados, toasts) sí se puede verificar en desarrollo
simulando el endpoint con cualquier servidor que devuelva los códigos 200 / 422 / 429 /
502.

## Diagnóstico

El navegador nunca ve el detalle de un fallo SMTP: sería filtrar información del servidor.
**El detalle queda en el error log de PHP del hosting**, accesible desde el panel de
Donweb.

| Respuesta | Significado | Qué mirar |
|---|---|---|
| `404 File not found.` | El `.php` no está en el web root | Moverlo junto a `index.html` (ver el árbol de más arriba) |
| `server_misconfigured` | No encontró el archivo de credenciales, o le falta una clave | Que esté subido y un nivel arriba del web root |
| `send_failed` | El SMTP rechazó la conexión, el login o el envío | Ver **Diagnosticar un fallo de envío** abajo |
| `rate_limited` | Se superaron los 5 envíos por hora desde esa IP | Esperar, o subir `RATE_LIMIT_PER_HOUR` |
| `validation_failed` | Datos inválidos según el servidor | El campo puntual viene en `fields` |
| Devuelve el código PHP como texto | PHP no está habilitado en el hosting | Activarlo en el panel de Donweb |

### Diagnosticar un fallo de envío

Poné `'debug' => true` en el archivo de credenciales del servidor. Con eso, un envío
fallido devuelve el error SMTP real en el JSON (`detail`) y la interfaz lo muestra, sin
depender de encontrar el error log del hosting. **Volvé a `false` cuando funcione:** el
detalle expone información interna del servidor.

> **Caso ya resuelto en este hosting: bloqueo geográfico.** El servidor de correo
> externo (`a0161088.ferozo.com`) rechaza las conexiones desde Argentina/Sudamérica con
> `550 5.7.1 Blacklisted`, en los tres puertos. En el 465 no se ve ese mensaje: aparece
> como `SSL: Connection reset by peer`, porque el servidor corta durante el handshake.
>
> Por eso el envío usa el **relay local** (`localhost:25`, sin cifrado ni
> autenticación): el correo no sale de la máquina para ser entregado, así que el bloqueo
> no aplica. Si algún día se levanta la restricción, se puede volver al servidor externo
> cambiando `host`/`port`/`secure`/`auth`.

| El error dice | Causa | Solución |
|---|---|---|
| `550 5.7.1 Blacklisted` | El servidor de correo bloquea la región del hosting | Usar el relay local (ver recuadro) |
| `SSL: Connection reset by peer` | Lo mismo, pero en el puerto con TLS implícito | Ídem |
| `535` / `authentication failed` | La contraseña del archivo ya no es la del buzón | Actualizarla — es lo típico después de rotarla |
| `certificate verify failed` / `unable to get local issuer` | PHP no puede validar el certificado del servidor de correo: el hosting no tiene un CA bundle usable, o el certificado no coincide con el host | `'verify_cert' => false` |
| `connect failed … Connection refused` / `timed out` | El hosting bloquea la salida SMTP | Probar `'port' => 587, 'secure' => 'tls'`, o un relay local |
| `Unable to find the socket transport "ssl"` | Falta OpenSSL en PHP | Habilitar la extensión en el panel |
| `getaddrinfo failed` | No resuelve el host desde adentro del servidor | Probar `'host' => 'localhost'` |

**Cómo leer el error.** Si trae un `errno` real (110, 111…) el problema es de red: puerto
bloqueado o host inalcanzable. Si en cambio dice **`(0)`**, la falla fue por encima de TCP
— falta el transporte `ssl://` o el handshake TLS fue rechazado. Ese es el caso donde
`'verify_cert' => false` suele destrabar.

### `smtp-check.php`: el atajo

En vez de ir probando combinaciones de a una, con `'debug' => true` podés abrir en el
navegador:

```
https://checktodata.com/smtp-check.php
```

Prueba de un saque TCP a 465/587/25, un relay en `localhost`, y TLS con y sin validación
de certificado; devuelve un `resumen` con qué conectó y qué no, más el saludo del servidor
y todos los warnings de cada intento. De ahí se lee directamente qué combinación de
`host`/`port`/`secure`/`verify_cert` poner en la configuración.

No envía correo ni muestra la contraseña. **Borralo del servidor** (o dejá `debug` en
`false`) cuando el envío funcione.

Mientras configurás, `'rate_limit_register'` sube el tope de registros por hora y por IP,
para no bloquearte a vos mismo probando.

El envío soporta las tres modalidades vía `'secure'`: `ssl` (465, TLS implícito), `tls`
(587, STARTTLS) y `none` (relay local sin cifrado).

**Nota sobre códigos de estado.** Un fallo de envío responde **424**, no 5xx, a propósito:
el sitio está detrás de Cloudflare, que reemplaza cualquier 5xx del origen por su propia
página de error y se traga el JSON con el motivo. Los 4xx pasan intactos.

Si el formulario responde bien pero el mail no llega, revisá la carpeta de spam antes de
tocar código, y de ahí saltá a la sección de entregabilidad de más arriba.

## Rotar la contraseña

Cambiá la contraseña del buzón desde el panel de Donweb y actualizá el
`checktodata-mail-config.php` **del servidor**. Es el único lugar donde vive: no está en
el repositorio ni dentro del build.
