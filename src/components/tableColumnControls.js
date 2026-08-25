const italianCollator = new Intl.Collator("it", {
  numeric: true,
  sensitivity: "base",
});

export function normalizeTableText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("it");
}

function parseItalianDate(value) {
  const match = String(value).trim().match(
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) return null;

  const [, day, month, year, hours = "0", minutes = "0", seconds = "0"] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
  return Number.isNaN(timestamp) ? null : timestamp;
}

function parseItalianNumber(value) {
  const source = String(value)
    .trim()
    .replace(/[€$£%]/g, "")
    .replace(/\s/g, "");

  if (!source || !/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(source)) {
    return null;
  }

  const parsed = Number(source.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function tableComparableValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text === "—" || text === "-") {
    return { type: "empty", value: "" };
  }

  const date = parseItalianDate(text);
  if (date !== null) return { type: "number", value: date };

  const number = parseItalianNumber(text);
  if (number !== null) return { type: "number", value: number };

  return { type: "text", value: text };
}

export function compareTableValues(left, right) {
  const a = tableComparableValue(left);
  const b = tableComparableValue(right);

  if (a.type === "empty" && b.type !== "empty") return 1;
  if (b.type === "empty" && a.type !== "empty") return -1;
  if (a.type === "number" && b.type === "number") return a.value - b.value;
  return italianCollator.compare(String(a.value), String(b.value));
}

export function tableValueMatches(value, query) {
  const normalizedQuery = normalizeTableText(query);
  return !normalizedQuery || normalizeTableText(value).includes(normalizedQuery);
}

export function stableSortTableRows(rows, valueForRow, direction = "asc") {
  const multiplier = direction === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const comparison = compareTableValues(
        valueForRow(left.row),
        valueForRow(right.row),
      );
      return comparison === 0
        ? left.index - right.index
        : comparison * multiplier;
    })
    .map(({ row }) => row);
}

