import { createContext, useContext } from "react";
const OrdersModuleContext = createContext({ moduleCode: "prof", title: "Ordini PROF", basePath: "/ordini-prof" });
export const OrdersModuleProvider = OrdersModuleContext.Provider;
export const useOrdersModule = () => useContext(OrdersModuleContext);
