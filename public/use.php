<?php
/**
 * Demo-access usage endpoint. Three actions, all POST JSON {action, key, ...}:
 *
 *  - check:     validates a key without consuming quota (used when the visitor
 *               types the key in). Returns the remaining balance.
 *  - authorize: consumes one run from the quota and green-lights an execution.
 *  - metrics:   records the numeric outcome of a run. When the run failed, the
 *               use consumed by `authorize` is refunded so API cold-start
 *               timeouts do not eat the visitor's trial.
 *
 * PRIVACY INVARIANT: metrics are numbers and booleans about the run (latency,
 * confidence, counts). Never accept, log or store check images, file names or
 * extracted values here — the site publicly promises exactly that.
 */

declare(strict_types=1);

define('CHECKTODATA_ENDPOINT', true);
require __DIR__ . '/demo-common.php';

require_post();

// Generous cap: a full run makes up to 3 calls (check + authorize + metrics).
if (rate_limit_exceeded('use', client_ip(), 120)) {
    fail(429, 'rate_limited');
}

$data = read_json_body();
$action = field($data, 'action');
$key = normalize_access_key(field($data, 'key'));

if (!in_array($action, ['check', 'authorize', 'metrics'], true)) {
    fail(400, 'invalid_action');
}
if ($key === '') {
    fail(403, 'invalid_key');
}

['config' => $config, 'dir' => $configDir] = load_demo_config();
$db = demo_db($configDir);

$nowStr = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s');

/**
 * @param array<string,mixed> $user
 * @return array{remaining: int|null, unlimited: bool}
 */
function balance(array $user): array
{
    if ($user['quota_total'] === null) {
        return ['remaining' => null, 'unlimited' => true];
    }
    $remaining = max(0, (int) $user['quota_total'] - (int) $user['quota_used']);
    return ['remaining' => $remaining, 'unlimited' => false];
}

$stmt = $db->prepare('SELECT * FROM users WHERE access_key = :key');
$stmt->execute([':key' => $key]);
$user = $stmt->fetch();

if ($user === false) {
    fail(403, 'invalid_key');
}

$expired = $user['expires_at'] !== null && (string) $user['expires_at'] < $nowStr;

switch ($action) {
    case 'check':
        if ($expired) {
            fail(403, 'expired');
        }
        $b = balance($user);
        if (!$b['unlimited'] && $b['remaining'] <= 0) {
            fail(403, 'exhausted');
        }
        respond(200, ['ok' => true] + $b);
        break;

    case 'authorize':
        if ($expired) {
            fail(403, 'expired');
        }
        $db->beginTransaction();
        try {
            // Re-read inside the transaction so two parallel runs cannot both
            // take the last remaining use.
            $fresh = $db->prepare('SELECT * FROM users WHERE id = :id');
            $fresh->execute([':id' => $user['id']]);
            $user = $fresh->fetch();

            $b = balance($user);
            if (!$b['unlimited'] && $b['remaining'] <= 0) {
                $db->rollBack();
                fail(403, 'exhausted');
            }

            $upd = $db->prepare(
                'UPDATE users SET quota_used = quota_used + 1, last_used_at = :now WHERE id = :id'
            );
            $upd->execute([':now' => $nowStr, ':id' => $user['id']]);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            error_log('use.php authorize: ' . $e->getMessage());
            fail(500, 'server_error');
        }

        $remaining = $b['unlimited'] ? null : $b['remaining'] - 1;
        respond(200, ['ok' => true, 'remaining' => $remaining, 'unlimited' => $b['unlimited']]);
        break;

    case 'metrics':
        $success = ($data['success'] ?? null) === true;

        // Clamp everything: these values come from the browser and are stored as-is.
        $totalMs = is_numeric($data['total_ms'] ?? null)
            ? max(0, min(600_000, (int) $data['total_ms'])) : null;
        $avgConf = is_numeric($data['avg_conf'] ?? null)
            ? max(0.0, min(1.0, (float) $data['avg_conf'])) : null;
        $fieldCount = is_numeric($data['field_count'] ?? null)
            ? max(0, min(50, (int) $data['field_count'])) : null;
        $withBack = ($data['with_back'] ?? null) === true;
        $coldStart = ($data['cold_start'] ?? null) === true;

        $db->beginTransaction();
        try {
            $ins = $db->prepare(<<<'SQL'
                INSERT INTO runs (user_id, ts, success, total_ms, avg_conf, field_count,
                                  with_back, cold_start)
                VALUES (:uid, :ts, :success, :total_ms, :avg_conf, :field_count, :back, :cold)
                SQL);
            $ins->execute([
                ':uid'         => $user['id'],
                ':ts'          => $nowStr,
                ':success'     => $success ? 1 : 0,
                ':total_ms'    => $totalMs,
                ':avg_conf'    => $avgConf,
                ':field_count' => $fieldCount,
                ':back'        => $withBack ? 1 : 0,
                ':cold'        => $coldStart ? 1 : 0,
            ]);

            // Failed run → give the use back (see file header).
            if (!$success && $user['quota_total'] !== null) {
                $refund = $db->prepare(
                    'UPDATE users SET quota_used = MAX(0, quota_used - 1) WHERE id = :id'
                );
                $refund->execute([':id' => $user['id']]);
            }
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            error_log('use.php metrics: ' . $e->getMessage());
            // Metrics are best-effort: never surface an error that would alarm the
            // visitor after an otherwise fine run.
        }

        respond(200, ['ok' => true]);
        break;
}
