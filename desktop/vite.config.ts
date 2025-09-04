import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss()
  ],
  build: {
    outDir: "dist-react",
    target: 'esnext',  // Enable modern features
    minify: 'terser'   // Better minification
  },
  server: {
    port: 5123,
    strictPort: true,
    headers: {
      // Enable COOP/COEP for SharedArrayBuffer and threading
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  },
  define: {
    // Enable WASM threads
    global: 'globalThis'
  }
 })