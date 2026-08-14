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
├── checktodata-mail-config.php   ← ACÁ (no accesible por HTTP)
└── public_html/                  ← el web root
    ├── index.html
    ├── contact.php
    └── main-XXXXXXXX.js
```

En FileZilla: parate en la carpeta donde ves `index.html`, subí un nivel con `..`, y
soltá el archivo ahí.

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
| `server_misconfigured` | No encontró el archivo de credenciales, o le falta una clave | Que esté subido y un nivel arriba del web root |
| `send_failed` | El SMTP rechazó la conexión, el login o el envío | Error log: suele ser contraseña incorrecta o el puerto 465 bloqueado |
| `rate_limited` | Se superaron los 5 envíos por hora desde esa IP | Esperar, o subir `RATE_LIMIT_PER_HOUR` |
| `validation_failed` | Datos inválidos según el servidor | El campo puntual viene en `fields` |
| Devuelve el código PHP como texto | PHP no está habilitado en el hosting | Activarlo en el panel de Donweb |

Si el formulario responde bien pero el mail no llega, revisá la carpeta de spam antes de
tocar código, y de ahí saltá a la sección de entregabilidad de más arriba.

## Rotar la contraseña

Cambiá la contraseña del buzón desde el panel de Donweb y actualizá el
`checktodata-mail-config.php` **del servidor**. Es el único lugar donde vive: no está en
el repositorio ni dentro del build.
