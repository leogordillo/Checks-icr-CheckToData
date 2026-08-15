<?php
/**
 * Shared plumbing for the demo-access endpoints (register.php / use.php).
 *
 * Lives in public/ so the Angular build ships it next to the endpoints, but it is
 * NOT a page: requesting it directly returns 404 thanks to the guard below. Each
 * endpoint defines CHECKTODATA_ENDPOINT before requiring this file.
 *
 * The SMTP client here intentionally duplicates the one in contact.php: that file
 * is deployed, tested end-to-end and self-contained, and PHP cannot be executed in
 * the local dev environment, so refactoring it into a shared include cannot be
 * verified. If both ever need a change, contact.php is the reference copy.
 *
 * PRIVACY INVARIANT: nothing in this file or its callers may ever receive, log or
 * store check images or values extracted from checks. The database records people
 * and numeric run metrics only.
 */

declare(strict_types=1);

if (!defined('CHECKTODATA_ENDPOINT')) {
    http_response_code(404);
    exit;
}

// ── Locations ───────────────────────────────────────────────────────────────────

/**
 * Candidate paths for the credentials file, in order; first readable wins.
 * Same file the contact form uses — one secrets file for the whole site.
 * The SQLite database is created NEXT TO the config file, i.e. equally
 * outside the web root, so it is never downloadable over HTTP.
 */
const DEMO_CONFIG_CANDIDATES = [
    __DIR__ . '/../checktodata-mail-config.php',
    __DIR__ . '/../../checktodata-mail-config.php',
];

const DEMO_DB_FILENAME = 'checktodata-demo.sqlite';

/** Trial defaults: quota per key and validity window. */
const DEMO_DEFAULT_QUOTA = 20;
const DEMO_KEY_DAYS = 30;

/**
 * Status returned when the mail could not be sent.
 *
 * Deliberately a 4xx and not a 5xx: Cloudflare sits in front of this site and
 * replaces origin 5xx responses with its own branded error page, swallowing the
 * JSON body — which is exactly the information needed to diagnose a failure.
 * 4xx responses pass through untouched.
 */
const MAIL_FAILED_STATUS = 424; // Failed Dependency

// ── JSON helpers ────────────────────────────────────────────────────────────────

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/** @param array<string,mixed> $payload */
function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * @param string|null $detail Technical cause. Only reaches the browser when the
 *                            config sets 'debug' => true; otherwise it is dropped,
 *                            since server internals must not leak by default.
 */
function fail(int $status, string $code, ?string $detail = null): void
{
    $payload = ['ok' => false, 'error' => $code];
    if ($detail !== null && debug_enabled()) {
        $payload['detail'] = $detail;
    }
    respond($status, $payload);
}

/**
 * Reads the optional 'debug' flag from the credentials file. Cached because
 * fail() may run before or after the config has been loaded, and a missing or
 * unreadable config must never itself raise an error here.
 */
function debug_enabled(): bool
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }
    $cached = false;
    foreach (DEMO_CONFIG_CANDIDATES as $candidate) {
        if (is_readable($candidate)) {
            $config = @require $candidate;
            $cached = is_array($config) && !empty($config['debug']);
            break;
        }
    }
    return $cached;
}

function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        fail(405, 'method_not_allowed');
    }
}

/** @return array<string,mixed> */
function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        fail(400, 'empty_body');
    }
    if (strlen($raw) > 32 * 1024) {
        fail(413, 'payload_too_large');
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fail(400, 'invalid_json');
    }
    return $data;
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

function client_ip(): string
{
    return (string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

// ── Config ──────────────────────────────────────────────────────────────────────

/** @return array{config: array<string,mixed>, dir: string} */
function load_demo_config(): array
{
    foreach (DEMO_CONFIG_CANDIDATES as $candidate) {
        if (is_readable($candidate)) {
            $config = require $candidate;
            if (is_array($config)) {
                return ['config' => $config, 'dir' => dirname($candidate)];
            }
        }
    }
    error_log('demo-common: mail config not found in any candidate path');
    fail(500, 'server_misconfigured');
    exit; // unreachable; keeps static analysers happy
}

// ── Database ────────────────────────────────────────────────────────────────────

/**
 * Opens (and on first use creates) the SQLite database that sits next to the
 * credentials file, outside the web root. Editable over SFTP with any SQLite
 * browser — there is deliberately no admin endpoint.
 */
function demo_db(string $configDir): PDO
{
    $path = $configDir . '/' . DEMO_DB_FILENAME;
    try {
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (PDOException $e) {
        error_log('demo-common: cannot open sqlite at ' . $path . ': ' . $e->getMessage());
        fail(500, 'server_misconfigured');
        exit;
    }

    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA journal_mode = WAL');

    // quota_total NULL = unlimited; expires_at NULL = never expires (test users).
    // Both are meant to be set over SFTP for internal testers.
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS users (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            company      TEXT NOT NULL,
            email        TEXT NOT NULL UNIQUE,
            access_key   TEXT NOT NULL UNIQUE,
            quota_total  INTEGER,
            quota_used   INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL,
            expires_at   TEXT,
            last_used_at TEXT,
            ip           TEXT
        )
        SQL);

    // Numeric run metrics only — never check contents. Adding a column that holds
    // extracted values or file names would break the site's public privacy promise.
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            ts          TEXT NOT NULL,
            success     INTEGER NOT NULL,
            total_ms    INTEGER,
            avg_conf    REAL,
            field_count INTEGER,
            with_back   INTEGER NOT NULL DEFAULT 0,
            cold_start  INTEGER NOT NULL DEFAULT 0
        )
        SQL);

    return $pdo;
}

// ── Rate limiting (same file-backed pattern as contact.php) ─────────────────────

function rate_limit_exceeded(string $bucket, string $ip, int $maxPerHour): bool
{
    $dir = sys_get_temp_dir() . '/checktodata-' . $bucket;
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        return false; // cannot track; fail open rather than block real users
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
        if (count($stamps) >= $maxPerHour) {
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

// ── Access keys ─────────────────────────────────────────────────────────────────

/**
 * Canonical key form: XXXX-XXXX over an alphabet without lookalikes (no 0/O/1/I/L),
 * since the key travels by email and gets retyped by hand.
 */
function generate_access_key(): string
{
    $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $pick = static function (int $n) use ($alphabet): string {
        $out = '';
        for ($i = 0; $i < $n; $i++) {
            $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return $out;
    };
    return $pick(4) . '-' . $pick(4);
}

/** Normalizes user input ("abcd efgh", "ABCD-EFGH") to the canonical form, or ''. */
function normalize_access_key(string $input): string
{
    $clean = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $input) ?? '');
    if (strlen($clean) !== 8) {
        return '';
    }
    return substr($clean, 0, 4) . '-' . substr($clean, 4);
}

// ── Minimal SMTP client (see header note about the deliberate duplication) ──────

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

        // A rejected TLS handshake raises several warnings in cascade, and only the
        // FIRST carries the OpenSSL reason — the last one is a generic "Unknown
        // error". error_get_last() would return exactly the useless one, so collect
        // them all instead of suppressing with @.
        $warnings = [];
        set_error_handler(static function (int $no, string $message) use (&$warnings): bool {
            $warnings[] = $message;
            return true; // handled: keep it out of the output
        });
        $socket = stream_socket_client(
            sprintf('%s://%s:%d', $scheme, $host, $port),
            $errno,
            $errstr,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $context
        );
        restore_error_handler();

        if ($socket === false) {
            $reason = $warnings !== [] ? implode(' | ', $warnings) : ($errstr ?: 'unknown error');
            $hint = ($errno === 0 && $verifyCert)
                ? " [errno 0 means the failure was above TCP; if it mentions the certificate, try 'verify_cert' => false]"
                : '';
            throw new SmtpException("connect failed to $scheme://$host:$port — $reason ($errno)$hint");
        }

        $this->socket = $socket;
        stream_set_timeout($this->socket, $timeout);
        $this->expect(220);
    }

    /** @return array{0:int,1:string} one full (possibly multiline) SMTP reply */
    private function readReply(): array
    {
        $lines = [];
        while (true) {
            $line = fgets($this->socket, 1024);
            if ($line === false) {
                throw new SmtpException('connection closed while reading reply');
            }
            $lines[] = rtrim($line, "\r\n");
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

    /** Greets the server and upgrades the channel when STARTTLS is configured. */
    public function handshake(string $ehloDomain): void
    {
        $this->send('EHLO ' . $ehloDomain, 250);

        if ($this->secure === 'tls') {
            $this->send('STARTTLS', 220);
            $warnings = [];
            set_error_handler(static function (int $no, string $message) use (&$warnings): bool {
                $warnings[] = $message;
                return true;
            });
            $ok = stream_socket_enable_crypto(
                $this->socket,
                true,
                STREAM_CRYPTO_METHOD_TLS_CLIENT
            );
            restore_error_handler();
            if ($ok !== true) {
                throw new SmtpException(
                    'STARTTLS failed: ' . ($warnings !== [] ? implode(' | ', $warnings) : 'unknown error')
                );
            }
            // The server forgets everything announced before the upgrade.
            $this->send('EHLO ' . $ehloDomain, 250);
        }
    }

    /**
     * Only for relays that require credentials. A local relay usually accepts mail
     * from its own machine unauthenticated, and answering AUTH with a 502 there
     * would abort a session that was otherwise fine.
     */
    public function authenticate(string $username, string $password): void
    {
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

        // Dot-stuffing: a lone dot terminates DATA, so body dots get escaped.
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

/** RFC 2047 encoding so non-ASCII survives in header values. */
function encode_header(string $value): string
{
    if (preg_match('/^[\x20-\x7E]*$/', $value)) {
        return $value;
    }
    return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

/**
 * Sends a plain-text mail through the configured mailbox. $toName/$subject/$body
 * must already be validated: no CR/LF in header values.
 *
 * @param array<string,mixed> $config
 */
function send_mail(array $config, string $toAddress, string $toName, string $subject, string $body): void
{
    // Credentials are only required when the relay actually asks for them.
    $useAuth = !isset($config['auth']) || (bool) $config['auth'];
    $required = $useAuth
        ? ['host', 'port', 'username', 'password', 'from']
        : ['host', 'port', 'from'];

    foreach ($required as $key) {
        if (empty($config[$key])) {
            error_log("demo-common: mail config missing key '$key'");
            fail(500, 'server_misconfigured');
        }
    }

    $fromAddress = (string) $config['from'];
    $fromName    = isset($config['from_name']) ? (string) $config['from_name'] : 'CheckToData';

    $messageId = sprintf(
        '<%s.%s@%s>',
        date('YmdHis'),
        bin2hex(random_bytes(8)),
        substr((string) strrchr($fromAddress, '@'), 1)
    );

    $headers = [
        'Date: ' . date('r'),
        'Message-ID: ' . $messageId,
        'From: ' . encode_header($fromName) . ' <' . $fromAddress . '>',
        'To: ' . encode_header($toName) . ' <' . $toAddress . '>',
        'Subject: ' . encode_header($subject),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        'X-Mailer: checktodata-demo',
    ];

    $encodedBody = rtrim(chunk_split(base64_encode($body), 76, "\r\n"));
    $payload = implode("\r\n", $headers) . "\r\n\r\n" . $encodedBody;

    // 'secure' lets the mailbox be reached over implicit TLS (465), STARTTLS (587)
    // or plain (a localhost relay) without touching code — useful when a host
    // blocks outbound SMTP to the outside world but allows its own relay.
    $secure = isset($config['secure']) ? (string) $config['secure'] : 'ssl';

    $client = null;
    try {
        $client = new SmtpClient(
            (string) $config['host'],
            (int) $config['port'],
            $secure,
            !isset($config['verify_cert']) || (bool) $config['verify_cert']
        );
        $client->handshake((string) ($_SERVER['HTTP_HOST'] ?? 'checktodata.com'));
        if ($useAuth) {
            $client->authenticate((string) $config['username'], (string) $config['password']);
        }
        $client->sendMessage($fromAddress, $toAddress, $payload);
    } catch (Throwable $e) {
        error_log('demo-common: send failed: ' . $e->getMessage());
        fail(MAIL_FAILED_STATUS, 'send_failed', $e->getMessage());
    } finally {
        if ($client !== null) {
            $client->close();
        }
    }
}
