import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({ plugins: [react(), VitePWA({ registerType: 'prompt', injectRegister: 'auto', includeAssets: ['logo.png', 'catalog-logo.png', 'catalog-hero.webp'], manifest: { id: '/', name: 'Sali di Ischia Club', short_name: 'Sali Club', description: 'Fidelity e cashback Sali di Ischia', lang: 'it', theme_color: '#8d9081', background_color: '#faf9f5', display: 'standalone', start_url: '/', scope: '/', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }, workbox: { globPatterns: ['**/*.{js,css,html,png,webp,woff2}'], navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api/], cleanupOutdatedCaches: true, runtimeCaching: [] } })] });
