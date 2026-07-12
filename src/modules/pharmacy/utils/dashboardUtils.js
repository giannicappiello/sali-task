export function formatDataIt(dataIso) {
  if (!dataIso) return "";
  const [anno, mese, giorno] = dataIso.split("-");
  return `${giorno}/${mese}/${anno}`;
}

export function formatEuro(valore) {
  return `€ ${Number(valore || 0).toFixed(2)}`;
}

export function filtraGiornatePeriodo(
  giornate,
  dataDa,
  dataA,
  farmaciaFiltro,
  beautyFiltro
) {
  return giornate.filter((g) => {
    if (dataDa && g.data < dataDa) return false;
    if (dataA && g.data > dataA) return false;
    if (farmaciaFiltro && g.farmacia_id !== farmaciaFiltro) return false;
    if (beautyFiltro && g.consultant_id !== beautyFiltro) return false;
    return true;
  });
}

export function filtraAperturePeriodo(
  apertureContatti,
  dataDa,
  dataA,
  farmaciaFiltro,
  beautyFiltro
) {
  return apertureContatti.filter((a) => {
    const dataCreazione = a.created_at ? a.created_at.split("T")[0] : "";

    if (dataDa && dataCreazione < dataDa) return false;
    if (dataA && dataCreazione > dataA) return false;
    if (farmaciaFiltro && a.farmacia_id !== farmaciaFiltro) return false;
    if (beautyFiltro && a.beauty_id !== beautyFiltro) return false;

    return true;
  });
}

export function calcolaKpiBase(giornatePeriodo) {
  const giornatePianificate = giornatePeriodo.filter(
    (g) => g.stato === "pianificata"
  ).length;

  const giornateEseguite = giornatePeriodo.filter(
    (g) => g.stato === "eseguita"
  ).length;

  const fatturatoPeriodo = giornatePeriodo.reduce(
    (tot, g) => tot + Number(g.fatturato_giornata || 0),
    0
  );

  const pezziVenduti = giornatePeriodo.reduce(
    (tot, g) => tot + Number(g.numero_totale_pezzi_venduti || 0),
    0
  );

  const clientiIntervistati = giornatePeriodo.reduce(
    (tot, g) => tot + Number(g.clienti_intervistati || 0),
    0
  );

  const clientiAcquistato = giornatePeriodo.reduce(
    (tot, g) => tot + Number(g.clienti_acquistato || 0),
    0
  );

  const conversione =
    clientiIntervistati > 0
      ? (clientiAcquistato / clientiIntervistati) * 100
      : 0;

  const mediaFatturato =
    giornateEseguite > 0 ? fatturatoPeriodo / giornateEseguite : 0;

  return {
    giornatePianificate,
    giornateEseguite,
    fatturatoPeriodo,
    pezziVenduti,
    clientiIntervistati,
    clientiAcquistato,
    conversione,
    mediaFatturato,
  };
}

export function calcolaKpiAperture(aperturePeriodo) {
  const richiesteContattoAperte = aperturePeriodo.filter(
    (a) => a.richiesta_contatto === true && a.stato === "aperta"
  );

  const nuoveAperturePeriodo = aperturePeriodo.filter(
    (a) => a.nuova_apertura === true
  ).length;

  const richiesteContattoPeriodo = aperturePeriodo.filter(
    (a) => a.richiesta_contatto === true
  ).length;

  return {
    richiesteContattoAperte,
    nuoveAperturePeriodo,
    richiesteContattoPeriodo,
    richiesteContattoAperteNumero: richiesteContattoAperte.length,
  };
}