import { useEffect } from "react";
import NewOrder from "./NewOrder";
import "../orders-summary.css";

function numberFromText(value) {
  const parsed = Number(String(value || "").replace(/[^0-9,-]/g, "").replace(".", "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPieces(value) {
  return Number(value || 0).toLocaleString("it-IT");
}

function enhanceAvailability(root) {
  const results = root.querySelector(".orders-availability-results");
  if (!results || results.dataset.presentationReady === "true") return;

  const paragraphs = results.querySelectorAll(":scope > p");
  const table = results.querySelector(":scope > table");
  const oldPreview = results.querySelector(":scope > .orders-calculation-detail");
  if (paragraphs.length < 2 || !table || !oldPreview) return;

  const verificationText = paragraphs[0].textContent || "";
  const dateMatch = verificationText.match(/alle\s+(.+?)\s+·\s+Magazzino\s+(.+?)\.?$/i);
  const errorMatch = (paragraphs[1].textContent || "").match(/Errori:\s*([\d.]+)/i);

  let ocm = 0;
  let oci = 0;
  let ocx = 0;
  table.querySelectorAll("tbody tr").forEach((row) => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 5) return;
    const code = (cells[0].textContent || "").split("·")[0].trim().toUpperCase();
    const requested = numberFromText(cells[1].textContent);
    const confirmed = numberFromText(cells[3].textContent);
    const missing = numberFromText(cells[4].textContent);
    if (code.startsWith("IMP")) oci += requested;
    else {
      ocm += confirmed;
      ocx += missing;
    }
  });

  paragraphs.forEach((paragraph) => paragraph.classList.add("orders-summary-original-hidden"));
  oldPreview.classList.add("orders-summary-original-hidden");

  const check = document.createElement("div");
  check.className = "orders-availability-check";
  check.innerHTML = `<strong>✓ Verifica completata</strong><span>${dateMatch?.[1] || "-"}</span><span>Magazzino ${dateMatch?.[2] || "-"}</span><span class="orders-availability-errors">Errori: ${errorMatch?.[1] || "0"}</span>`;
  results.insertBefore(check, table);

  const preview = document.createElement("div");
  preview.className = "orders-document-preview";
  preview.innerHTML = `<div><span>Futuro OCM</span><strong>${formatPieces(ocm)} pezzi</strong></div><div><span>Futuro OCI</span><strong>${formatPieces(oci)} pezzi</strong></div><div><span>Futuro OCX</span><strong>${formatPieces(ocx)} pezzi</strong></div>`;
  results.appendChild(preview);
  results.dataset.presentationReady = "true";
  results.dataset.ocm = String(ocm);
  results.dataset.oci = String(oci);
  results.dataset.ocx = String(ocx);
}

function addSplitSummary(actions, availability) {
  if (!actions || !availability || actions.querySelector(":scope > .orders-split-summary")) return;
  const split = document.createElement("div");
  split.className = "orders-split-summary";
  split.innerHTML = `<strong>L'ordine verrà suddiviso automaticamente in:</strong><span>OCM: ${formatPieces(availability.dataset.ocm)} pezzi (evasione immediata)</span><span>OCI: ${formatPieces(availability.dataset.oci)} pezzi</span><span>OCX: ${formatPieces(availability.dataset.ocx)} pezzi (backorder)</span>`;
  actions.insertBefore(split, actions.firstChild);
}

function enhanceFooter(root) {
  const footer = root.querySelector(".orders-order-footer");
  const actions = footer?.querySelector(":scope > .orders-order-actions");
  const availability = root.querySelector(".orders-availability-results[data-presentation-ready='true']");
  if (!footer || !actions) return;

  if (footer.dataset.presentationReady !== "true") {
    const oldTotal = footer.querySelector(":scope > .orders-order-total");
    if (!oldTotal) return;
    const values = oldTotal.querySelectorAll("span, strong");
    const pieces = values[0]?.textContent || "0 pezzi";
    const economics = values[1]?.textContent || "";
    const total = oldTotal.querySelector("strong")?.textContent || "0,00 €";
    const taxable = economics.match(/Imponibile:\s*(.+?)\s*·/i)?.[1] || "0,00 €";
    const vat = economics.match(/IVA:\s*(.+)$/i)?.[1] || "0,00 €";

    oldTotal.classList.add("orders-summary-original-hidden");
    const summary = document.createElement("div");
    summary.className = "orders-order-total orders-order-total-enhanced";
    summary.innerHTML = `<div><span>Totale ordine</span><strong>${pieces}</strong></div><div><span>Imponibile</span><strong>${taxable}</strong></div><div><span>IVA</span><strong>${vat}</strong></div><div class="orders-order-grand-total"><span>TOTALE</span><strong>${total}</strong></div>`;
    footer.insertBefore(summary, actions);
    footer.dataset.presentationReady = "true";
  }

  addSplitSummary(actions, availability);
}

export default function NewOrderPresentation() {
  useEffect(() => {
    const root = document.querySelector(".orders-new-order-page")?.parentElement;
    if (!root) return undefined;

    const apply = () => {
      enhanceAvailability(root);
      enhanceFooter(root);
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <NewOrder />;
}
