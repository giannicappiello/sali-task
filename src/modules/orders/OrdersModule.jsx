import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Users } from "lucide-react";
import useOrdersAccess from "./pages/useOrdersAccess";
import OrdersDashboard from "./pages/OrdersDashboard";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Orders from "./pages/Orders";
import NewOrder from "./pages/NewOrder";
import OrderDetail from "./pages/OrderDetail";
import "./orders-module.css";

const items = [
  { to: "/ordini/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ordini/clienti", label: "Clienti", icon: Users },
  { to: "/ordini/elenco", label: "Ordini", icon: ShoppingCart },
];

function parseCurrency(value) {
  const normalized = String(value || "")
    .replace(/[^0-9,.-]/g, "")
    .replaceAll(".", "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function organizeOrderLinesTable() {
  const table = document.querySelector(".orders-order-lines");
  if (!table) return;

  const columns = "minmax(165px,1.45fr) 120px 105px 95px minmax(135px,1fr) 95px 105px 115px 115px 44px";
  const headerCells = [...table.querySelectorAll("thead tr:first-child > th")];
  const headerOrder = [
    [1, 1, "Prodotto"],
    [3, 2, "Quantità"],
    [2, 3, "Disponibile"],
    [4, 4, "Listino"],
    [5, 5, "Sconto commerciale"],
    [6, 6, "Netto"],
    [7, 7, "Imponibile"],
    [8, 8, "IVA"],
    [9, 9, "Totale"],
    [11, 10, ""],
  ];

  if (headerCells.length >= 12) {
    const headerRow = headerCells[0].parentElement;
    headerRow.style.display = "grid";
    headerRow.style.gridTemplateColumns = columns;
    headerRow.style.alignItems = "stretch";
    headerCells.forEach((cell) => { cell.style.display = "none"; });
    headerOrder.forEach(([index, order, label]) => {
      const cell = headerCells[index];
      if (!cell) return;
      cell.style.display = "table-cell";
      cell.style.order = String(order);
      if (cell.textContent !== label) cell.textContent = label;
      cell.style.textAlign = index === 2 || index === 3 ? "center" : "left";
    });
  }

  table.querySelectorAll("tbody > tr:not(.orders-calculation-row)").forEach((row) => {
    const cells = [...row.children];
    if (cells.length < 13) return;

    row.style.display = "grid";
    row.style.gridTemplateColumns = columns;
    row.style.alignItems = "center";
    cells.forEach((cell) => { cell.style.display = "none"; });

    const bodyOrder = [
      [1, 1],
      [3, 2],
      [2, 3],
      [4, 4],
      [6, 5],
      [7, 6],
      [8, 7],
      [9, 8],
      [10, 9],
      [12, 10],
    ];

    bodyOrder.forEach(([index, order]) => {
      const cell = cells[index];
      if (!cell) return;
      cell.style.display = "table-cell";
      cell.style.order = String(order);
      cell.style.textAlign = index === 2 || index === 3 ? "center" : "left";
    });

    const productCategory = cells[1]?.querySelector("small");
    if (productCategory) productCategory.style.display = "none";

    const quantityControl = cells[3]?.querySelector(".orders-quantity-control");
    if (quantityControl) quantityControl.style.justifyContent = "center";

    const quantity = Number(cells[3]?.querySelector("input")?.value || 0);
    const taxable = parseCurrency(cells[8]?.textContent);
    const netUnit = quantity > 0 ? taxable / quantity : 0;
    const netCell = cells[7];
    const expectedNet = formatCurrency(netUnit);
    if (netCell && netCell.textContent !== expectedNet) netCell.textContent = expectedNet;
  });
}

export default function OrdersModule() {
  const { loading, canAccessOrders } = useOrdersAccess();

  useEffect(() => {
    const updateOrdersPresentation = () => {
      document.querySelectorAll(".orders-empty").forEach((element) => {
        if (element.textContent?.trim().toLowerCase() === "caricamento nuovo ordine...") {
          element.textContent = "CARICAMENTO";
        }
      });
      organizeOrderLinesTable();
    };

    updateOrdersPresentation();
    const observer = new MutationObserver(updateOrdersPresentation);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (loading) return <div className="orders-empty">Verifica autorizzazione...</div>;
  if (!canAccessOrders) {
    return <div className="orders-empty">Non sei autorizzato ad accedere alla Gestione Ordini.</div>;
  }

  return (
    <div className="orders-module">
      <style>{`
        .orders-status.bozza { background: #e2e8f0; color: #475569; }
        .orders-status.inviato { background: #dcfce7; color: #166534; }
        .orders-status.errore { background: #fee2e2; color: #991b1b; }
        .orders-order-lines { min-width: 1080px; }
        .orders-order-lines thead tr,
        .orders-order-lines tbody tr:not(.orders-calculation-row) { width: 100%; }
      `}</style>

      <div className="orders-module-header">
        <div>
          <h1>Gestione Ordini</h1>
        </div>
      </div>

      <div className="orders-tabs">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon size={18} />{item.label}
            </NavLink>
          );
        })}
      </div>

      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<OrdersDashboard />} />
        <Route path="clienti" element={<Customers />} />
        <Route path="clienti/:customerCode" element={<CustomerDetail />} />
        <Route path="elenco" element={<Orders />} />
        <Route path="nuovo" element={<NewOrder />} />
        <Route path="modifica/:orderId" element={<NewOrder />} />
        <Route path="elenco/:orderId" element={<OrderDetail />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
