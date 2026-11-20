import { defineConfig } from "vite";

// Same build setup as Svampekortet (0024b43), minus the Sentry source-map upload
// plugin -- add it back when this app gets its own Sentry project.
export default defineConfig({
  server: { port: 5174 },
  define: {
    __SENTRY_DEBUG__: "false",
    __SENTRY_TRACING__: "false",
    __RRWEB_EXCLUDE_IFRAME__: "true",
    __RRWEB_EXCLUDE_SHADOW_DOM__: "true",
    __SENTRY_EXCLUDE_REPLAY_WORKER__: "true",
  },
  build: {
    target: "es2020",
    rollupOptions: {
      // MapLibre is ~90% of the JS weight; its own chunk stays cached across
      // app-only deploys.
      output: { manualChunks: { maplibre: ["maplibre-gl"] } },
    },
    chunkSizeWarningLimit: 850,
  },
});
