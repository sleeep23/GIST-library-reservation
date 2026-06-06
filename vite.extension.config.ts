import react from "@vitejs/plugin-react";
import { copyFile, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDist = path.resolve(dirname, "dist/extension");

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  plugins: [react(), copyExtensionFiles()],
  build: {
    outDir: extensionDist,
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: path.resolve(dirname, "extension/content/index.tsx"),
      formats: ["iife"],
      name: "GistLibraryReservationAssistant"
    },
    rollupOptions: {
      output: {
        assetFileNames: "[name][extname]",
        entryFileNames: "content.js",
        inlineDynamicImports: true
      }
    }
  }
});

function copyExtensionFiles(): Plugin {
  return {
    name: "copy-extension-files",
    async writeBundle() {
      await mkdir(extensionDist, { recursive: true });
      await Promise.all([
        copyFile(
          path.resolve(dirname, "extension/manifest.json"),
          path.resolve(extensionDist, "manifest.json")
        ),
        copyFile(
          path.resolve(dirname, "extension/content/styles.css"),
          path.resolve(extensionDist, "content.css")
        ),
        cp(
          path.resolve(dirname, "extension/icons"),
          path.resolve(extensionDist, "icons"),
          { recursive: true }
        )
      ]);
    }
  };
}
