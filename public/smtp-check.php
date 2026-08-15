<?php
/**
 * One-shot SMTP connectivity report.
 *
 * Exists to end the upload-test-upload loop: it probes every plausible way of
 * reaching the mailbox in a single request and reports what each one did, so the
 * working combination can be read off the result instead of guessed at.
 *
 * Open it in a browser: https://checktodata.com/smtp-check.php
 *
 * Gated behind 'debug' => true in the credentials file, because it reveals host
 * names, ports and PHP internals. It never prints the password, and it never
 * sends mail — it only opens and closes sockets.
 *
 * DELETE THIS FILE (or set debug => false) once mail is working.
 */

declare(strict_types=1);

define('CHECKTODATA_ENDPOINT', true);
require __DIR__ . '/demo-common.php';

if (!debug_enabled()) {
    http_response_code(404);
    exit;
}

['config' => $config] = load_demo_config();

$host = (string) ($config['host'] ?? '');
$configuredPort = (int) ($config['port'] ?? 465);

/**
 * Attempts one connection and reports the outcome, collecting every warning the
 * attempt raised — the first one carries the real reason, the last is generic.
 *
 * @return array<string,mixed>
 */
function probe(string $label, string $target, bool $verify = true, int $timeout = 6): array
{
    $context = stream_context_create([
        'ssl' => [
            'verify_peer'       => $verify,
            'verify_peer_name'  => $verify,
            'allow_self_signed' => !$verify,
        ],
    ]);

    $warnings = [];
    set_error_handler(static function (int $no, string $message) use (&$warnings): bool {
        $warnings[] = $message;
        return true;
    });

    $started = microtime(true);
    $socket = stream_socket_client($target, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $context);
    $elapsed = round((microtime(true) - $started) * 1000);
    restore_error_handler();

    $greeting = null;
    if ($socket !== false) {
        stream_set_timeout($socket, 5);
        $greeting = fgets($socket, 512);
        $greeting = is_string($greeting) ? trim($greeting) : null;
        @fwrite($socket, "QUIT\r\n");
        @fclose($socket);
    }

    return [
        'test'     => $label,
        'target'   => $target,
        'verify'   => $verify,
        'ok'       => $socket !== false,
        'ms'       => $elapsed,
        'greeting' => $greeting,
        'errno'    => $errno,
        'errstr'   => $errstr,
        'warnings' => $warnings,
    ];
}

$results = [];

// Raw TCP first: separates "the port is unreachable" from "TLS was rejected".
$results[] = probe('TCP a 465', "tcp://$host:465");
$results[] = probe('TCP a 587', "tcp://$host:587");
$results[] = probe('TCP a 25',  "tcp://$host:25");
$results[] = probe('TCP a localhost:25', 'tcp://localhost:25');

// Then TLS, with and without certificate validation.
$results[] = probe('TLS implícito, validando certificado', "ssl://$host:465", true);
$results[] = probe('TLS implícito, SIN validar certificado', "ssl://$host:465", false);

// Read the working combination off this summary.
$verdict = [];
foreach ($results as $r) {
    $verdict[$r['test']] = $r['ok'] ? 'CONECTA (' . $r['ms'] . ' ms)' : 'falla';
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'php_version'      => PHP_VERSION,
    'openssl_loaded'   => extension_loaded('openssl'),
    'transports'       => stream_get_transports(),
    'openssl_cafile'   => ini_get('openssl.cafile') ?: '(sin definir)',
    'openssl_capath'   => ini_get('openssl.capath') ?: '(sin definir)',
    'default_cert_file'=> function_exists('openssl_get_cert_locations')
        ? (openssl_get_cert_locations()['default_cert_file'] ?? null)
        : null,
    'cert_file_exists' => function_exists('openssl_get_cert_locations')
        ? is_readable((string) (openssl_get_cert_locations()['default_cert_file'] ?? ''))
        : null,
    'configured'       => ['host' => $host, 'port' => $configuredPort,
                           'secure' => $config['secure'] ?? 'ssl',
                           'verify_cert' => $config['verify_cert'] ?? true],
    'resumen'          => $verdict,
    'detalle'          => $results,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
