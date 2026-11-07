<?php
declare(strict_types=1);

// Exercise the real MIME/protocol code without networking or calling mail().
$source = str_replace("\r\n", "\n", file_get_contents(__DIR__ . '/worker.php'));
$end = strpos($source, "\ntry {\n    \$config = loadConfig();");
if ($end === false) {
    throw new RuntimeException('Worker entrypoint not found.');
}
$functions = substr($source, strlen('<?php'), $end - strlen('<?php'));
$functions = str_replace('function apiRequest(', 'function realApiRequest(', $functions);
$functions = str_replace('function sendMessage(', 'function realSendMessage(', $functions);
eval($functions);

function verify(bool $ok, string $message): void
{
    if (!$ok) throw new RuntimeException($message);
}
function apiRequest(array $config, array $payload): array
{
    $GLOBALS['calls'][] = $payload;
    if ($payload['action'] === 'claim') return $GLOBALS['claim'];
    if ($payload['action'] === 'attachment') {
        verify($payload['report_artifact_key'] === 'group:ph', 'wrong artifact key');
        return ['base64' => base64_encode($GLOBALS['corrupt'] ? 'damaged' : '%PDF-test-content')];
    }
    return ['status' => 'completed'];
}
function sendMessage(array $mail): bool
{
    $GLOBALS['sent'][] = $mail;
    return true;
}
$config = ['workspace_url'=>'https://example.test', 'worker_secret'=>'test-only', 'from_email'=>'orders@example.test', 'from_name'=>'Progre'];
$GLOBALS['claim'] = ['status'=>'claimed', 'worker_id'=>'worker', 'email'=>[
    'id'=>'report:00000000-0000-0000-0000-000000000000', 'lock_token'=>'lock',
    'destinatario'=>'manager@example.test', 'oggetto'=>'Report Commerciale mese di ottobre 2026', 'corpo'=>'Report squadra',
], 'attachments'=>[['filename'=>'Report_PH.pdf', 'report_artifact_key'=>'group:ph',
    'sha256'=>hash('sha256','%PDF-test-content'), 'bytes'=>strlen('%PDF-test-content')]]];
$GLOBALS['corrupt'] = false;
$GLOBALS['calls'] = $GLOBALS['sent'] = [];
$result = processOne($config, true);
verify($result['status'] === 'sent', 'report not acknowledged');
verify($GLOBALS['calls'][0]['reports_only'] === true, 'must not claim orders');
verify(count($GLOBALS['sent']) === 1, 'wrong mail count');
verify($GLOBALS['sent'][0]['to'] === 'manager@example.test', 'wrong recipient');
verify(str_contains($GLOBALS['sent'][0]['headers'], '<orders@example.test>'), 'wrong sender');
verify(str_contains($GLOBALS['sent'][0]['body'], 'Report_PH.pdf'), 'PDF missing');
verify(end($GLOBALS['calls'])['action'] === 'complete', 'missing delivery acknowledgement');

$GLOBALS['corrupt'] = true;
$GLOBALS['calls'] = $GLOBALS['sent'] = [];
try {
    processOne($config, true);
    throw new RuntimeException('corrupt file accepted');
} catch (Throwable $error) {
    verify(str_contains($error->getMessage(), 'Integrità'), 'unexpected failure');
}
verify(count($GLOBALS['sent']) === 0, 'corrupt file sent');
verify(end($GLOBALS['calls'])['action'] === 'retry', 'missing uncertain-delivery audit');
echo "PASS: report-only claim, original sender, private PDF integrity, acknowledgement, corrupt-file rejection.\n";
