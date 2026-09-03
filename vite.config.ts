import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "child_process";
import { readFileSync } from "fs";

// Version, Build-Zeitpunkt und Commit landen im Bundle, damit die App im
// "Was ist neu"-Dialog belegen kann, welcher Stand tatsaechlich laeuft.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));
const commitSha = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // Build-Umgebungen ohne Git-Historie (z. B. aus einem Archiv) duerfen nicht scheitern.
    return "unbekannt";
  }
})();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __COMMIT_SHA__: JSON.stringify(commitSha),
  },
  build: {
    target: 'esnext', // Support top-level await for PDF.js
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'], // Exclude PDF.js from pre-bundling
  },
}));
