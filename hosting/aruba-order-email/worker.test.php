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
    if (($GLOBALS['fail_ack'] ?? false) && $payload['action'] === 'accepted') throw new RuntimeException('private body');
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
    if ($GLOBALS['send_throw'] ?? false) throw new RuntimeException('private body');
    return !($GLOBALS['send_reject'] ?? false);
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


$GLOBALS['claim'] = ['status'=>'claimed', 'activity_email_protocol'=>1, 'worker_id'=>'worker', 'email'=>[
    'id'=>'activity:11111111-1111-4111-8111-111111111111', 'lock_token'=>'22222222-2222-4222-8222-222222222222',
    'destinatario'=>'private@example.test', 'oggetto'=>'Private', 'corpo'=>'Private body',
], 'attachments'=>[]];
foreach (['success', 'rejected', 'ambiguous', 'lost_ack'] as $scenario) {
    $GLOBALS['send_reject'] = $scenario === 'rejected';
    $GLOBALS['send_throw'] = $scenario === 'ambiguous';
    $GLOBALS['fail_ack'] = $scenario === 'lost_ack';
    $GLOBALS['calls'] = $GLOBALS['sent'] = [];
    $result = processOne($config, false, true);
    $expected = $scenario === 'success' ? 'accepted' : ($scenario === 'rejected' ? 'failed' : 'uncertain');
    verify($result['status'] === $expected, 'wrong activity outcome: ' . $scenario);
    verify(count($GLOBALS['sent']) === 1, 'activity sent repeatedly');
    verify($GLOBALS['calls'][0]['activity_only'] === true, 'activity-only missing');
    verify($GLOBALS['calls'][0]['activity_email_protocol'] === 1, 'legacy-compatible protocol missing');
    verify($GLOBALS['calls'][0]['activity_email_protocols'] === [1, 2], 'v2 support missing');
    verify(end($GLOBALS['calls'])['action'] === $expected, 'wrong acknowledgement');
    verify(!str_contains($GLOBALS['sent'][0]['body'], 'Content-Disposition: attachment'), 'unexpected attachment');
    verify(!str_contains(json_encode($GLOBALS['calls']), 'Private body'), 'body leaked to diagnostics');
}
echo "PASS: activity-only protocol, acceptance, rejection, ambiguous send, lost acknowledgement, no retries or attachments.\n";

// A stale backend must never cause run_activity to send a legacy job.
$GLOBALS['claim']['email']['id'] = 'report:11111111-1111-4111-8111-111111111111';
$GLOBALS['sent'] = [];
try {
    processOne($config, false, true);
    throw new RuntimeException('legacy activity-only payload accepted');
} catch (Throwable $error) {
    verify($error->getMessage() === 'Worker activity protocol mismatch.', 'wrong mismatch error');
}
verify(count($GLOBALS['sent']) === 0, 'activity-only sent a legacy job');


// New workers must send all recipients once, including Cc, while keeping
// acknowledgements terminal after provider errors or lost backend responses.
$multiClaim = ['status'=>'claimed', 'activity_email_protocol'=>2, 'worker_id'=>'worker', 'email'=>[
    'id'=>'activity:11111111-1111-4111-8111-111111111111', 'lock_token'=>'22222222-2222-4222-8222-222222222222',
    'destinatario'=>'first@example.test', 'to_recipients'=>['first@example.test','second@example.test'],
    'cc_recipients'=>['copy@example.test'], 'oggetto'=>'Private', 'corpo'=>'Private body',
], 'attachments'=>[]];
foreach (['success', 'rejected', 'ambiguous', 'lost_ack'] as $scenario) {
    $GLOBALS['claim'] = $multiClaim;
    $GLOBALS['send_reject'] = $scenario === 'rejected';
    $GLOBALS['send_throw'] = $scenario === 'ambiguous';
    $GLOBALS['fail_ack'] = $scenario === 'lost_ack';
    $GLOBALS['calls'] = $GLOBALS['sent'] = [];
    $result = processOne($config, false, true);
    $expected = $scenario === 'success' ? 'accepted' : ($scenario === 'rejected' ? 'failed' : 'uncertain');
    verify($result['status'] === $expected, 'wrong v2 outcome: ' . $scenario);
    verify(count($GLOBALS['sent']) === 1, 'v2 sent repeatedly');
    verify($GLOBALS['sent'][0]['to'] === 'first@example.test, second@example.test', 'To recipients missing');
    verify(str_contains($GLOBALS['sent'][0]['headers'], "Cc: copy@example.test"), 'Cc header missing');
    verify(!str_contains($GLOBALS['sent'][0]['headers'], 'Bcc:'), 'unexpected Bcc');
    verify(!str_contains($GLOBALS['sent'][0]['to'], 'copy@example.test'), 'Cc must not become To');
    verify(end($GLOBALS['calls'])['activity_email_protocol'] === 2, 'wrong acknowledgement protocol');
    verify(end($GLOBALS['calls'])['action'] === $expected, 'wrong v2 acknowledgement');
    verify(!str_contains(json_encode($GLOBALS['calls']), 'Private body'), 'private content leaked');
}

$GLOBALS['send_reject'] = $GLOBALS['send_throw'] = $GLOBALS['fail_ack'] = false;
foreach ([
    ['to_recipients'=>[]], ['to_recipients'=>null], ['cc_recipients'=>null],
    ['to_recipients'=>["first@example.test\r\nBcc:evil@example.test"]],
    ['cc_recipients'=>["copy@example.test\n"]],
    ['cc_recipients'=>['FIRST@example.test']],
    ['to_recipients'=>['first@example.test,second@example.test']],
    ['to_recipients'=>array_map(static fn(int $i): string => "user{$i}@example.test", range(1, 11)), 'cc_recipients'=>[]],
    ['bcc'=>['hidden@example.test']], ['bcc_recipients'=>['hidden@example.test']],
] as $changed) {
    $GLOBALS['claim'] = $multiClaim;
    $GLOBALS['claim']['email'] = array_merge($multiClaim['email'], $changed);
    $GLOBALS['calls'] = $GLOBALS['sent'] = [];
    $result = processOne($config, false, true);
    verify($result['status'] === 'failed', 'malformed recipients accepted');
    verify(count($GLOBALS['sent']) === 0, 'malformed recipients handed to provider');
    verify(end($GLOBALS['calls'])['action'] === 'failed', 'malformed payload not terminal');
}
foreach ([1, 3] as $protocol) {
    $GLOBALS['claim'] = $multiClaim;
    $GLOBALS['claim']['activity_email_protocol'] = $protocol;
    $GLOBALS['calls'] = $GLOBALS['sent'] = [];
    $result = processOne($config, false, true);
    verify($result['status'] === 'failed', 'unsupported payload accepted');
    verify(count($GLOBALS['sent']) === 0, 'unsupported payload partially sent');
}

$legacy = buildMail($config, 'Legacy@example.test', 'Old single', 'Body', []);
verify($legacy['to'] === 'Legacy@example.test', 'legacy address changed');
verify(!str_contains($legacy['headers'], 'Cc:'), 'legacy has unexpected Cc');
verify(str_contains($source, "'activity_email_protocol' => 1, 'activity_email_protocols' => [1, 2]"), 'update-first capability missing');
echo "PASS: v2 To/Cc, legacy compatibility, invalid and duplicate recipients, no Bcc, lost-ack safety.\n";
