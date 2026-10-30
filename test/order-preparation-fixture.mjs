import { randomUUID } from "node:crypto";
export const actor = "11111111-1111-4111-8111-111111111111";
export const migration = new URL(
  "../supabase/migrations/20261030163000_warehouse_order_preparation.sql",
  import.meta.url,
);
export async function preparationDatabase(PGlite) {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create table utenti(id uuid primary key,attivo boolean);insert into utenti values('${actor}',true);
 create table workspace_aree(codice text primary key,nome text,descrizione text,icona text,ordine int);
 create table workspace_moduli(codice text primary key,aree text[],aggiornato_il timestamptz);insert into workspace_moduli values('magazzino',array['produzione'],now());
 create table workspace_schermate(codice text primary key,nome text,descrizione text,provider text,percorso text,chiave_componente text,protetta boolean,attiva boolean,ordine int,area text,aree text[],icona text,metadati jsonb,ultima_sincronizzazione timestamptz);
 create table workspace_moduli_schermate(modulo_codice text,schermata_codice text,ordine int,predefinita boolean,visibile_menu boolean,primary key(modulo_codice,schermata_codice));
 create table permessi(codice text primary key,descrizione text,modulo text);
 create table ordini_prodotti_cache(codice_articolo text,descrizione text,ean text,unita_misura text);
 create table ordini_clienti_cache(codice_cliente text,ragione_sociale text);
 insert into ordini_prodotti_cache values('IT0001','Primo prodotto','000001','PZ'),('IT0002','Secondo prodotto','000002','PZ'),('IT0003','Prodotto estraneo','000003','PZ');
 insert into ordini_clienti_cache values('501.00001','Cliente prova');`);
  const { readFile } = await import("node:fs/promises");
  await db.exec(await readFile(migration, "utf8"));
  await db.exec(
    "update warehouse_preparation_settings set ddt_series=1;insert into warehouse_preparation_products(code,pieces_per_carton) values('IT0001',2)",
  );
  return db;
}
const allowed = new Set([
  "warehouse_preparation_settings",
  "warehouse_preparation_products",
  "warehouse_order_preparations",
  "warehouse_preparation_lot_holds",
  "warehouse_preparation_events",
  "ordini_prodotti_cache",
  "ordini_clienti_cache",
]);
export function supabaseAdapter(sql) {
  return {
    from(table) {
      if (!allowed.has(table)) throw Error("Unexpected table " + table);
      let columns = "*",
        filters = [],
        values = [],
        limit = "",
        order = "",
        mode = "select",
        data,
        single = false,
        maybe = false;
      const column = (c) => {
        if (!/^[a-z_]+$/.test(c)) throw Error("Bad column");
        return c;
      };
      const query = {
        select(c = "*") {
          columns = c;
          return query;
        },
        eq(c, v) {
          values.push(v);
          filters.push(`${column(c)}=$${values.length}`);
          return query;
        },
        neq(c, v) {
          values.push(v);
          filters.push(`${column(c)}<>$${values.length}`);
          return query;
        },
        in(c, v) {
          values.push(v);
          filters.push(`${column(c)}=any($${values.length})`);
          return query;
        },
        limit(n) {
          limit = ` limit ${Number(n)}`;
          return query;
        },
        order(c, o = {}) {
          order = ` order by ${column(c)} ${o.ascending === false ? "desc" : "asc"}`;
          return query;
        },
        single() {
          single = true;
          return query;
        },
        maybeSingle() {
          single = true;
          maybe = true;
          return query;
        },
        update(d) {
          mode = "update";
          data = d;
          return query;
        },
        upsert(d) {
          mode = "upsert";
          data = d;
          return query;
        },
        async then(resolve, reject) {
          try {
            let statement;
            const where = filters.length
              ? " where " + filters.join(" and ")
              : "";
            if (mode === "select" && columns !== "*")
              statement = `select ${columns.split(",").map(column).join(",")} from ${table}${where}${order}${limit}`;
            if (columns === "*" && mode === "select")
              statement = `select * from ${table}${where}${order}${limit}`;
            if (mode === "update") {
              const set = Object.entries(data).map(([k, v]) => {
                values.push(v);
                return `${column(k)}=$${values.length}`;
              });
              statement = `update ${table} set ${set.join(",")}${where} returning *`;
            }
            if (mode === "upsert") {
              const keys = Object.keys(data).map(column),
                args = Object.values(data);
              values = args;
              statement = `insert into ${table}(${keys}) values(${args.map((_, i) => "$" + (i + 1))}) on conflict(code) do update set ${keys.map((k) => `${k}=excluded.${k}`)} returning *`;
            }
            const r = await sql.query(statement, values);
            if (single && r.rows.length !== 1 && !(maybe && !r.rows.length))
              throw Error("Row not found");
            resolve({ data: single ? r.rows[0] || null : r.rows, error: null });
          } catch (error) {
            if (resolve) resolve({ data: null, error });
            else reject(error);
          }
        },
      };
      return query;
    },
    async rpc(name, args) {
      try {
        if (name !== "warehouse_preparation_mutate")
          throw Error("Unexpected RPC");
        const r = await sql.query(
          `select warehouse_preparation_mutate($1,$2,$3,$4,$5,$6) value`,
          [
            args.p_id,
            args.p_version,
            args.p_event,
            args.p_actor,
            args.p_action,
            args.p_data,
          ],
        );
        return { data: r.rows[0].value, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}
export function mexalFixture() {
  const raw = {
    sigla: "OC",
    cod_modulo: "M",
    serie: 1,
    numero: 900,
    data_documento: "20261030",
    cod_conto: "501.00001",
    nota: [[1, "CONSEGNATO MGZ"]],
    id_magazzino: 5,
    data_ult_mod: "20261030 100000",
    id_riga: [
      [1, 21],
      [2, 22],
      [3, 23],
    ],
    tp_riga: [
      [1, "D"],
      [2, "R"],
      [3, "R"],
    ],
    tipo_stato_riga: [
      [2, "E"],
      [3, "E"],
    ],
    codice_articolo: [
      [2, "IT0001"],
      [3, "IT0002"],
    ],
    descr_riga: [
      [1, "Riga descrittiva"],
      [2, "Primo prodotto"],
      [3, "Secondo prodotto"],
    ],
    quantita: [
      [2, 2],
      [3, 1],
    ],
    tp_um_articolo: [
      [2, "1"],
      [3, "1"],
    ],
    id_mag_riga: [
      [2, 5],
      [3, 5],
    ],
    prezzo: [
      [2, 2.5],
      [3, 4],
    ],
    sconto: [
      [2, ""],
      [3, ""],
    ],
    cod_iva: [
      [2, "22"],
      [3, "22"],
    ],
  };
  const fixture = {
    raw,
    ddt: null,
    sends: 0,
    timeout: false,
    calculations: 0,
    anno: "2026",
    async getJson(path) {
      if (path.startsWith("/documenti/ordini-clienti/"))
        return structuredClone(raw);
      if (path.startsWith("/clienti/"))
        return {
          ragione_sociale: "Cliente prova",
          indirizzo: "Via prova 1",
          localita: "Napoli",
          cap: "80100",
        };
      if (path.startsWith("/articoli/")) {
        const code = decodeURIComponent(path.split("/").at(-1));
        return {
          codice: code,
          descrizione:
            code === "IT0001" ? "Primo prodotto" : "Secondo prodotto",
          unita_misura: "PZ",
          cod_alternativo: code === "IT0001" ? "000001" : "000002",
          cod_tp_lotto: "A",
        };
      }
      if (path.startsWith("/progressivi-articoli"))
        return {
          cod_articolo: [
            [1, "IT0001"],
            [2, "IT0002"],
          ],
          id_magazzino: [
            [1, 5],
            [2, 5],
          ],
          id_lotto: [
            [1, 51],
            [2, 52],
          ],
          qta_inventario: [
            [1, 100],
            [2, 100],
          ],
          qta_carico: [],
          qta_scarico: [],
        };
      if (path.startsWith("/lotti/")) {
        const id = Number(path.split("/").at(-1));
        return {
          id,
          cod_articolo: id === 51 ? "IT0001" : "IT0002",
          stato: "C",
          caricato: "S",
          data_carico: "20260101",
          data_validita: "20271231",
          cod_ute_lotto: "LOT-" + id,
        };
      }
      if (path.startsWith("/documenti/movimenti-magazzino/"))
        return fixture.ddt;
      if (path === "/dati-generali/serie-documenti")
        return { sigla_documento: [[1, "BC"]], serie: [[1, 1]] };
      throw Error("Unexpected GET " + path);
    },
    async calculateDocument() {
      fixture.calculations++;
      return { tot_imponibile: 9, tot_imposta: 1.98 };
    },
    async postJson(path, payload) {
      if (path.startsWith("/documenti/ordini-clienti/ricerca"))
        return { dati: [structuredClone(raw)] };
      if (path.startsWith("/documenti/movimenti-magazzino/ricerca"))
        return { dati: fixture.ddt ? [fixture.ddt] : [] };
      if (path === "/documenti/movimenti-magazzino") {
        fixture.sends++;
        fixture.ddt = { ...structuredClone(payload), numero: 123 };
        if (fixture.timeout) throw Error("Timeout dopo accettazione Mexal");
        return fixture.ddt;
      }
      throw Error("Unexpected POST " + path);
    },
  };
  return fixture;
}
export const event = () => randomUUID();
