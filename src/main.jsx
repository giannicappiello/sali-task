import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { recoverStaleModule } from "./deployment-recovery.js";

window.addEventListener("vite:preloadError", event => {
  recoverStaleModule(event, window.location, window.sessionStorage);
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
