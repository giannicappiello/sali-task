export async function retailerRegistration(input) {
  const response = await fetch('/api/club-retailer-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const result = await response.json();if (!response.ok) throw new Error(result.error || 'Registrazione non disponibile.');return result;
}
