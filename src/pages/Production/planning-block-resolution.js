export function planningBlockResolution(message) {
  const match = /^(.+?) \/ OP (\d+), (Production|Packaging|Cartoning): formula o distinta modificata nei fabbisogni della fase conservata\./.exec(message);
  if (!match) return null;
  return { number: match[1], orderId: Number(match[2]), phase: { Production: "Miscelazione", Packaging: "Confezionamento", Cartoning: "Astucciatura" }[match[3]] };
}

export function planningResolutionInput(input, orderId, now) {
  if (input.kind !== "RECALCULATE") throw new Error("Questa soluzione richiede una revisione del piano.");
  return { ...input, orderIds: input.orderIds?.length ? [...new Set([...input.orderIds, orderId])] : null,
    startAt: input.startAt < now ? now : input.startAt };
}
