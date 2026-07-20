// The order UI imports the same pure economic engine from src. Keep this
// server entry point so API code and existing tests share the exact rules.
export * from "../../src/modules/orders/services/orderEconomics.js";
