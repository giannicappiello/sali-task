<?php
declare(strict_types=1);

const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_FLAGS);
    exit;
}

function loadConfig(): array
{
    $path = __DIR__ . '/config.php';
    if (!is_file($path)) {
        throw new RuntimeException('config.php mancante.');
    }
    $config = require $path;
    if (!is_array($config)) {
        throw new RuntimeException('config.php non valido.');
    }
    foreach (['workspace_url', 'worker_secret', 'from_email', 'from_name'] as $key) {
        if (trim((string)($config[$key] ?? '')) === '') {
            throw new RuntimeException("Configurazione mancante: {$key}");
        }
    }
    return $config;
}

function requestHeadersLower(): array
{
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    return array_change_key_case(is_array($headers) ? $headers : [], CASE_LOWER);
}

function requireHttpAuthorization(array $config): void
{
    if (PHP_SAPI === 'cli') {
        return;
    }
    $readCapabilities = $_SERVER['REQUEST_METHOD'] === 'GET'
        && in_array(($_GET['action'] ?? ''), ['report_capabilities', 'activity_email_capabilities', 'anomaly_email_capabilities'], true);
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' && !$readCapabilities) {
        respond(['error' => 'Metodo non consentito.'], 405);
    }
    $headers = requestHeadersLower();
    $supplied = trim((string)($headers['x-progre-worker-secret'] ?? ''));
    if ($supplied === '') {
        $supplied = preg_replace('/^Bearer\s+/i', '', trim((string)($headers['authorization'] ?? '')));
    }
    if ($supplied === '' || !hash_equals((string)$config['worker_secret'], $supplied)) {
        respond(['error' => 'Worker non autorizzato.'], 401);
    }
}

function apiRequest(array $config, array $payload): array
{
    $url = rtrim((string)$config['workspace_url'], '/') . '/api/mexal/orders/email-worker';
    $ch = curl_init($url);
    if ($ch === false) {
        throw new RuntimeException('Impossibile inizializzare la connessione HTTPS.');
    }
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 90,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $config['worker_secret'],
            'Content-Type: application/json',
            'X-Worker-Source: aruba',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_FLAGS),
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    if ($body === false) {
        throw new RuntimeException('Chiamata Workspace non riuscita: ' . $curlError);
    }
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        throw new RuntimeException("Risposta Workspace non valida (HTTP {$status}).");
    }
    if ($status < 200 || $status >= 300) {
        throw new RuntimeException((string)($decoded['error'] ?? "Errore Workspace HTTP {$status}."));
    }
    return $decoded;
}

function safeHeader(string $value): string
{
    return trim(str_replace(["\r", "\n"], '', $value));
}

function encodeHeader(string $value): string
{
    return '=?UTF-8?B?' . base64_encode(safeHeader($value)) . '?=';
}

// Bare mailboxes only. Validate before trimming so CRLF cannot be hidden.
function mailRecipients(string|array $to, array $cc = [], int $maxRecipients = 10): array
{
    $to = is_string($to) ? [$to] : $to;
    if (!array_is_list($to) || !array_is_list($cc) || count($to) === 0 || count($to) + count($cc) > $maxRecipients) {
        throw new RuntimeException('Invalid email recipients.');
    }
    $seen = [];
    $normalize = static function (array $addresses) use (&$seen): array {
        $result = [];
        foreach ($addresses as $address) {
            if (!is_string($address) || preg_match('/[\x00-\x1f\x7f]/', $address)) {
                throw new RuntimeException('Invalid email recipients.');
            }
            $address = trim($address);
            $key = strtolower($address);
            if (strlen($address) > 254 || !filter_var($address, FILTER_VALIDATE_EMAIL)
                || preg_match('/[<>;,\s"]/', $address) || isset($seen[$key])) {
                throw new RuntimeException('Invalid or duplicate email recipients.');
            }
            $seen[$key] = true;
            $result[] = $address;
        }
        return $result;
    };
    return ['to' => $normalize($to), 'cc' => $normalize($cc)];
}

function buildMail(array $config, string|array $to, string $subject, string $body, array $attachments, array $cc = [], int $maxRecipients = 10): array
{
    $recipients = mailRecipients($to, $cc, $maxRecipients);
    $boundary = '=_Progre_' . bin2hex(random_bytes(18));
    $messageId = sprintf('<%s@%s>', bin2hex(random_bytes(16)), substr(strrchr($config['from_email'], '@') ?: '@localhost', 1));
    $headers = [
        'MIME-Version: 1.0',
        'From: ' . encodeHeader((string)$config['from_name']) . ' <' . safeHeader((string)$config['from_email']) . '>',
        'Reply-To: ' . safeHeader((string)$config['from_email']),
        'Message-ID: ' . $messageId,
        'Content-Type: multipart/mixed; boundary="' . $boundary . '"',
        'X-Mailer: Progre Workspace Aruba Worker',
    ];
    if (count($recipients['cc']) > 0) {
        // PHP mail() derives envelope recipients from its To argument and Cc
        // header. Never put Cc addresses into To or add a Bcc header.
        $headers[] = 'Cc: ' . implode(', ', $recipients['cc']);
    }
    $parts = [
        '--' . $boundary,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        chunk_split(base64_encode($body)),
    ];
    foreach ($attachments as $attachment) {
        $filename = safeHeader((string)($attachment['filename'] ?? 'allegato.pdf'));
        $content = (string)($attachment['base64'] ?? '');
        if ($content === '') {
            continue;
        }
        array_push(
            $parts,
            '--' . $boundary,
            'Content-Type: ' . safeHeader((string)($attachment['content_type'] ?? 'application/octet-stream')) . '; name="' . $filename . '"',
            'Content-Disposition: attachment; filename="' . $filename . '"',
            'Content-Transfer-Encoding: base64',
            '',
            chunk_split($content)
        );
    }
    $parts[] = '--' . $boundary . '--';
    return [
        'to' => implode(', ', $recipients['to']),
        'subject' => encodeHeader($subject),
        'body' => implode("\r\n", $parts),
        'headers' => implode("\r\n", $headers),
        'message_id' => trim($messageId, '<>'),
    ];
}

function sendMessage(array $mail): bool
{
    return mail($mail['to'], $mail['subject'], $mail['body'], $mail['headers']);
}

function runTest(array $config): array
{
    if (($config['test_enabled'] ?? false) !== true) {
        throw new RuntimeException('Modalità test disabilitata.');
    }
    $recipient = trim((string)($config['test_recipient'] ?? ''));
    if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('test_recipient mancante o non valido.');
    }
    $mail = buildMail(
        $config,
        $recipient,
        'Test invio ordini Progre Workspace',
        "Il worker email Aruba è configurato correttamente.\n\nQuesta email non proviene dalla coda ordini.",
        []
    );
    if (!sendMessage($mail)) {
        throw new RuntimeException('La funzione mail() ha rifiutato il messaggio di test.');
    }
    return ['status' => 'test_sent', 'message_id' => $mail['message_id']];
}

function processActivityClaim(array $config, array $claimed): array
{
    $email = $claimed['email'];
    $attempted = false;
    $accepted = false;
    $definitive = false;
    $protocol = $claimed['activity_email_protocol'] ?? null;
    $identity = ['activity_email_protocol' => $protocol, 'email_id' => $email['id'],
        'worker_id' => $claimed['worker_id'], 'lock_token' => $email['lock_token']];
    try {
        if (!in_array($protocol, [1, 2, 3], true) || !empty($claimed['attachments'])
            || array_key_exists('bcc', $email) || array_key_exists('bcc_recipients', $email)) {
            throw new RuntimeException('Invalid activity payload.');
        }
        if ($protocol >= 2) {
            if (!is_array($email['to_recipients'] ?? null) || !is_array($email['cc_recipients'] ?? null)) {
                throw new RuntimeException('Invalid activity recipients.');
            }
            $to = $email['to_recipients'];
            $cc = $email['cc_recipients'];
        } else {
            if (isset($email['to_recipients']) || isset($email['cc_recipients'])) {
                throw new RuntimeException('Invalid legacy activity recipients.');
            }
            $to = (string)($email['destinatario'] ?? '');
            $cc = [];
        }
        $mail = buildMail($config, $to, (string)$email['oggetto'], (string)$email['corpo'], [], $cc, $protocol === 3 ? 30 : 10);
        $attempted = true;
        if (!sendMessage($mail)) {
            $definitive = true;
            throw new RuntimeException('Provider rejected message.');
        }
        $accepted = true;
        apiRequest($config, array_merge($identity, ['action' => 'accepted', 'message_id' => $mail['message_id']]));
        return ['status' => 'accepted', 'email_id' => $email['id'], 'attachments' => 0];
    } catch (Throwable $error) {
        $status = (!$attempted || ($definitive && !$accepted)) ? 'failed' : 'uncertain';
        try {
            apiRequest($config, array_merge($identity, ['action' => $status]));
        } catch (Throwable $ignored) {
            // Sending expires to uncertain. Never retry the provider handoff.
        }
        return ['status' => $status, 'email_id' => $email['id']];
    }
}

function processAnomalyClaim(array $config, array $claimed): array
{
    $email = $claimed['email'] ?? [];
    $identity = ['email_id' => $email['id'] ?? '', 'worker_id' => $claimed['worker_id'] ?? '',
        'lock_token' => $email['lock_token'] ?? ''];
    $attempted = false;
    $definitive = false;
    try {
        if (!str_starts_with((string)$identity['email_id'], 'anomaly:')
            || trim((string)$identity['worker_id']) === '' || trim((string)$identity['lock_token']) === ''
            || !empty($claimed['attachments']) || array_key_exists('bcc', $email)
            || array_key_exists('bcc_recipients', $email)
            || !is_string($email['destinatario'] ?? null)
            || !is_string($email['oggetto'] ?? null) || !is_string($email['corpo'] ?? null)
            || strlen($email['corpo']) > 20000) {
            throw new RuntimeException('Invalid anomaly email payload.');
        }
        $mail = buildMail($config, $email['destinatario'], $email['oggetto'], $email['corpo'], []);
        $attempted = true;
        if (!sendMessage($mail)) {
            $definitive = true;
            throw new RuntimeException('The email provider rejected the anomaly message.');
        }
        apiRequest($config, array_merge($identity, ['action' => 'complete', 'message_id' => $mail['message_id']]));
        return ['status' => 'sent', 'email_id' => $email['id'], 'attachments' => 0];
    } catch (Throwable $error) {
        $status = !$attempted || $definitive ? 'failed' : 'uncertain';
        try {
            apiRequest($config, array_merge($identity, ['action' => 'retry',
                'error' => $error->getMessage(), 'definitive' => $status === 'failed']));
        } catch (Throwable $ignored) {
            // An unacknowledged provider handoff remains uncertain and is never replayed.
        }
        return ['status' => $status, 'email_id' => $identity['email_id']];
    }
}

function processOne(array $config, bool $reportsOnly = false, bool $activityOnly = false, bool $anomalyOnly = false): array
{
    if (($reportsOnly ? 1 : 0) + ($activityOnly ? 1 : 0) + ($anomalyOnly ? 1 : 0) > 1) {
        throw new RuntimeException('Email worker modes are mutually exclusive.');
    }
    $claimed = apiRequest($config, ['action' => 'claim', 'shipment_protocol' => 1, 'report_protocol' => 1, 'reports_only' => $reportsOnly, 'activity_email_protocol' => 1, 'activity_email_protocols' => [1, 2, 3], 'activity_only' => $activityOnly, 'anomaly_only' => $anomalyOnly]);
    if (($claimed['status'] ?? '') === 'idle') {
        return ['status' => 'idle'];
    }
    if (($claimed['status'] ?? '') !== 'claimed' || !is_array($claimed['email'] ?? null)) {
        throw new RuntimeException('Risposta claim non valida.');
    }
    $email = $claimed['email'];
    if ($anomalyOnly) {
        if (!str_starts_with((string)($email['id'] ?? ''), 'anomaly:')) {
            throw new RuntimeException('Anomaly-only worker protocol mismatch.');
        }
        return processAnomalyClaim($config, $claimed);
    }
    if (str_starts_with((string)($email['id'] ?? ''), 'anomaly:')) {
        throw new RuntimeException('Anomaly job rejected by a non-anomaly worker.');
    }
    if ($activityOnly && !str_starts_with((string)$email['id'], 'activity:')) {
        throw new RuntimeException('Worker activity protocol mismatch.');
    }
    if (str_starts_with((string)$email['id'], 'activity:')) {
        return processActivityClaim($config, $claimed);
    }
    $shipment = str_starts_with((string)$email['id'], 'ddt:');
    $report = str_starts_with((string)$email['id'], 'report:');
    $definitive = false;
    try {
        if ($report) {
            // Fetch each private PDF independently. The aggregate may exceed the
            // Vercel response limit; never turn it into a public download link.
            $totalBytes = 0;
            foreach ($claimed['attachments'] as &$attachment) {
                $file = apiRequest($config, ['action' => 'attachment',
                    'email_id' => $email['id'], 'worker_id' => $claimed['worker_id'],
                    'lock_token' => $email['lock_token'],
                    'report_artifact_key' => $attachment['report_artifact_key']]);
                $bytes = base64_decode((string)($file['base64'] ?? ''), true);
                if ($bytes === false || strlen($bytes) !== (int)$attachment['bytes']
                    || !hash_equals((string)$attachment['sha256'], hash('sha256', $bytes))) {
                    throw new RuntimeException('Integrità PDF report non verificata.');
                }
                $totalBytes += strlen($bytes);
                if ($totalBytes > 18000000) {
                    throw new RuntimeException('Allegati report oltre il limite email.');
                }
                $attachment['base64'] = $file['base64'];
            }
            unset($attachment);
        }
        $mail = buildMail(
            $config,
            (string)$email['destinatario'],
            (string)$email['oggetto'],
            (string)$email['corpo'],
            is_array($claimed['attachments'] ?? null) ? $claimed['attachments'] : []
        );
        if ($shipment) {
            apiRequest($config, ['action' => 'sending', 'email_id' => $email['id'],
                'worker_id' => $claimed['worker_id'], 'lock_token' => $email['lock_token']]);
        }
        if (!sendMessage($mail)) {
            $definitive = true;
            throw new RuntimeException('La funzione mail() ha rifiutato il messaggio.');
        }
        apiRequest($config, [
            'action' => 'complete',
            'email_id' => $email['id'],
            'worker_id' => $claimed['worker_id'],
            'lock_token' => $email['lock_token'],
            'message_id' => $mail['message_id'],
        ]);
        return ['status' => 'sent', 'email_id' => $email['id'], 'attachments' => count($claimed['attachments'] ?? [])];
    } catch (Throwable $error) {
        apiRequest($config, [
            'action' => 'retry',
            'email_id' => $email['id'],
            'worker_id' => $claimed['worker_id'],
            'lock_token' => $email['lock_token'],
            'error' => $error->getMessage(),
            'permanent' => false,
            'definitive' => $definitive,
        ]);
        throw $error;
    }
}

try {
    $config = loadConfig();
    requireHttpAuthorization($config);
    $input = json_decode((string)file_get_contents('php://input'), true);
    $action = PHP_SAPI === 'cli'
        ? (($argv[1] ?? '') === '--test' ? 'test' : 'run')
        : strtolower(trim((string)($_GET['action'] ?? $input['action'] ?? 'run')));

    if ($action === 'activity_email_capabilities') {
        // Keep the v1 flag so the worker can be upgraded before the backend.
        respond(['activity_email_protocol' => 1, 'activity_email_protocols' => [1, 2, 3],
            'queue_enabled' => ($config['queue_enabled'] ?? false) === true]);
    }

    if ($action === 'report_capabilities') {
        respond(['report_protocol' => 1,
            'queue_enabled' => ($config['queue_enabled'] ?? false) === true,
            'from_email' => safeHeader((string)$config['from_email'])]);
    }

    if ($action === 'anomaly_email_capabilities') {
        respond(['anomaly_email_protocol' => 1, 'queue_enabled' => ($config['queue_enabled'] ?? false) === true,
            'from_email' => safeHeader((string)$config['from_email']), 'attachments_enabled' => false,
            'text_only' => true]);
    }

    if ($action === 'test') {
        respond(runTest($config));
    }
    if (($config['queue_enabled'] ?? false) !== true) {
        respond(['status' => 'paused', 'message' => 'Coda reale disabilitata in config.php.']);
    }

    $reportsOnly = $action === 'run_reports';
    $anomalyOnly = $action === 'run_anomalies';
    if ($reportsOnly || $anomalyOnly) {
        set_time_limit(600);
    }
    $limit = ($reportsOnly || $anomalyOnly) ? 40 : max(1, min(25, (int)($config['max_jobs_per_run'] ?? 10)));
    $results = [];
    for ($index = 0; $index < $limit; $index++) {
        $result = processOne($config, $reportsOnly, $action === 'run_activity', $anomalyOnly);
        $results[] = $result;
        if ($result['status'] === 'idle') {
            break;
        }
    }
    respond(['status' => 'ok', 'results' => $results]);
} catch (Throwable $error) {
    error_log('[progre-order-email] ' . $error->getMessage());
    respond(['status' => 'error', 'error' => $error->getMessage()], 500);
}
