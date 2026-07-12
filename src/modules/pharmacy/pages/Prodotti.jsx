import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";

export default function Prodotti({ utente }) {
  const [prodotti, setProdotti] = useState([]);
  const [categorie, setCategorie] = useState([]);
  const [sottocategorie, setSottocategorie] = useState([]);
  const [vendite, setVendite] = useState([]);
  const [giornate, setGiornate] = useState([]);
  const [farmacie, setFarmacie] = useState([]);
  const [beauty, setBeauty] = useState([]);

  const [ricerca, setRicerca] = useState("");
  const [sezione, setSezione] = useState("prodotti");
  const [prodottoPerformance, setProdottoPerformance] = useState(null);

  const [mostraFormProdotto, setMostraFormProdotto] = useState(false);
  const [mostraFormCategoria, setMostraFormCategoria] = useState(false);
  const [mostraFormSottocategoria, setMostraFormSottocategoria] = useState(false);

  const [prodottoInModifica, setProdottoInModifica] = useState(null);
  const [categoriaInModifica, setCategoriaInModifica] = useState(null);
  const [sottocategoriaInModifica, setSottocategoriaInModifica] = useState(null);

  const [nomeProdotto, setNomeProdotto] = useState("");
  const [codice, setCodice] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [sottocategoriaId, setSottocategoriaId] = useState("");
  const [prezzo, setPrezzo] = useState("");
  const [attivo, setAttivo] = useState(true);

  const [nomeCategoria, setNomeCategoria] = useState("");
  const [nomeSottocategoria, setNomeSottocategoria] = useState("");
  const solaLettura =
    utente?.ruolo === "beauty" ||
    utente?.ruolo === "agent" ||
    utente?.ruolo === "sales_manager";
  useEffect(() => {
    caricaDati();
  }, []);

  async function caricaDati() {
    const prodottiRes = await supabase.from("prodotti").select("*").order("nome", { ascending: true });
    const categorieRes = await supabase.from("categorie_prodotti").select("*").order("nome", { ascending: true });
    const sottocategorieRes = await supabase.from("sottocategorie_prodotti").select("*").order("nome", { ascending: true });
    const venditeRes = await supabase.from("vendite_prodotti").select("*");
    const giornateRes = await supabase.from("giornate_promozionali").select("*");
    const farmacieRes = await supabase.from("farmacie").select("*");
    const beautyRes = await supabase.from("beauty_consultant").select("*");

    if (prodottiRes.error) return alert(prodottiRes.error.message);
    if (categorieRes.error) return alert(categorieRes.error.message);
    if (sottocategorieRes.error) return alert(sottocategorieRes.error.message);
    if (venditeRes.error) return alert(venditeRes.error.message);
    if (giornateRes.error) return alert(giornateRes.error.message);
    if (farmacieRes.error) return alert(farmacieRes.error.message);
    if (beautyRes.error) return alert(beautyRes.error.message);

    setProdotti(prodottiRes.data || []);
    setCategorie(categorieRes.data || []);
    setSottocategorie(sottocategorieRes.data || []);
    setVendite(venditeRes.data || []);
    setGiornate(giornateRes.data || []);
    setFarmacie(farmacieRes.data || []);
    setBeauty(beautyRes.data || []);
  }

  function getCategoriaNome(id) {
    return categorie.find((c) => c.id === id)?.nome || "";
  }

  function getSottocategoriaNome(id) {
    return sottocategorie.find((s) => s.id === id)?.nome || "";
  }

  function getGiornata(id) {
    return giornate.find((g) => g.id === id);
  }

  function getFarmaciaNome(id) {
    return farmacie.find((f) => f.id === id)?.nome || "Non indicata";
  }

  function getBeautyNome(id) {
    const b = beauty.find((item) => item.id === id);
    return b ? `${b.cognome || ""} ${b.nome || ""}`.trim() : "Non indicata";
  }

  function getMeseLabel(dataIso) {
    if (!dataIso) return "Non indicato";
    const [anno, mese] = dataIso.split("-");
    return `${mese}/${anno}`;
  }

  const prodottiFiltrati = prodotti.filter((prodotto) => {
    const testo = `${prodotto.nome || ""} ${prodotto.codice || ""} ${
      prodotto.categoria || ""
    } ${getCategoriaNome(prodotto.categoria_id)} ${getSottocategoriaNome(
      prodotto.sottocategoria_id
    )}`.toLowerCase();

    return testo.includes(ricerca.toLowerCase());
  });

  function getVenditeProdotto(prodotto) {
    return vendite.filter(
      (v) =>
        v.prodotto_id === prodotto.id ||
        (v.codice_prodotto && prodotto.codice && v.codice_prodotto === prodotto.codice) ||
        (!v.prodotto_id && v.nome_prodotto === prodotto.nome)
    );
  }

  function calcolaPerformanceProdotto(prodotto) {
    const venditeProdotto = getVenditeProdotto(prodotto);

    const pezziTotali = venditeProdotto.reduce(
      (tot, v) => tot + Number(v.quantita || 0),
      0
    );

    const farmacieSet = new Set();
    const beautyMap = {};
    const trendMap = {};

    venditeProdotto.forEach((v) => {
      const giornata = getGiornata(v.giornata_id);
      if (!giornata) return;

      if (giornata.farmacia_id) farmacieSet.add(giornata.farmacia_id);

      const beautyNome = getBeautyNome(giornata.consultant_id);
      beautyMap[beautyNome] = (beautyMap[beautyNome] || 0) + Number(v.quantita || 0);

      const mese = getMeseLabel(giornata.data);
      trendMap[mese] = (trendMap[mese] || 0) + Number(v.quantita || 0);
    });

    const beautyMigliore =
      Object.entries(beautyMap)
        .map(([nome, pezzi]) => ({ nome, pezzi }))
        .sort((a, b) => b.pezzi - a.pezzi)[0] || null;

    const trendUltimiTreMesi = Object.entries(trendMap)
      .map(([mese, pezzi]) => ({ mese, pezzi }))
      .sort((a, b) => {
        const [meseA, annoA] = a.mese.split("/");
        const [meseB, annoB] = b.mese.split("/");
        return new Date(`${annoA}-${meseA}-01`) - new Date(`${annoB}-${meseB}-01`);
      })
      .slice(-3);

    const farmacieVendita = Array.from(farmacieSet).map((id) => getFarmaciaNome(id));

    return {
      pezziTotali,
      numeroFarmacie: farmacieSet.size,
      beautyMigliore,
      trendUltimiTreMesi,
      farmacieVendita,
      venditeProdotto,
    };
  }

  function svuotaFormProdotto() {
    setNomeProdotto("");
    setCodice("");
    setCategoriaId("");
    setSottocategoriaId("");
    setPrezzo("");
    setAttivo(true);
    setProdottoInModifica(null);
  }

  function svuotaFormCategoria() {
    setNomeCategoria("");
    setCategoriaInModifica(null);
  }

  function svuotaFormSottocategoria() {
    setNomeSottocategoria("");
    setSottocategoriaInModifica(null);
  }

  function apriNuovoProdotto() {
    svuotaFormProdotto();
    setMostraFormProdotto(true);
  }

  function apriNuovaCategoria() {
    svuotaFormCategoria();
    setMostraFormCategoria(true);
  }

  function apriNuovaSottocategoria() {
    svuotaFormSottocategoria();
    setMostraFormSottocategoria(true);
  }

  function modificaProdotto(prodotto) {
    setProdottoInModifica(prodotto);
    setNomeProdotto(prodotto.nome || "");
    setCodice(prodotto.codice || "");
    setCategoriaId(prodotto.categoria_id || "");
    setSottocategoriaId(prodotto.sottocategoria_id || "");
    setPrezzo(prodotto.prezzo || "");
    setAttivo(prodotto.attivo !== false);
    setMostraFormProdotto(true);
  }

  function modificaCategoria(categoria) {
    setCategoriaInModifica(categoria);
    setNomeCategoria(categoria.nome || "");
    setMostraFormCategoria(true);
  }

  function modificaSottocategoria(sottocategoria) {
    setSottocategoriaInModifica(sottocategoria);
    setNomeSottocategoria(sottocategoria.nome || "");
    setMostraFormSottocategoria(true);
  }

  async function salvaProdotto(e) {
    e.preventDefault();

    const datiProdotto = {
      nome: nomeProdotto,
      codice,
      categoria_id: categoriaId || null,
      sottocategoria_id: sottocategoriaId || null,
      categoria: getCategoriaNome(categoriaId),
      prezzo: prezzo || 0,
      attivo,
    };

    const response = prodottoInModifica
      ? await supabase.from("prodotti").update(datiProdotto).eq("id", prodottoInModifica.id)
      : await supabase.from("prodotti").insert([datiProdotto]);

    if (response.error) return alert(response.error.message);

    svuotaFormProdotto();
    setMostraFormProdotto(false);
    await caricaDati();
  }

  async function salvaCategoria(e) {
    e.preventDefault();

    const datiCategoria = { nome: nomeCategoria };

    const response = categoriaInModifica
      ? await supabase.from("categorie_prodotti").update(datiCategoria).eq("id", categoriaInModifica.id)
      : await supabase.from("categorie_prodotti").insert([datiCategoria]);

    if (response.error) return alert(response.error.message);

    svuotaFormCategoria();
    setMostraFormCategoria(false);
    await caricaDati();
  }

  async function salvaSottocategoria(e) {
    e.preventDefault();

    const datiSottocategoria = { nome: nomeSottocategoria };

    const response = sottocategoriaInModifica
      ? await supabase
          .from("sottocategorie_prodotti")
          .update(datiSottocategoria)
          .eq("id", sottocategoriaInModifica.id)
      : await supabase.from("sottocategorie_prodotti").insert([datiSottocategoria]);

    if (response.error) return alert(response.error.message);

    svuotaFormSottocategoria();
    setMostraFormSottocategoria(false);
    await caricaDati();
  }

  async function eliminaProdotto(prodotto) {
    const conferma = window.confirm(`Vuoi eliminare "${prodotto.nome}"?`);
    if (!conferma) return;

    const { error } = await supabase.from("prodotti").delete().eq("id", prodotto.id);
    if (error) return alert(error.message);

    await caricaDati();
  }

  async function eliminaCategoria(categoria) {
    const conferma = window.confirm(`Vuoi eliminare "${categoria.nome}"?`);
    if (!conferma) return;

    const { error } = await supabase.from("categorie_prodotti").delete().eq("id", categoria.id);
    if (error) return alert(error.message);

    await caricaDati();
  }

  async function eliminaSottocategoria(sottocategoria) {
    const conferma = window.confirm(`Vuoi eliminare "${sottocategoria.nome}"?`);
    if (!conferma) return;

    const { error } = await supabase
      .from("sottocategorie_prodotti")
      .delete()
      .eq("id", sottocategoria.id);

    if (error) return alert(error.message);

    await caricaDati();
  }

  if (prodottoPerformance) {
    const performance = calcolaPerformanceProdotto(prodottoPerformance);

    return (
      <div>
        <div style={headerStyle}>
          <h2>Performance prodotto</h2>
          <p style={subtitleStyle}>{prodottoPerformance.nome}</p>
        </div>

        <button
          style={backButtonStyle}
          onClick={() => setProdottoPerformance(null)}
        >
          ← Torna ai prodotti
        </button>

        <div style={kpiGridStyle}>
          <div style={kpiCardStyle}>
            <h3>{performance.pezziTotali}</h3>
            <p>Pezzi venduti totali</p>
          </div>

          <div style={kpiCardStyle}>
            <h3>{performance.numeroFarmacie}</h3>
            <p>Farmacie che l'hanno venduto</p>
          </div>

          <div style={kpiCardStyle}>
            <h3>{performance.beautyMigliore?.pezzi || 0}</h3>
            <p>Beauty migliore: {performance.beautyMigliore?.nome || "-"}</p>
          </div>
        </div>

        <div style={cardStyle}>
          <h3>Trend ultimi 3 mesi</h3>

          {performance.trendUltimiTreMesi.length === 0 && (
            <p>Nessun dato disponibile.</p>
          )}

          {performance.trendUltimiTreMesi.map((item) => (
            <div key={item.mese} style={rowStyle}>
              <span>{item.mese}</span>
              <strong>{item.pezzi} pz</strong>
            </div>
          ))}
        </div>

        <div style={cardStyle}>
          <h3>Farmacie che hanno venduto il prodotto</h3>

          {performance.farmacieVendita.length === 0 && (
            <p>Nessuna farmacia registrata.</p>
          )}

          {performance.farmacieVendita.map((nome) => (
            <div key={nome} style={rowStyle}>
              <span>{nome}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>Prodotti</h2>
        <p style={subtitleStyle}>Gestisci categorie, sottocategorie e prodotti</p>
      </div>

      <div style={tabsStyle}>
        <button style={sezione === "prodotti" ? activeTabStyle : tabStyle} onClick={() => setSezione("prodotti")}>
          Prodotti
        </button>

        <button style={sezione === "categorie" ? activeTabStyle : tabStyle} onClick={() => setSezione("categorie")}>
          Categorie
        </button>

        <button style={sezione === "sottocategorie" ? activeTabStyle : tabStyle} onClick={() => setSezione("sottocategorie")}>
          Sottocategorie
        </button>
      </div>

      {sezione === "prodotti" && (
        <>
          {!mostraFormProdotto && (
            <>
              <input
                style={searchStyle}
                placeholder="Ricerca rapida prodotti..."
                value={ricerca}
                onChange={(e) => setRicerca(e.target.value)}
              />

              {!solaLettura && (
                <button style={primaryButtonStyle} onClick={apriNuovoProdotto}>
                  + Nuovo prodotto
                </button>
              )}
            </>
          )}

          {mostraFormProdotto && (
            <form onSubmit={salvaProdotto} style={formStyle}>
              <button
                type="button"
                style={backButtonStyle}
                onClick={() => {
                  svuotaFormProdotto();
                  setMostraFormProdotto(false);
                }}
              >
                ← Torna indietro
              </button>

              <input style={inputStyle} placeholder="Nome prodotto" value={nomeProdotto} onChange={(e) => setNomeProdotto(e.target.value)} required />
              <input style={inputStyle} placeholder="Codice prodotto" value={codice} onChange={(e) => setCodice(e.target.value)} />

              <select style={inputStyle} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Seleziona categoria</option>
                {categorie.map((categoria) => (
                  <option key={categoria.id} value={categoria.id}>
                    {categoria.nome}
                  </option>
                ))}
              </select>

              <select style={inputStyle} value={sottocategoriaId} onChange={(e) => setSottocategoriaId(e.target.value)}>
                <option value="">Seleziona sottocategoria</option>
                {sottocategorie.map((sottocategoria) => (
                  <option key={sottocategoria.id} value={sottocategoria.id}>
                    {sottocategoria.nome}
                  </option>
                ))}
              </select>

              <input style={inputStyle} type="number" step="0.01" placeholder="Prezzo" value={prezzo} onChange={(e) => setPrezzo(e.target.value)} />

              <label style={checkStyle}>
                <input type="checkbox" checked={attivo} onChange={(e) => setAttivo(e.target.checked)} />
                Prodotto attivo
              </label>

              <button style={saveButtonStyle} type="submit">
                {prodottoInModifica ? "Aggiorna prodotto" : "Salva prodotto"}
              </button>
            </form>
          )}

          {!mostraFormProdotto && (
            <div style={listStyle}>
              {prodottiFiltrati.map((prodotto) => (
                <div key={prodotto.id} style={cardStyle}>
                  <h3>{prodotto.nome}</h3>

                  {prodotto.codice && (
                    <p>
                      <span style={labelStyle}>Codice:</span> {prodotto.codice}
                    </p>
                  )}

                  <p>
                    <span style={labelStyle}>Categoria:</span>{" "}
                    {getCategoriaNome(prodotto.categoria_id) || prodotto.categoria || "-"}
                  </p>

                  <p>
                    <span style={labelStyle}>Sottocategoria:</span>{" "}
                    {getSottocategoriaNome(prodotto.sottocategoria_id) || "-"}
                  </p>

                  <p>
                    <span style={labelStyle}>Prezzo:</span> € {Number(prodotto.prezzo || 0).toFixed(2)}
                  </p>

                  <p>
                    <span style={labelStyle}>Stato:</span>{" "}
                    {prodotto.attivo === false ? "Non attivo" : "Attivo"}
                  </p>

                  <div style={actionRowStyle}>

                    {!solaLettura && (
                      <button style={editButtonStyle} onClick={() => modificaProdotto(prodotto)}>
                      Modifica
                      </button>
                    )}

                    <button
                      style={performanceButtonStyle}
                      onClick={() => setProdottoPerformance(prodotto)}
                    >
                      Performance
                    </button>

                    {!solaLettura && (
                      <button style={deleteButtonStyle} onClick={() => eliminaProdotto(prodotto)}>
                        Elimina
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {sezione === "categorie" && (
        <>
          {!mostraFormCategoria && !solaLettura && (
            <button style={primaryButtonStyle} onClick={apriNuovaCategoria}>
               + Nuova categoria
            </button>
          )}

          {mostraFormCategoria && (
            <form onSubmit={salvaCategoria} style={formStyle}>
              <button type="button" style={backButtonStyle} onClick={() => { svuotaFormCategoria(); setMostraFormCategoria(false); }}>
                ← Torna indietro
              </button>

              <input style={inputStyle} placeholder="Nome categoria" value={nomeCategoria} onChange={(e) => setNomeCategoria(e.target.value)} required />

              <button style={saveButtonStyle} type="submit">
                {categoriaInModifica ? "Aggiorna categoria" : "Salva categoria"}
              </button>
            </form>
          )}

          {!mostraFormCategoria && (
            <div style={listStyle}>
              {categorie.map((categoria) => (
                <div key={categoria.id} style={cardStyle}>
                  <h3>{categoria.nome}</h3>

                  {!solaLettura && (
                    <div style={actionRowStyle}>
                      <button style={editButtonStyle} onClick={() => modificaCategoria(categoria)}>
                        Modifica
                      </button>

                      <button style={deleteButtonStyle} onClick={() => eliminaCategoria(categoria)}>
                        Elimina
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {sezione === "sottocategorie" && (
        <>
          {!mostraFormSottocategoria && !solaLettura && (
            <button style={primaryButtonStyle} onClick={apriNuovaSottocategoria}>
              + Nuova sottocategoria
            </button>
          )}

          {mostraFormSottocategoria && (
            <form onSubmit={salvaSottocategoria} style={formStyle}>
              <button type="button" style={backButtonStyle} onClick={() => { svuotaFormSottocategoria(); setMostraFormSottocategoria(false); }}>
                ← Torna indietro
              </button>

              <input style={inputStyle} placeholder="Nome sottocategoria" value={nomeSottocategoria} onChange={(e) => setNomeSottocategoria(e.target.value)} required />

              <button style={saveButtonStyle} type="submit">
                {sottocategoriaInModifica ? "Aggiorna sottocategoria" : "Salva sottocategoria"}
              </button>
            </form>
          )}

          {!mostraFormSottocategoria && (
            <div style={listStyle}>
              {sottocategorie.map((sottocategoria) => (
                <div key={sottocategoria.id} style={cardStyle}>
                  <h3>{sottocategoria.nome}</h3>

                  {!solaLettura && (
                    <div style={actionRowStyle}>
                      <button
                        style={editButtonStyle}
                        onClick={() => modificaSottocategoria(sottocategoria)}
                      >
                        Modifica
                      </button>

                      <button
                        style={deleteButtonStyle}
                        onClick={() => eliminaSottocategoria(sottocategoria)}
                      >
                        Elimina
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const headerStyle = { marginBottom: "22px", textAlign: "center" };

const subtitleStyle = {
  fontSize: "14px",
  color: "#6B645C",
  marginTop: "6px",
};

const tabsStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: "8px",
  marginBottom: "18px",
};

const tabStyle = {
  padding: "12px",
  border: "1px solid #D8D1CB",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const activeTabStyle = {
  ...tabStyle,
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  border: "1px solid #2D2B28",
};

const searchStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "15px",
  marginBottom: "14px",
  borderRadius: "14px",
  border: "1.5px solid #2D2B28",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontSize: "15px",
};

const primaryButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "15px",
  marginBottom: "20px",
  border: "1px solid #6B645C",
  borderRadius: "16px",
  backgroundColor: "#6B645C",
  color: "#FFFFFF",
  fontSize: "16px",
  fontWeight: "600",
  cursor: "pointer",
};

const saveButtonStyle = {
  ...primaryButtonStyle,
  backgroundColor: "#2D2B28",
  border: "1px solid #2D2B28",
  marginBottom: 0,
};

const backButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px",
  marginBottom: "4px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontSize: "15px",
  fontWeight: "600",
  cursor: "pointer",
};

const formStyle = {
  display: "grid",
  gap: "12px",
  padding: "20px",
  marginBottom: "24px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
};

const inputStyle = {
  padding: "14px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  fontSize: "15px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
};

const checkStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontWeight: "600",
};

const listStyle = {
  display: "grid",
  gap: "16px",
};

const cardStyle = {
  padding: "20px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  lineHeight: "1.6",
};

const kpiGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "14px",
  marginBottom: "20px",
};

const kpiCardStyle = {
  padding: "18px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  textAlign: "center",
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px",
  borderRadius: "10px",
  backgroundColor: "#F7F5F2",
  marginBottom: "8px",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};

const actionRowStyle = {
  display: "flex",
  gap: "10px",
  marginTop: "16px",
  flexWrap: "wrap",
};

const editButtonStyle = {
  flex: 1,
  minWidth: "90px",
  padding: "10px 16px",
  border: "1px solid #B8ADA4",
  borderRadius: "12px",
  backgroundColor: "#F7F5F2",
  color: "#2D2B28",
  fontSize: "14px",
  fontWeight: "600",
  cursor: "pointer",
};

const performanceButtonStyle = {
  flex: 1,
  minWidth: "110px",
  padding: "10px 16px",
  border: "1px solid #2D2B28",
  borderRadius: "12px",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  fontSize: "14px",
  fontWeight: "600",
  cursor: "pointer",
};

const deleteButtonStyle = {
  flex: 1,
  minWidth: "90px",
  padding: "10px 16px",
  border: "1px solid #8B0000",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#8B0000",
  fontSize: "14px",
  fontWeight: "600",
  cursor: "pointer",
};