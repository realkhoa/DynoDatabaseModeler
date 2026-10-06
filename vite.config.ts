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
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['@monaco-editor/react'],
          'xyflow': ['@xyflow/react'],
          'lucide-react': ['lucide-react'],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});

