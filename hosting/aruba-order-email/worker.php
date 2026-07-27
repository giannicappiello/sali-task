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
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
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

function buildMail(array $config, string $to, string $subject, string $body, array $attachments): array
{
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
        'to' => safeHeader($to),
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

function processOne(array $config): array
{
    $claimed = apiRequest($config, ['action' => 'claim']);
    if (($claimed['status'] ?? '') === 'idle') {
        return ['status' => 'idle'];
    }
    if (($claimed['status'] ?? '') !== 'claimed' || !is_array($claimed['email'] ?? null)) {
        throw new RuntimeException('Risposta claim non valida.');
    }
    $email = $claimed['email'];
    try {
        $mail = buildMail(
            $config,
            (string)$email['destinatario'],
            (string)$email['oggetto'],
            (string)$email['corpo'],
            is_array($claimed['attachments'] ?? null) ? $claimed['attachments'] : []
        );
        if (!sendMessage($mail)) {
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
        : strtolower(trim((string)($input['action'] ?? 'run')));

    if ($action === 'test') {
        respond(runTest($config));
    }
    if (($config['queue_enabled'] ?? false) !== true) {
        respond(['status' => 'paused', 'message' => 'Coda reale disabilitata in config.php.']);
    }

    $limit = max(1, min(25, (int)($config['max_jobs_per_run'] ?? 10)));
    $results = [];
    for ($index = 0; $index < $limit; $index++) {
        $result = processOne($config);
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
