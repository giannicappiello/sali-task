/* eslint-disable react-refresh/only-export-components */
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export function resolveCrmPeriod(preset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "today": return { from: isoDate(today), to: isoDate(today) };
    case "week": {
      const mondayOffset = (today.getDay() + 6) % 7;
      return { from: isoDate(addDays(today, -mondayOffset)), to: isoDate(today) };
    }
    case "month": return { from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today) };
    case "previous_month": return {
      from: isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: isoDate(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
    case "30": return { from: isoDate(addDays(today, -29)), to: isoDate(today) };
    case "year": return { from: isoDate(new Date(today.getFullYear(), 0, 1)), to: isoDate(today) };
    case "previous_year": return {
      from: isoDate(new Date(today.getFullYear() - 1, 0, 1)),
      to: isoDate(new Date(today.getFullYear() - 1, 11, 31)),
    };
    case "90":
    default: return { from: isoDate(addDays(today, -89)), to: isoDate(today) };
  }
}

export function useCrmPeriod() {
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = useMemo(() => resolveCrmPeriod("90"), []);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("from") || "") ? searchParams.get("from") : fallback.from;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("to") || "") ? searchParams.get("to") : fallback.to;
  const preset = searchParams.get("period") || "90";

  const update = useCallback((next) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set("from", next.from);
      params.set("to", next.to);
      params.set("period", next.preset || "custom");
      params.delete("page");
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const withPeriod = useCallback((path, extras = {}) => {
    const params = new URLSearchParams(searchParams);
    params.set("from", from);
    params.set("to", to);
    params.set("period", preset);
    Object.entries(extras).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") params.delete(key);
      else params.set(key, String(value));
    });
    return `${path}?${params.toString()}`;
  }, [from, preset, searchParams, to]);

  return { from, to, preset, update, withPeriod, getParam: (name) => searchParams.get(name) };
}

export default function CrmPeriodFilter({ period, compact = false }) {
  function choose(event) {
    const nextPreset = event.target.value;
    if (nextPreset !== "custom") period.update({ ...resolveCrmPeriod(nextPreset), preset: nextPreset });
    else period.update({ from: period.from, to: period.to, preset: "custom" });
  }
  return <fieldset className={`crm-period-filter${compact ? " compact" : ""}`}>
    <legend>Periodo dati</legend>
    <label>Intervallo
      <select value={period.preset} onChange={choose}>
        <option value="today">Oggi</option><option value="week">Settimana corrente</option>
        <option value="month">Mese corrente</option><option value="previous_month">Mese precedente</option>
        <option value="30">Ultimi 30 giorni</option><option value="90">Ultimi 90 giorni</option>
        <option value="year">Anno corrente</option><option value="previous_year">Anno precedente</option>
        <option value="custom">Personalizzato</option>
      </select>
    </label>
    <label>Dal<input type="date" value={period.from} max={period.to} onChange={(event) => period.update({ from: event.target.value, to: period.to, preset: "custom" })} /></label>
    <label>Al<input type="date" value={period.to} min={period.from} onChange={(event) => period.update({ from: period.from, to: event.target.value, preset: "custom" })} /></label>
  </fieldset>;
}
