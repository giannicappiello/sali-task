<?php
declare(strict_types=1);

const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;

function respond(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_FLAGS);
    exit;
}

function config(): array {
    $path = __DIR__ . '/config.php';
    if (!is_file($path)) throw new RuntimeException('config.php mancante.');
    $value = require $path;
    if (!is_array($value)) throw new RuntimeException('config.php non valido.');
    foreach (['workspace_url', 'worker_secret'] as $key) {
        if (trim((string)($value[$key] ?? '')) === '') throw new RuntimeException("Configurazione mancante: {$key}");
    }
    return $value;
}

function callWorker(array $config): array {
    $url = rtrim((string)$config['workspace_url'], '/') . '/api/mexal/queue-worker';
    $ch = curl_init($url);
    if ($ch === false) throw new RuntimeException('Impossibile inizializzare HTTPS.');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 280,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $config['worker_secret'],
            'Content-Type: application/json',
            'X-Worker-Source: aruba',
        ],
        CURLOPT_POSTFIELDS => '{}',
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    if ($body === false) throw new RuntimeException('Chiamata Workspace non riuscita: ' . $curlError);
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) throw new RuntimeException("Risposta Workspace non valida (HTTP {$status}).");
    if ($status < 200 || $status >= 300) throw new RuntimeException((string)($decoded['error'] ?? "Errore HTTP {$status}."));
    return $decoded;
}

try {
    $config = config();
    $result = callWorker($config);
    respond(['status' => 'ok', 'worker' => $result]);
} catch (Throwable $error) {
    error_log('[progre-mexal-sync] ' . $error->getMessage());
    respond(['status' => 'error', 'error' => $error->getMessage()], 500);
}
