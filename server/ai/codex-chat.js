import { verifiedOperationalAnswer } from './operational-outcome.js';
/* global Buffer */
import { randomUUID } from 'node:crypto';
import { CODEX_RUNTIME, codexEnabled, createCodexClient, driveCodexRun } from './codex-agent.js';
import { codexFailure, codexStore } from './codex-store.js';

export async function recoverCodexRequest(auth, body) {
  if (body.action !== 'codex_continue') return { ...body, _codexRun: undefined };
  if (!codexEnabled()) throw codexFailure('Il collegamento Codex è disattivato.', 503);
  const run = await codexStore(auth).run(body.runId);
  if (body.conversationId && body.conversationId !== run.conversation_id) throw codexFailure('Conversazione non corrispondente.', 404);
  return { ...run.request, attachments: [], action: 'codex_continue', runId: run.id, conversationId: run.conversation_id, correlationId: run.id, _codexRun: run };
}

export async function cancelCodexRun(auth, runId) {
  const store = codexStore(auth), run = await store.run(runId);
  if (run.state !== 'pending') return { cancelled: run.state === 'cancelled' };
  const claim = await store.claim(run.id);
  if (!claim) throw codexFailure('Codex sta completando un passaggio. Riprova tra pochi secondi.');
  try {
    if (claim.run.session_id) await createCodexClient().send(claim.run.session_id, [{ type: 'agent.session.input.cancel' }]);
    await store.saveRun(run.id, claim.lease, { state: 'cancelled', error: 'Interrotto dall’utente.' });
    return { cancelled: true };
  } finally { await store.release(run.id, claim.lease); }
}

export async function runWorkspaceCodex({ auth, body, conversationId, prompt, displayedPrompt, attachments,
  attachmentMetadata, mode, screenContext, context, history, instructions, tools, requestedArtifacts }) {
  const store = codexStore(auth);
  // Validate configuration before persisting the user request.
  const client = createCodexClient();
  const requestId = body.correlationId || randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw codexFailure('Identificativo richiesta non valido.', 400);
  const run = body._codexRun || await store.start(conversationId, requestId, { prompt, displayedPrompt, mode, screenContext, attachments: attachmentMetadata,
    modelAttachments: attachments.map(file => ({ filename: file.filename, mediaType: file.mediaType, base64: Buffer.from(file.data).toString('base64') })) });
  if (!body._codexRun) return run.state === 'completed' ? { ...run.response, capabilities: auth.capabilities } : {
    pending: true, runId: run.id, conversationId, runtime: CODEX_RUNTIME, progress: 'Codex prende in carico la richiesta…', capabilities: auth.capabilities,
  };
  const modelAttachments = (run.request.modelAttachments || []).map(file => ({ ...file, data: Buffer.from(file.base64, 'base64') }));
  const result = await driveCodexRun({ store, run, tools, client, instructions, attachments: modelAttachments, history,
    context: { ...context, screenContext },
    scope: { userId: auth.profile.id, roleId: auth.profile.ruolo_id, access: auth.access, development: auth.developmentPermissions },
    finalize: async ({ text, calls, usage, run: completed, model }) => {
      const results = calls.filter(call => call.outcome?.success).map(call => ({ name: call.name, output: JSON.parse(call.outcome.output) }));
      const controlledActions = results.map(call => call.output?.controlledAction).filter(Boolean);
      const headingAction = results.map(call => call.output?.headingAction).find(Boolean) || null;
      const developmentJob = results.map(call => call.output?.developmentJob).find(Boolean);
      const developmentSummary = developmentJob ? { id: developmentJob.id, status: developmentJob.status } : null;
      const runtimeOperations = results.map(call => call.output?.operation?.id).filter(Boolean);
      const costProposalId = results.filter(call => call.name === 'PRODUCTION_COST_PROPOSE').map(call => call.output?.proposal?.id).filter(Boolean).at(-1) || null;
      const artifacts = developmentJob ? [] : requestedArtifacts(prompt, completed.id);
      const response = { conversationId, runId: completed.id, runtime: CODEX_RUNTIME, answer: verifiedOperationalAnswer(text, results.map(call => call.output)), sources: [], usage,
        controlledActions, controlledAction: controlledActions[0] || null, headingAction, developmentJob: developmentSummary,
        runtimeOperations, costProposalId, artifacts, downloadablePdf: artifacts.some(item => item.kind === 'pdf') };
      const metadata = { ...response, model, mode, codexRunId: completed.id, codexSessionId: completed.session_id,
        headingToolCalls: calls.map(call => call.name), screenContext };
      delete metadata.answer;
      return { response, metadata };
    },
  });
  return { ...result, capabilities: auth.capabilities };
}
