import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist-react",
    target: "esnext", // Enable modern features
    minify: "terser", // Better minification
    sourcemap: false, // Disable sourcemaps for smaller bundles
    assetsInlineLimit: 0, // Don't inline fonts
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large dependencies into separate chunks for better caching
          vendor: ["react", "react-dom"],
          ui: ["@fortawesome/fontawesome-free"],
        },
        assetFileNames: (assetInfo) => {
          // Keep fonts in their original structure
          if (
            assetInfo.name &&
            (assetInfo.name.endsWith(".ttf") ||
              assetInfo.name.endsWith(".woff2") ||
              assetInfo.name.endsWith(".woff"))
          ) {
            return "fonts/[name][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    headers: {
      // Enable COOP/COEP for SharedArrayBuffer and threading
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  define: {
    // Enable WASM threads
    global: "globalThis",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
