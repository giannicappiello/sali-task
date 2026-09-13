import { workbenchRowSearchText } from "../../../pages/Production/rdp-workbench-state.js";

const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it-IT");
const dateText = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${value} ${new Intl.DateTimeFormat("it-IT").format(date)}`;
};
export function privateWorkbenchMatchesSearch(row, search) {
  const haystack = normalize([
    workbenchRowSearchText(row), row.rdpNumber ? `RDP${row.rdpNumber}` : "",
    dateText(row.orderDate), dateText(row.deliveryDate), dateText(row.plannedCompletionDate),
    ...(row.lines || []).flatMap((line) => [line.productionStatus, line.orderedQuantity, line.fulfilledQuantity, line.residualQuantity, line.unit, dateText(line.deliveryDate)]),
  ].join(" "));
  return normalize(search).trim().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}
