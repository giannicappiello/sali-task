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
    if (($GLOBALS['fail_ack'] ?? false) && in_array($payload['action'], ['accepted', 'complete'], true)) throw new RuntimeException('private body');
    if ($payload['action'] === 'claim') return $GLOBALS['claim'];
    if ($payload['action'] === 'part_claim') return ['status' => $GLOBALS['part_claim_status'] ?? 'claimed'];
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
$GLOBALS['claim']['report_parts'] = ['plan_hash'=>str_repeat('a',64),'parts'=>[['part'=>0,'total'=>1,'artifact_keys'=>['group:ph']]]];
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

$GLOBALS['corrupt'] = false;
$GLOBALS['claim']['email']['destinatario'] = 'orders@example.test, owner@example.test';
$GLOBALS['calls'] = $GLOBALS['sent'] = [];
$result = processOne($config, true);
verify($result['status'] === 'sent' && count($GLOBALS['sent']) === 1, 'aggregate report was not sent exactly once');
verify($GLOBALS['sent'][0]['to'] === 'orders@example.test, owner@example.test', 'aggregate recipients changed');
verify(str_contains($GLOBALS['sent'][0]['body'], 'Report_PH.pdf'), 'aggregate PDF missing');
foreach (["orders@example.test, owner@example.test\r\nBcc:evil@example.test", 'orders@example.test, orders@example.test', 'orders@example.test, invalid', 'orders@example.test,'] as $invalid) {
    $GLOBALS['claim']['email']['destinatario'] = $invalid;
    $GLOBALS['calls'] = $GLOBALS['sent'] = [];
    try { processOne($config, true); throw new RuntimeException('invalid report recipients accepted'); }
    catch (Throwable $error) { verify(str_contains($error->getMessage(), 'recipients'), 'wrong aggregate validation error'); }
    verify(count($GLOBALS['sent']) === 0, 'invalid aggregate sent');
    verify(count(array_filter($GLOBALS['calls'], static fn(array $p): bool => $p['action'] === 'attachment')) === 0, 'PDF fetched before recipient validation');
}
echo "PASS: aggregate report sends both recipients once; CRLF, duplicates, invalid and empty mailboxes rejected before PDF download.\n";


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
    verify($GLOBALS['calls'][0]['activity_email_protocols'] === [1, 2, 3], 'v2 support missing');
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
foreach ([1, 4] as $protocol) {
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
verify(str_contains($source, "'activity_email_protocol' => 1, 'activity_email_protocols' => [1, 2, 3]"), 'update-first capability missing');
echo "PASS: v2 To/Cc, legacy compatibility, invalid and duplicate recipients, no Bcc, lost-ack safety.\n";

$GLOBALS['claim'] = ['status'=>'claimed', 'worker_id'=>'anomaly-worker', 'email'=>[
    'id'=>'anomaly:33333333-3333-4333-8333-333333333333', 'lock_token'=>'44444444-4444-4444-8444-444444444444',
    'destinatario'=>'manager@example.test', 'oggetto'=>'Criticità Progre', 'corpo'=>"Criticità in testo semplice\nNessun allegato.",
], 'attachments'=>[]];
foreach (['success', 'rejected', 'ambiguous', 'lost_ack'] as $scenario) {
    $GLOBALS['send_reject'] = $scenario === 'rejected';
    $GLOBALS['send_throw'] = $scenario === 'ambiguous';
    $GLOBALS['fail_ack'] = $scenario === 'lost_ack';
    $GLOBALS['calls'] = $GLOBALS['sent'] = [];
    $result = processOne($config, false, false, true);
    $expected = $scenario === 'success' ? 'sent' : ($scenario === 'rejected' ? 'failed' : 'uncertain');
    verify($result['status'] === $expected, 'wrong anomaly outcome: ' . $scenario);
    verify($GLOBALS['calls'][0]['anomaly_only'] === true, 'anomaly queue was not isolated');
    verify(count($GLOBALS['sent']) === 1, 'anomaly email sent repeatedly');
    verify(!str_contains($GLOBALS['sent'][0]['body'], 'Content-Disposition: attachment'), 'anomaly email has attachment');
    verify(end($GLOBALS['calls'])['action'] === ($scenario === 'success' ? 'complete' : 'retry'), 'wrong anomaly acknowledgement');
}
$GLOBALS['send_reject'] = $GLOBALS['send_throw'] = $GLOBALS['fail_ack'] = false;
$GLOBALS['claim']['attachments'] = [['filename'=>'unexpected.pdf', 'base64'=>base64_encode('%PDF')]];
$GLOBALS['calls'] = $GLOBALS['sent'] = [];
$result = processOne($config, false, false, true);
verify($result['status'] === 'failed' && count($GLOBALS['sent']) === 0, 'anomaly attachment was not rejected');
echo "PASS: isolated anomaly queue, text-only delivery, no attachments, definitive failure and uncertain-send deduplication.\n";

// The increased limit belongs only to ordinary activity protocol 3.
$GLOBALS['send_reject'] = $GLOBALS['send_throw'] = $GLOBALS['fail_ack'] = false;
foreach ([[2, 10, 'accepted'], [2, 11, 'failed'], [3, 11, 'accepted'], [3, 30, 'accepted'], [3, 31, 'failed']] as [$protocol, $total, $expected]) {
    $GLOBALS['claim'] = $multiClaim;
    $GLOBALS['claim']['activity_email_protocol'] = $protocol;
    $GLOBALS['claim']['email']['to_recipients'] = array_map(static fn(int $i): string => "to{$i}@example.test", range(1, 5));
    $GLOBALS['claim']['email']['cc_recipients'] = array_map(static fn(int $i): string => "cc{$i}@example.test", range(1, $total - 5));
    $GLOBALS['calls'] = $GLOBALS['sent'] = [];
    $result = processOne($config, false, true);
    verify($result['status'] === $expected, 'wrong protocol recipient limit');
    verify(count($GLOBALS['sent']) === ($expected === 'accepted' ? 1 : 0), 'wrong handoff count');
    if ($expected === 'accepted') {
        verify(count(explode(', ', $GLOBALS['sent'][0]['to'])) === 5, 'To recipients missing');
        verify(str_contains($GLOBALS['sent'][0]['headers'], 'cc' . ($total - 5) . '@example.test'), 'Cc recipients missing');
    }
    verify(end($GLOBALS['calls'])['activity_email_protocol'] === $protocol, 'wrong protocol acknowledgement');
}
try {
    buildMail($config, array_map(static fn(int $i): string => "user{$i}@example.test", range(1, 11)), 'Legacy', 'Body', []);
    throw new RuntimeException('default limit increased');
} catch (Throwable $error) {
    verify($error->getMessage() === 'Invalid email recipients.', 'non-activity limit changed');
}
echo "PASS: activity v3 limit 30 To+Cc, 31 rejected, legacy/report default limit unchanged.\n";

// The expanded envelope keeps the same no-retry lifecycle.
foreach (['rejected', 'ambiguous', 'lost_ack'] as $scenario) {
    $GLOBALS['claim'] = $multiClaim;
    $GLOBALS['claim']['activity_email_protocol'] = 3;
    $GLOBALS['claim']['email']['to_recipients'] = array_map(static fn(int $i): string => "to{$i}@example.test", range(1, 29));
    $GLOBALS['send_reject'] = $scenario === 'rejected';
    $GLOBALS['send_throw'] = $scenario === 'ambiguous';
    $GLOBALS['fail_ack'] = $scenario === 'lost_ack';
    $GLOBALS['calls'] = $GLOBALS['sent'] = [];
    $result = processOne($config, false, true);
    $expected = $scenario === 'rejected' ? 'failed' : 'uncertain';
    verify($result['status'] === $expected, 'wrong v3 outcome');
    verify(count($GLOBALS['sent']) === 1, 'v3 handoff retried');
    verify(end($GLOBALS['calls'])['action'] === $expected, 'wrong v3 acknowledgement');
}
$GLOBALS['send_reject'] = $GLOBALS['send_throw'] = $GLOBALS['fail_ack'] = false;
echo "PASS: activity v3 definitive rejection, ambiguous handoff and lost acknowledgement never retry.\n";
