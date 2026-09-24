import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "pwa-192x192.png", "pwa-512x512.png", "pwa-maskable-512x512.png"],
      manifest: {
        name: "Progre Workspace",
        short_name: "Progre",
        description: "App gestione task, progetti e prodotti Progre",
        theme_color: "#126bff",
        background_color: "#f6f8fc",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        // Rotate the precache so clients discard entries containing HTML instead of JS.
        // Bump this whenever the application shell changes so a previously published
        // service worker cannot keep serving the prior HR route bundle.
        cacheId: "workspace-assets-v3",
        navigateFallbackDenylist: [/^\/api\//, /^\/assets\//],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        importScripts: ["/push-handler.js"]
      },
      devOptions: {
        enabled: false
      }
    })
  ]
});
