import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages project site: https://<user>.github.io/vision/
// Override with VITE_BASE_PATH=/ for user/org root pages or local preview.
const base = process.env.VITE_BASE_PATH ?? "/vision/";

export default defineConfig({
  base,
  plugins: [react()],
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  assetsInclude: ["**/*.onnx", "**/*.wasm"],
});
