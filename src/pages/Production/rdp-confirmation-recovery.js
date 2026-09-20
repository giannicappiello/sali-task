export function uncertainConfirmation(error) {
  return error?.name === "TypeError" || error?.name === "AbortError" ||
    /^(V4_CONFIRM_PENDING|PROGREMES_TIMEOUT|PROGREMES_HTTP_50[234])$/.test(error?.code || "");
}

export async function recoverConfirmation(send, { onPending = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 6 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await send(); }
    catch (error) {
      if (!uncertainConfirmation(error)) throw error;
      onPending();
      if (attempt === attempts - 1) throw Object.assign(new Error("Esito MES ancora in verifica. Riapri questa RdP per riprendere il recupero della stessa conferma; non ricalcolarla."), { code: "V4_CONFIRM_PENDING" });
      await wait(Math.min(15000, 3000 * (attempt + 1)));
    }
  }
}
