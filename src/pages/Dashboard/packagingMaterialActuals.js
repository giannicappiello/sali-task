const quantity = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;

export function calculateMaterialActuals({ required, unit }, produced, planned, current = {}, manualConsumption = false) {
  const pieces = quantity(produced), batch = quantity(planned);
  let consumed = quantity(current.consumed);
  if (!manualConsumption) {
    const proportional = pieces != null && batch > 0 ? Number(required) * pieces / batch : null;
    consumed = proportional == null ? null : String(unit).toUpperCase() === 'PZ' ? Math.ceil(proportional) : round(proportional);
  }
  const returned = quantity(current.returned), wasted = quantity(current.wasted);
  const deposited = consumed == null || returned == null || wasted == null ? null : round(consumed + returned + wasted);
  return { consumed, returned, wasted, deposited };
}
