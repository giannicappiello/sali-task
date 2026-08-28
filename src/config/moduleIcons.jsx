import {
  BarChart3,
  Bell,
  Blocks,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  Factory,
  FileArchive,
  HeartHandshake,
  Home,
  MessageCircle,
  Package,
  PlugZap,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Users,
  Workflow,
  Warehouse,
} from "lucide-react";

export const MODULE_ICON_OPTIONS = Object.freeze([
  { code: "blocks", label: "Moduli", Icon: Blocks },
  { code: "shopping-cart", label: "Carrello", Icon: ShoppingCart },
  { code: "shopping-bag", label: "Borsa acquisti", Icon: ShoppingBag },
  { code: "package", label: "Prodotti", keywords: ["prodotto", "articolo", "catalogo", "merce"], Icon: Package },
  { code: "warehouse", label: "Magazzino", keywords: ["giacenza", "disponibilità", "scorta", "costo"], Icon: Warehouse },
  { code: "store", label: "Negozio", Icon: Store },
  { code: "briefcase", label: "Valigetta", Icon: BriefcaseBusiness },
  { code: "users", label: "Team", Icon: Users },
  { code: "factory", label: "Produzione", keywords: ["prodotto", "fabbrica", "lavorazione"], Icon: Factory },
  { code: "workflow", label: "Processo", Icon: Workflow },
  { code: "chart", label: "Analisi", Icon: BarChart3 },
  { code: "clipboard", label: "Attività", Icon: ClipboardList },
  { code: "calendar", label: "Calendario", Icon: CalendarDays },
  { code: "file-archive", label: "Documenti", Icon: FileArchive },
  { code: "message", label: "Messaggi", Icon: MessageCircle },
  { code: "bell", label: "Notifiche", Icon: Bell },
  { code: "bot", label: "Assistente AI", Icon: Bot },
  { code: "settings", label: "Impostazioni", Icon: Settings },
  { code: "plug", label: "Integrazioni", Icon: PlugZap },
  { code: "truck", label: "Spedizioni", Icon: Truck },
  { code: "handshake", label: "Collaborazione", Icon: HeartHandshake },
  { code: "sparkles", label: "Novità", Icon: Sparkles },
  { code: "home", label: "Home", Icon: Home },
]);

const MODULE_ICONS = new Map(MODULE_ICON_OPTIONS.map((option) => [option.code, option.Icon]));

export function getModuleIcon(code, fallback = Blocks) {
  return MODULE_ICONS.get(String(code || "").trim()) || fallback;
}
