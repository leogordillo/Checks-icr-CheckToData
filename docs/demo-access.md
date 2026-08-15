# Acceso a la demo: registro, claves y métricas

El botón **Procesar cheque** está protegido: la primera vez pide registrarse (nombre y
apellido, empresa, email) y envía por correo una **clave de acceso** con 20 ejecuciones
válida por 30 días. Cada ejecución se descuenta del saldo en el servidor, y de cada una
queda registrada una fila de métricas numéricas.

**Qué garantiza y qué no.** La imagen del cheque viaja del navegador directo a la API de
Azure — nunca pasa por Donweb. Eso sostiene la promesa de privacidad, pero también
significa que este control es una barrera de cortesía: alguien con conocimientos puede
llamar a la API directo. Para el objetivo (saber quiénes prueban y cuánto) alcanza; un
control duro requeriría API keys en el propio FastAPI.

## Flujo

```
Procesar cheque
  ├─ sin clave guardada ──► modal de registro ──► register.php ──► clave por MAIL
  │                              │                                     │
  │                              └── "¿Ya tenés una clave?" ◄──────────┘
  │                                        │  use.php (check: valida sin consumir)
  ▼                                        ▼
use.php (authorize: descuenta 1) ──► ejecuta ──► use.php (metrics: registra números)
  │
  ├─ vencida / sin saldo ──► "Escribinos para ampliar" → sección contacto
  └─ clave desconocida ────► se descarta y vuelve al registro
```

- La clave que llega por mail es la verificación del registro: prueba que el email
  existe y es accesible.
- Si una ejecución **falla** (p. ej. timeout por arranque en frío de la API), `metrics`
  la reporta como fallida y el servidor **devuelve el uso consumido** — un error no come
  el cupo del visitante.
- Re-registro con el mismo email: si la clave está activa se **reenvía la misma** con su
  saldo (no se emiten claves nuevas, para no regalar cupo); si venció, arranca un ciclo
  nuevo (20 usos, 30 días) con la misma clave.
- `localStorage` solo guarda la clave y el saldo *para mostrar*: el saldo real vive en el
  servidor y se re-verifica en cada ejecución.

## Piezas

| Archivo | Rol |
|---|---|
| `public/register.php` | Alta: valida, genera la clave, la envía por mail |
| `public/use.php` | `check` (valida sin consumir) · `authorize` (descuenta) · `metrics` (registra) |
| `public/demo-common.php` | Include compartido: config, SQLite, cliente SMTP. No es una página: pedirlo por HTTP da 404 |
| `src/app/core/demo-access.service.ts` | HTTP + caché en localStorage |
| `src/app/features/check-demo/access-gate/` | El modal de tres pasos |

El cliente SMTP de `demo-common.php` duplica a propósito el de `contact.php`: ese archivo
ya está deployado y probado, y sin PHP local un refactor no se puede verificar. Si hay que
tocar los dos, `contact.php` es la copia de referencia.

## La base de datos

SQLite, **fuera del web root**, al lado del archivo de credenciales:

```
/home/tuusuario/
├── checktodata-mail-config.php
├── checktodata-demo.sqlite      ← se crea sola en el primer registro
└── public_html/
```

No hay endpoint de administración — deliberadamente. Para ver o editar datos: bajar el
archivo por SFTP, abrirlo con [DB Browser for SQLite](https://sqlitebrowser.org/) (u otra
herramienta), y si se editó, subirlo de vuelta. Conviene hacerlo en momentos de poco
tráfico: si alguien ejecuta mientras tanto, el archivo del servidor cambia y la subida
pisa ese cambio.

### Esquema

**`users`** — una fila por persona registrada:

| Columna | Notas |
|---|---|
| `name`, `company`, `email` | Datos del registro; `email` es único |
| `access_key` | Formato `XXXX-XXXX`, sin caracteres confundibles (0/O, 1/I/L) |
| `quota_total` | Cupo del ciclo. **`NULL` = ilimitado** (testers) |
| `quota_used` | Usos consumidos del ciclo |
| `expires_at` | Fin del ciclo (UTC). **`NULL` = no vence** (testers) |
| `created_at`, `last_used_at`, `ip` | Trazabilidad |

**`runs`** — una fila por ejecución: `ts`, `success`, `total_ms`, `avg_conf`,
`field_count`, `with_back`, `cold_start`.

**Invariante de privacidad:** `runs` guarda números y booleanos, nada más. Agregar una
columna con valores extraídos del cheque, nombres de archivo o imágenes rompería la
promesa pública del sitio («no almacenamos ningún dato de los cheques»). El mismo aviso
está comentado en `demo-common.php` y `use.php`.

### Recetas SQL frecuentes

```sql
-- Tester interno: sin límite de usos ni vencimiento
UPDATE users SET quota_total = NULL, expires_at = NULL WHERE email = 'x@y.com';

-- Ampliar cupo a alguien que lo pidió
UPDATE users SET quota_total = 100 WHERE email = 'x@y.com';

-- Renovar un ciclo vencido a mano
UPDATE users SET quota_used = 0, expires_at = datetime('now', '+30 days') WHERE email = 'x@y.com';

-- ¿Quiénes se registraron y cuánto usaron?
SELECT name, company, email, quota_used, quota_total, last_used_at FROM users ORDER BY created_at DESC;

-- Métricas agregadas
SELECT COUNT(*) runs, AVG(total_ms) avg_ms, AVG(avg_conf) avg_conf,
       SUM(success = 0) failures, SUM(cold_start) cold_starts
FROM runs;
```

## Parámetros

Los defaults (20 usos, 30 días) están en `demo-common.php`:

```php
const DEMO_DEFAULT_QUOTA = 20;
const DEMO_KEY_DAYS = 30;
```

Cambiarlos afecta solo a registros y renovaciones futuros. El texto del modal
(`gate_sub` en `i18n.service.ts`) y el del mail (`register.php`) mencionan los valores —
si se cambian, actualizar los tres lugares.

## Protecciones

Las mismas del formulario de contacto: validación doble (cliente y servidor), honeypot
en el modal, rechazo de saltos de línea en valores que terminan en cabeceras de mail,
y consultas siempre preparadas contra SQLite. La clave nunca viaja en la respuesta HTTP
del registro: solo por correo.

### Límites de envío en `register.php`

Es el único punto del sitio que manda correo a una dirección **elegida por quien llama**,
así que es el candidato natural a convertirse en un cañón de spam. Tres límites, cada uno
tapando un agujero que los otros dejan:

| Límite | Valor | Qué frena |
|---|---|---|
| Por IP | 5/hora (`rate_limit_register`) | El abusador común |
| Por dirección de correo | 2/hora | Que reenviar la clave a la misma víctima se use para bombardearla |
| Global | 60/hora | Una botnet rotando IPs, que anula por completo el límite por IP |

El de por-dirección importa especialmente porque el re-registro **reenvía la clave**: sin
ese tope, repetir el email de un tercero era una forma de mail-bombing.

`use.php` admite 120 llamadas/hora por IP (una ejecución consume hasta 3).

### Lo que estos límites NO cubren

**La API de inferencia no tiene autenticación.** CORS restringe a los navegadores, pero no
es un control de acceso: `curl` no envía `Origin` ni respeta la política, así que cualquier
script puede llamar a `/api/predict` directamente, saltándose el registro, los cupos y las
métricas. El gate mide y ordena el uso legítimo desde la web; no impide el uso directo de
la API. Cerrar eso requiere autenticación en el propio FastAPI (API key por cliente), no
cambios en este sitio.

## Diagnóstico

| Síntoma | Causa probable |
|---|---|
| `404 File not found.` | Los `.php` no están en el web root. Van junto a `index.html`; sólo el config y el `.sqlite` viven un nivel arriba |
| `server_misconfigured` | Falta `checktodata-mail-config.php` fuera del web root, o PHP no puede crear/escribir el `.sqlite` en esa carpeta |
| `send_failed` (HTTP 424) | SMTP rechazó conexión o login — ver [Diagnosticar un fallo de envío](contact-form.md#diagnosticar-un-fallo-de-envío) |
| El modal dice "clave no válida" con una clave correcta | La DB del servidor se reemplazó/limpió: la clave ya no existe. El sitio se recupera solo pidiendo re-registro |
| `rate_limited` | Se superó el límite por IP; esperar una hora |

Si el envío falla, el registro **no queda a medias**: la fila recién creada se borra, así
que la persona puede volver a intentar con el mismo email una vez resuelto el SMTP. Un
registro que ya existía conserva su clave y su cupo intactos.

En desarrollo (`npm start`) los endpoints PHP no existen, así que el gate no se puede
probar completo — igual que el formulario de contacto. Ver
[contact-form.md](contact-form.md#probar-en-desarrollo).
