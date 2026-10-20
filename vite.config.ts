/// <reference types="vitest/config" />
/**
 * @file vite.config.ts
 * @brief Vite and Vitest configuration for DynoDbModeler desktop frontend.
 * @details Configures React plugin, Tailwind CSS Vite plugin, and Happy-DOM testing environment.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    // Monaco and XYFlow are large but intentionally bundled locally (no CDN at runtime), so the
    // default chunk size warning is not actionable.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // Chunk by module path rather than by package entry point: referencing the `monaco-editor`
        // package root would pull in every language contribution (and the 7 MB TypeScript worker)
        // even though only the SQL grammar and the JSON service are imported.
        manualChunks(id: string) {
          if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) {
            return 'monaco-editor';
          }
          if (id.includes('node_modules/@xyflow') || id.includes('node_modules/d3-')) {
            return 'xyflow';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide-react';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});

