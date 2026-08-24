export async function mexalAuthenticatedRequest(path, payload, {
  getToken,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof getToken !== "function") throw new Error("Provider token Mexal non configurato.");
  if (typeof fetchImpl !== "function") throw new Error("Client HTTP Mexal non configurato.");

  const request = async (refresh = false) => {
    const token = await getToken({ refresh });
    return fetchImpl(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  };

  const response = await request();
  return response.status === 401 ? request(true) : response;
}
