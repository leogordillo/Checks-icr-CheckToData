<?php
/**
 * Demo-access registration endpoint.
 *
 * Receives {name, company, email} and emails back an access key good for
 * DEMO_DEFAULT_QUOTA runs over DEMO_KEY_DAYS days. The key is NEVER returned in
 * the HTTP response: having it arrive by email is what proves the address is real.
 *
 * Re-registration with a known email does not mint new keys (that would make
 * quota farming a one-liner): an active key is re-sent with its remaining
 * balance, and an expired one starts a fresh cycle under the same key.
 */

declare(strict_types=1);

define('CHECKTODATA_ENDPOINT', true);
require __DIR__ . '/demo-common.php';

require_post();
$data = read_json_body();

$name    = field($data, 'name');
$company = field($data, 'company');
$email   = strtolower(field($data, 'email'));
$honey   = field($data, 'website'); // honeypot: real users never see this field

// Silently accept so the bot has no signal to adapt to, but do nothing.
if ($honey !== '') {
    respond(200, ['ok' => true]);
}

// ── Validation (server-side is authoritative; the client copy is UX only) ───────

$errors = [];
if ($name === '' || mb_strlen($name) > 120) {
    $errors['name'] = $name === '' ? 'required' : 'too_long';
}
if ($company === '' || mb_strlen($company) > 160) {
    $errors['company'] = $company === '' ? 'required' : 'too_long';
}
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 200) {
    $errors['email'] = 'invalid';
}
foreach ([$name, $company, $email] as $headerBound) {
    if (preg_match('/[\r\n]/', $headerBound)) {
        $errors['email'] = 'invalid';
    }
}
if ($errors !== []) {
    respond(422, ['ok' => false, 'error' => 'validation_failed', 'fields' => $errors]);
}

// Configurable so the limit can be raised while setting SMTP up, without a redeploy.
$registerLimit = 5;
foreach (DEMO_CONFIG_CANDIDATES as $candidate) {
    if (is_readable($candidate)) {
        $probe = @require $candidate;
        if (is_array($probe) && isset($probe['rate_limit_register'])) {
            $registerLimit = max(1, (int) $probe['rate_limit_register']);
        }
        break;
    }
}

if (rate_limit_exceeded('register', client_ip(), $registerLimit)) {
    fail(429, 'rate_limited');
}

/**
 * This endpoint mails an address chosen by whoever calls it, so it is the one
 * piece of the site that could be turned into a spam cannon. Three limits, each
 * covering a hole the others leave:
 *
 *  - per IP (above)     — the ordinary abuser
 *  - per RECIPIENT      — stops repeat submissions of a victim's address from
 *                         mail-bombing them, which the per-IP limit allows and
 *                         which re-registration made worse by re-sending the key
 *  - global             — a botnet rotating IPs defeats per-IP limiting entirely;
 *                         this caps the damage to the domain's mail reputation
 */
if (rate_limit_exceeded('register-email', strtolower($email), 2)) {
    fail(429, 'rate_limited');
}
if (rate_limit_exceeded('register-global', 'all', 60)) {
    fail(429, 'rate_limited');
}

// ── Create or refresh the registration ──────────────────────────────────────────

['config' => $config, 'dir' => $configDir] = load_demo_config();
$db = demo_db($configDir);

$now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$nowStr = $now->format('Y-m-d H:i:s');
$expiresStr = $now->modify('+' . DEMO_KEY_DAYS . ' days')->format('Y-m-d H:i:s');

// Tracked so a failed send can undo a brand-new row: otherwise a bad SMTP
// config leaves registrations with a key nobody ever received, and the visitor
// cannot re-register because the email is already taken.
$createdNow = false;

$db->beginTransaction();
try {
    $stmt = $db->prepare('SELECT * FROM users WHERE email = :email');
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch();

    if ($user === false) {
        // New registration. Retry on the (astronomically unlikely) key collision.
        $accessKey = '';
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $candidate = generate_access_key();
            $dupe = $db->prepare('SELECT 1 FROM users WHERE access_key = :k');
            $dupe->execute([':k' => $candidate]);
            if ($dupe->fetch() === false) {
                $accessKey = $candidate;
                break;
            }
        }
        if ($accessKey === '') {
            throw new RuntimeException('could not generate a unique key');
        }

        $insert = $db->prepare(<<<'SQL'
            INSERT INTO users (name, company, email, access_key, quota_total, quota_used,
                               created_at, expires_at, ip)
            VALUES (:name, :company, :email, :key, :quota, 0, :created, :expires, :ip)
            SQL);
        $insert->execute([
            ':name'    => $name,
            ':company' => $company,
            ':email'   => $email,
            ':key'     => $accessKey,
            ':quota'   => DEMO_DEFAULT_QUOTA,
            ':created' => $nowStr,
            ':expires' => $expiresStr,
            ':ip'      => client_ip(),
        ]);
        $createdNow = true;
    } else {
        $accessKey = (string) $user['access_key'];
        $expired = $user['expires_at'] !== null && (string) $user['expires_at'] < $nowStr;

        if ($expired) {
            // Expired cycle: same key, fresh window and balance.
            $reset = $db->prepare(
                'UPDATE users SET quota_used = 0, expires_at = :expires WHERE id = :id'
            );
            $reset->execute([':expires' => $expiresStr, ':id' => $user['id']]);
        }
        // Active (or unlimited) key: nothing to change, just re-send it below.
    }

    $db->commit();
} catch (Throwable $e) {
    $db->rollBack();
    error_log('register.php: ' . $e->getMessage());
    fail(500, 'server_error');
}

// ── Send the key ────────────────────────────────────────────────────────────────

/**
 * send_mail() ends the request itself when delivery fails, so the undo runs from
 * a shutdown hook rather than a catch block. Only rows created by THIS request
 * are removed — an existing registration keeps its key and quota untouched.
 */
$mailSent = false;
if ($createdNow) {
    register_shutdown_function(static function () use (&$mailSent, $db, $email): void {
        if ($mailSent) {
            return;
        }
        try {
            $undo = $db->prepare('DELETE FROM users WHERE email = :email');
            $undo->execute([':email' => $email]);
        } catch (Throwable $e) {
            error_log('register.php: could not undo unsent registration: ' . $e->getMessage());
        }
    });
}

$quota = DEMO_DEFAULT_QUOTA;
$days = DEMO_KEY_DAYS;

$body = <<<TXT
Hola $name:

Tu clave de acceso a la demo de CheckToData es:

    $accessKey

Habilita $quota ejecuciones durante $days días. Ingresala en checktodata.com
cuando proceses tu primer cheque.

Recordá: no almacenamos ninguna imagen ni dato de los cheques que proceses.
Las imágenes viajan cifradas desde tu navegador al motor de inferencia y no
se guardan en ningún punto.

Para ampliar tu límite o cualquier consulta: info@checktodata.com

— El equipo de CheckToData

----------------------------------------------------------------------

Hi $name:

Your access key for the CheckToData demo is:

    $accessKey

It enables $quota runs over $days days. Enter it at checktodata.com when you
process your first check.

Remember: we never store check images or any data extracted from them. Images
travel encrypted from your browser to the inference engine and are not
persisted at any point.

To extend your limit, or for any question: info@checktodata.com

— The CheckToData team
TXT;

send_mail($config, $email, $name, 'Tu clave de acceso — CheckToData', $body);
$mailSent = true;

respond(200, ['ok' => true]);
