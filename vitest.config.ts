import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Exercise the reactive TUI runtime, not Solid's nonreactive Node exports.
    alias: [
      {
        find: /^solid-js$/,
        replacement: fileURLToPath(import.meta.resolve("solid-js/dist/solid.js")),
      },
      {
        find: /^solid-js\/store$/,
        replacement: fileURLToPath(
          import.meta.resolve("solid-js/store/dist/store.js"),
        ),
      },
    ],
  },
  test: {
    server: {
      deps: {
        inline: ["solid-js"],
      },
    },
  },
});
