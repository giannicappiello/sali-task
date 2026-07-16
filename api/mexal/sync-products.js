import https from "https";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = Buffer.from(
      `${process.env.MEXAL_USERNAME}:${process.env.MEXAL_PASSWORD}`
    ).toString("base64");

    const coordinates =
      `Azienda=${process.env.MEXAL_AZIENDA} ` +
      `Anno=${process.env.MEXAL_ANNO} ` +
      `Magazzino=${process.env.MEXAL_MAGAZZINO}`;

    const agent = new https.Agent({
      rejectUnauthorized: false,
    });

    const response = await fetch(
      `${process.env.MEXAL_BASE_URL}/webapi/risorse/dati-generali/gruppi-merceologici`,
      {
        method: "GET",
        agent,
        headers: {
          Authorization: `Passepartout ${auth}`,
          "Coordinate-Gestionale": coordinates,
        },
      }
    );

    const text = await response.text();

    return res.status(response.status).json({
      ok: response.ok,
      status: response.status,
      mexal_response: text,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
}
