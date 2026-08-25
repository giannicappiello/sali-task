import { useEffect } from "react";
import {
  stableSortTableRows,
  tableValueMatches,
} from "./tableColumnControls";
import "./global-table-column-controls.css";

const tableStates = new WeakMap();

function headerCellsFor(table) {
  const rows = Array.from(table.tHead?.rows || []);
  return rows.length ? Array.from(rows.at(-1).cells) : [];
}

function headerLabel(cell, index) {
  const copy = cell.cloneNode(true);
  copy.querySelectorAll("[data-column-control]").forEach((node) => node.remove());
  return copy.textContent?.replace(/\s+/g, " ").trim() || `Colonna ${index + 1}`;
}

function cellText(row, columnIndex) {
  const cell = row.cells[columnIndex];
  if (!cell) return "";

  const formValues = Array.from(cell.querySelectorAll("input, select, textarea"))
    .map((control) => {
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        return control.checked ? "selezionato sì attivo" : "non selezionato no inattivo";
      }
      if (control instanceof HTMLSelectElement) {
        return control.selectedOptions[0]?.textContent || control.value;
      }
      return control.value;
    })
    .filter(Boolean)
    .join(" ");

  return `${cell.textContent || ""} ${formValues}`.trim();
}

function isDataRow(row, columnCount) {
  return row.cells.length >= columnCount
    && !Array.from(row.cells).some((cell) => cell.colSpan > 1);
}

function syncSortIndicators(state) {
  state.headers.forEach((header, index) => {
    const active = state.sortColumn === index;
    header.setAttribute(
      "aria-sort",
      active ? (state.direction === "asc" ? "ascending" : "descending") : "none",
    );
    const indicator = header.querySelector("[data-sort-indicator]");
    if (indicator) indicator.textContent = active && state.direction === "desc" ? "↓" : "↑";
    const button = header.querySelector("[data-sort-button]");
    if (button) button.classList.toggle("is-active", active);
  });
}

function applyTableState(table, state) {
  const bodies = Array.from(table.tBodies || []);
  if (!bodies.length) return;

  bodies.forEach((body) => {
    const rows = Array.from(body.rows);
    const dataRows = rows.filter((row) => isDataRow(row, state.headers.length));
    const utilityRows = rows.filter((row) => !isDataRow(row, state.headers.length));

    dataRows.forEach((row) => {
      row.hidden = Array.from(state.filters.entries()).some(
        ([columnIndex, query]) => !tableValueMatches(cellText(row, columnIndex), query),
      );
    });
    utilityRows.forEach((row) => { row.hidden = false; });

    if (state.sortColumn === null) return;

    const values = new Map(
      dataRows.map((row) => [row, cellText(row, state.sortColumn)]),
    );
    const sorted = stableSortTableRows(
      dataRows,
      (row) => values.get(row),
      state.direction,
    );
    const desiredRows = [...sorted, ...utilityRows];
    const currentRows = Array.from(body.rows);
    const alreadyOrdered = desiredRows.every((row, index) => row === currentRows[index]);
    if (!alreadyOrdered) desiredRows.forEach((row) => body.append(row));
  });

  syncSortIndicators(state);
}

function addHeaderControls(table, state) {
  state.headers.forEach((header, columnIndex) => {
    const label = headerLabel(header, columnIndex);
    header.classList.add("workspace-table-column-header");

    const controls = document.createElement("span");
    controls.className = "workspace-table-column-controls";
    controls.dataset.columnControl = "true";

    const sortButton = document.createElement("button");
    sortButton.type = "button";
    sortButton.className = "workspace-table-sort-button";
    sortButton.dataset.sortButton = "true";
    sortButton.title = `Ordina ${label}`;
    sortButton.setAttribute("aria-label", `Ordina la colonna ${label}`);
    sortButton.innerHTML = '<span aria-hidden="true" data-sort-indicator>↑</span>';
    sortButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.sortColumn === columnIndex) {
        state.direction = state.direction === "asc" ? "desc" : "asc";
      } else {
        state.sortColumn = columnIndex;
        state.direction = "asc";
      }
      applyTableState(table, state);
    });

    const filter = document.createElement("input");
    filter.type = "search";
    filter.className = "workspace-table-column-filter";
    filter.placeholder = "Filtra";
    filter.autocomplete = "off";
    filter.setAttribute("aria-label", `Filtra la colonna ${label}`);
    filter.title = `Filtra ${label}`;
    filter.addEventListener("click", (event) => event.stopPropagation());
    filter.addEventListener("input", (event) => {
      const query = event.currentTarget.value;
      if (query) state.filters.set(columnIndex, query);
      else state.filters.delete(columnIndex);
      applyTableState(table, state);
    });

    controls.append(sortButton, filter);
    header.append(controls);
  });
  syncSortIndicators(state);
}

function ensureTableControls(table) {
  if (table.closest("[data-column-controls='off']")) return;

  const headers = headerCellsFor(table);
  if (!headers.length || !table.tBodies.length) return;

  let state = tableStates.get(table);
  const controlsAreCurrent = state
    && state.headers.length === headers.length
    && state.headers.every((header, index) => header === headers[index])
    && headers.every((header) => header.querySelector(":scope > [data-column-control]"));

  if (!controlsAreCurrent) {
    table.querySelectorAll("[data-column-control]").forEach((node) => node.remove());
    table.querySelectorAll(".workspace-table-column-header").forEach((header) => {
      header.classList.remove("workspace-table-column-header");
      header.removeAttribute("aria-sort");
    });
    state = {
      direction: state?.direction || "asc",
      filters: state?.filters || new Map(),
      headers,
      sortColumn: state?.sortColumn ?? null,
    };
    if (state.sortColumn !== null && state.sortColumn >= headers.length) {
      state.sortColumn = null;
    }
    tableStates.set(table, state);
    addHeaderControls(table, state);
  }

  table.classList.add("workspace-table-column-enabled");
  applyTableState(table, state);
}

export default function GlobalTableColumnControls() {
  useEffect(() => {
    const enhancedTables = new Set();
    const pendingTables = new Set();
    let scheduledFrame = null;

    const enhance = (tables) => {
      scheduledFrame = null;
      tables.forEach((table) => {
        if (!table.isConnected) return;
        ensureTableControls(table);
        if (table.classList.contains("workspace-table-column-enabled")) {
          enhancedTables.add(table);
        }
      });
    };

    const flushPendingTables = () => {
      const tables = Array.from(pendingTables);
      pendingTables.clear();
      enhance(tables);
    };

    const scheduleTables = (tables) => {
      tables.forEach((table) => pendingTables.add(table));
      if (scheduledFrame === null) {
        scheduledFrame = window.requestAnimationFrame(flushPendingTables);
      }
    };

    const observer = new MutationObserver((mutations) => {
      const changedTables = new Set();
      mutations.forEach((mutation) => {
        const containingTable = mutation.target instanceof Element
          ? mutation.target.closest("table")
          : null;
        if (containingTable) changedTables.add(containingTable);

        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches("table")) changedTables.add(node);
          node.querySelectorAll("table").forEach((table) => changedTables.add(table));
        });
      });
      if (changedTables.size) scheduleTables(changedTables);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    enhance(Array.from(document.querySelectorAll("table")));

    return () => {
      observer.disconnect();
      if (scheduledFrame !== null) window.cancelAnimationFrame(scheduledFrame);
      enhancedTables.forEach((table) => {
        table.querySelectorAll("[data-column-control]").forEach((node) => node.remove());
        table.querySelectorAll(".workspace-table-column-header").forEach((header) => {
          header.classList.remove("workspace-table-column-header");
          header.removeAttribute("aria-sort");
        });
        table.classList.remove("workspace-table-column-enabled");
      });
    };
  }, []);

  return null;
}

