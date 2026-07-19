import { useEffect, useRef, useState } from "react";
import { runMexalEventAutomation } from "../services/mexalEventAutomation";

/** Runs once for the lifetime of the Orders module mount, not for sub-routes. */
export default function useOrdersModuleAutomation({ ready, enabled }) {
  const started = useRef(false);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!ready || !enabled || started.current) return;
    started.current = true;
    setStatus("running");
    runMexalEventAutomation("orders_module_open")
      .then((result) => setStatus(result.failed ? "warning" : "completed"))
      .catch(() => setStatus("warning"));
  }, [ready, enabled]);

  return status;
}
