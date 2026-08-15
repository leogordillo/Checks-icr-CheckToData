<?php
/**
 * Contact form endpoint for the CheckToData landing page.
 *
 * Lives in public/ so the Angular build copies it into dist/browser/ automatically,
 * which keeps it from being lost on an FTP redeploy. Same-origin by design: the page
 * and this script are served from the same host, so no CORS handling is needed.
 *
 * Credentials are NOT stored here. They live in a config file outside the web root
 * (see MAIL_CONFIG_CANDIDATES below) so that a PHP misconfiguration serving this file
 * as plain text cannot leak the mailbox password.
 */

declare(strict_types=1);

// ── Configuration ───────────────────────────────────────────────────────────────

/**
 * Where to look for the credentials file, in order. The first readable path wins.
 * Keep every one of these OUTSIDE the public web root.
 */
const MAIL_CONFIG_CANDIDATES = [
    __DIR__ . '/../checktodata-mail-config.php',
    __DIR__ . '/../../checktodata-mail-config.php',
];

/** Max accepted submissions per IP per hour. */
const RATE_LIMIT_PER_HOUR = 5;

/**
 * Status returned when the mail could not be sent. Deliberately a 4xx: Cloudflare
 * sits in front of this site and replaces origin 5xx responses with its own error
 * page, swallowing the JSON body needed to diagnose the failure.
 */
const MAIL_FAILED_STATUS = 424; // Failed Dependency

/** Field length caps, applied after trimming. */
const MAX_LENGTHS = [
    'name'    => 120,
    'email'   => 200,
    'company' => 160,
    'message' => 5000,
];

// ── Response helpers ────────────────────────────────────────────────────────────

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

/**
 * @param array<string,mixed> $payload
 */
function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * @param string|null $detail Technical cause. Only reaches the browser when the
 *                            config sets 'debug' => true; server internals must
 *                            not leak by default.
 */
function fail(int $status, string $code, ?string $detail = null): void
{
    $payload = ['ok' => false, 'error' => $code];
    if ($detail !== null && contact_debug_enabled()) {
        $payload['detail'] = $detail;
    }
    respond($status, $payload);
}

function contact_debug_enabled(): bool
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }
    $cached = false;
    foreach (MAIL_CONFIG_CANDIDATES as $candidate) {
        if (is_readable($candidate)) {
            $config = @require $candidate;
            $cached = is_array($config) && !empty($config['debug']);
            break;
        }
    }
    return $cached;
}

// ── Method guard ────────────────────────────────────────────────────────────────

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    fail(405, 'method_not_allowed');
}

// ── Input parsing ───────────────────────────────────────────────────────────────

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    fail(400, 'empty_body');
}
if (strlen($raw) > 64 * 1024) {
    fail(413, 'payload_too_large');
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    fail(400, 'invalid_json');
}

/** Reads a field as a trimmed string, whatever the JSON type was. */
function field(array $data, string $key): string
{
    $value = $data[$key] ?? '';
    if (!is_scalar($value)) {
        return '';
    }
    return trim((string) $value);
}

$name    = field($data, 'name');
$email   = field($data, 'email');
$company = field($data, 'company');
$message = field($data, 'message');
$honey   = field($data, 'website'); // honeypot: real users never see this field

// ── Bot trap ────────────────────────────────────────────────────────────────────

// Silently accept so the bot has no signal to adapt to, but send nothing.
if ($honey !== '') {
    respond(200, ['ok' => true]);
}

// ── Validation ──────────────────────────────────────────────────────────────────

$errors = [];

if ($name === '') {
    $errors['name'] = 'required';
}
if ($message === '') {
    $errors['message'] = 'required';
}
if ($email === '') {
    $errors['email'] = 'required';
} elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $errors['email'] = 'invalid';
}

$values = ['name' => $name, 'email' => $email, 'company' => $company, 'message' => $message];
foreach (MAX_LENGTHS as $key => $max) {
    if (mb_strlen($values[$key]) > $max) {
        $errors[$key] = 'too_long';
    }
}

// Header injection: any CR/LF in a value that ends up in a header is an attack.
foreach (['name' => $name, 'email' => $email, 'company' => $company] as $key => $value) {
    if (preg_match('/[\r\n]/', $value)) {
        $errors[$key] = 'invalid';
    }
}

if ($errors !== []) {
    respond(422, ['ok' => false, 'error' => 'validation_failed', 'fields' => $errors]);
}

// ── Rate limiting ───────────────────────────────────────────────────────────────

/**
 * File-backed per-IP counter. Good enough for a landing-page contact form; it is not
 * a distributed limiter and does not try to be.
 */
function rate_limit_exceeded(string $ip): bool
{
    $dir = sys_get_temp_dir() . '/checktodata-contact';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        return false; // Cannot track; fail open rather than block real submissions.
    }

    $file = $dir . '/' . hash('sha256', $ip) . '.json';
    $now = time();
    $windowStart = $now - 3600;

    $handle = @fopen($file, 'c+');
    if ($handle === false) {
        return false;
    }

    try {
        if (!flock($handle, LOCK_EX)) {
            return false;
        }

        $contents = stream_get_contents($handle);
        $stamps = is_string($contents) && $contents !== '' ? json_decode($contents, true) : [];
        if (!is_array($stamps)) {
            $stamps = [];
        }

        $stamps = array_values(array_filter(
            $stamps,
            static fn($t): bool => is_int($t) && $t > $windowStart
        ));

        if (count($stamps) >= RATE_LIMIT_PER_HOUR) {
            return true;
        }

        $stamps[] = $now;

        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($stamps));
        fflush($handle);

        return false;
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

$ip = (string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown');
if (rate_limit_exceeded($ip)) {
    fail(429, 'rate_limited');
}

// ── Load credentials ────────────────────────────────────────────────────────────

$config = null;
foreach (MAIL_CONFIG_CANDIDATES as $candidate) {
    if (is_readable($candidate)) {
        /** @var array<string,mixed> $config */
        $config = require $candidate;
        break;
    }
}

if (!is_array($config)) {
    error_log('contact.php: mail config not found in any candidate path');
    fail(500, 'server_misconfigured');
}

foreach (['host', 'port', 'username', 'password', 'from', 'to'] as $key) {
    if (empty($config[$key])) {
        error_log("contact.php: mail config missing key '$key'");
        fail(500, 'server_misconfigured');
    }
}

// ── Compose the message ─────────────────────────────────────────────────────────

/** RFC 2047 encoding, so non-ASCII survives in header values. */
function encode_header(string $value): string
{
    if (preg_match('/^[\x20-\x7E]*$/', $value)) {
        return $value;
    }
    return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

$subject = encode_header(sprintf('[CheckToData] Consulta de %s', $name));

$bodyLines = [
    'Nueva consulta desde el formulario de checktodata.com',
    '',
    'Nombre:  ' . $name,
    'Email:   ' . $email,
    'Empresa: ' . ($company !== '' ? $company : '—'),
    '',
    'Mensaje:',
    $message,
    '',
    '---',
    'IP:      ' . $ip,
    'Fecha:   ' . date('Y-m-d H:i:s T'),
];
$body = implode("\r\n", $bodyLines);

$fromAddress = (string) $config['from'];
$fromName    = isset($config['from_name']) ? (string) $config['from_name'] : 'CheckToData Web';
$toAddress   = (string) $config['to'];

$messageId = sprintf(
    '<%s.%s@%s>',
    date('YmdHis'),
    bin2hex(random_bytes(8)),
    substr((string) strrchr($fromAddress, '@'), 1)
);

// Reply-To carries the visitor's address. From stays on our own domain so the message
// passes SPF/DKIM — sending "as" the visitor is what makes contact forms land in spam.
$headers = [
    'Date: ' . date('r'),
    'Message-ID: ' . $messageId,
    'From: ' . encode_header($fromName) . ' <' . $fromAddress . '>',
    'To: <' . $toAddress . '>',
    'Reply-To: ' . encode_header($name) . ' <' . $email . '>',
    'Subject: ' . $subject,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'X-Mailer: checktodata-contact',
];

$encodedBody = rtrim(chunk_split(base64_encode($body), 76, "\r\n"));
$payload = implode("\r\n", $headers) . "\r\n\r\n" . $encodedBody;

// ── Minimal SMTP client ─────────────────────────────────────────────────────────

final class SmtpException extends RuntimeException {}

final class SmtpClient
{
    /** @var resource */
    private $socket;

    private string $secure;

    /**
     * @param string $secure     'ssl'  → implicit TLS, whole session encrypted (port 465)
     *                           'tls'  → plain connect, upgraded with STARTTLS (port 587)
     *                           'none' → no encryption (only sane for localhost relays)
     * @param bool   $verifyCert Set false when the mail server presents a certificate
     *                           PHP cannot validate — common on shared hosting, where
     *                           the CA bundle is missing or the cert does not match the
     *                           host name. Traffic stays encrypted either way.
     */
    public function __construct(
        string $host,
        int $port,
        string $secure = 'ssl',
        bool $verifyCert = true,
        int $timeout = 20
    ) {
        $this->secure = $secure;

        $context = stream_context_create([
            'ssl' => [
                'verify_peer'       => $verifyCert,
                'verify_peer_name'  => $verifyCert,
                'allow_self_signed' => !$verifyCert,
            ],
        ]);

        $scheme = $secure === 'ssl' ? 'ssl' : 'tcp';

        error_clear_last();
        $socket = @stream_socket_client(
            sprintf('%s://%s:%d', $scheme, $host, $port),
            $errno,
            $errstr,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $context
        );

        if ($socket === false) {
            // An errno of 0 with an empty message means the failure happened above
            // TCP — a missing ssl:// transport or a rejected TLS handshake. The real
            // reason only exists in the warning that @ suppressed, so read it back.
            $last = error_get_last();
            $reason = $errstr !== '' ? $errstr : ($last['message'] ?? 'unknown error');
            throw new SmtpException("connect failed to $scheme://$host:$port — $reason ($errno)");
        }

        $this->socket = $socket;
        stream_set_timeout($this->socket, $timeout);
        $this->expect(220);
    }

    /** Reads one full (possibly multiline) SMTP reply. */
    private function readReply(): array
    {
        $lines = [];
        while (true) {
            $line = fgets($this->socket, 1024);
            if ($line === false) {
                throw new SmtpException('connection closed while reading reply');
            }
            $lines[] = rtrim($line, "\r\n");
            // A hyphen in the 4th column means more lines follow.
            if (strlen($line) < 4 || $line[3] !== '-') {
                break;
            }
        }

        $last = end($lines);
        $code = (int) substr((string) $last, 0, 3);

        return [$code, implode(' | ', $lines)];
    }

    private function expect(int $expected): string
    {
        [$code, $text] = $this->readReply();
        if ($code !== $expected) {
            throw new SmtpException("expected $expected, got $code: $text");
        }
        return $text;
    }

    private function send(string $command, int $expected): string
    {
        if (fwrite($this->socket, $command . "\r\n") === false) {
            throw new SmtpException('write failed');
        }
        return $this->expect($expected);
    }

    public function authenticate(string $username, string $password, string $ehloDomain): void
    {
        $this->send('EHLO ' . $ehloDomain, 250);

        if ($this->secure === 'tls') {
            $this->send('STARTTLS', 220);
            error_clear_last();
            $ok = @stream_socket_enable_crypto($this->socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            if ($ok !== true) {
                $last = error_get_last();
                throw new SmtpException('STARTTLS failed: ' . ($last['message'] ?? 'unknown error'));
            }
            // The server forgets everything announced before the upgrade.
            $this->send('EHLO ' . $ehloDomain, 250);
        }

        $this->send('AUTH LOGIN', 334);
        $this->send(base64_encode($username), 334);
        // A 535 here is almost always a stale password in the config file.
        $this->send(base64_encode($password), 235);
    }

    public function sendMessage(string $from, string $to, string $payload): void
    {
        $this->send('MAIL FROM:<' . $from . '>', 250);
        $this->send('RCPT TO:<' . $to . '>', 250);
        $this->send('DATA', 354);

        // Dot-stuffing: a line consisting of a single dot terminates DATA, so any
        // body line starting with a dot must be escaped with a second one.
        $escaped = preg_replace('/^\./m', '..', $payload);

        if (fwrite($this->socket, $escaped . "\r\n.\r\n") === false) {
            throw new SmtpException('write failed during DATA');
        }
        $this->expect(250);
    }

    public function close(): void
    {
        if (is_resource($this->socket)) {
            @fwrite($this->socket, "QUIT\r\n");
            @fclose($this->socket);
        }
    }
}

// ── Send ────────────────────────────────────────────────────────────────────────

$client = null;
try {
    $client = new SmtpClient(
        (string) $config['host'],
        (int) $config['port'],
        isset($config['secure']) ? (string) $config['secure'] : 'ssl',
        !isset($config['verify_cert']) || (bool) $config['verify_cert']
    );
    $client->authenticate(
        (string) $config['username'],
        (string) $config['password'],
        (string) ($_SERVER['HTTP_HOST'] ?? 'checktodata.com')
    );
    $client->sendMessage($fromAddress, $toAddress, $payload);
} catch (Throwable $e) {
    // The log always gets the detail; the browser only when debug is enabled.
    error_log('contact.php: send failed: ' . $e->getMessage());
    // 4xx and not 5xx: Cloudflare replaces origin 5xx with its own error page,
    // swallowing the JSON body that explains what actually went wrong.
    fail(MAIL_FAILED_STATUS, 'send_failed', $e->getMessage());
} finally {
    if ($client !== null) {
        $client->close();
    }
}

respond(200, ['ok' => true]);
