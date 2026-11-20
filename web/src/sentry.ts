// Error monitoring. No-op unless VITE_SENTRY_DSN is set at build time — with it
// unset (dev, PR builds) the dynamic import below is dead code and the SDK never
// enters the bundle. When set, it loads in its own chunk just after startup.
//
// Errors only — no tracing, no session replay, no performance (the bundler
// `define` flags in vite.config.ts strip those code paths, keeping the chunk to
// ~30 kB gzip). The filters keep third-party and network noise out of the free
// tier's monthly budget, and beforeSend drops query strings so a typed address
// from the search box never leaves the browser.

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

function stripQuery(url: unknown): unknown {
  if (typeof url !== "string") return url;
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

export function initErrorMonitoring(): void {
  if (!DSN) return;

  const early: unknown[] = [];
  const onError = (e: ErrorEvent) => early.push(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => early.push(e.reason);
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);
  const stopBuffering = () => {
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  };

  void import("@sentry/browser")
    .then(({ init, captureException }) => {
      init({
        dsn: DSN,
        environment: import.meta.env.PROD ? "production" : "development",
        release: import.meta.env.VITE_RELEASE as string | undefined,
        tracesSampleRate: 0,
        sendDefaultPii: false,
        ignoreErrors: [
          "ResizeObserver loop limit exceeded",
          "ResizeObserver loop completed with undelivered notifications.",
          /^Script error\.?$/,
          "Non-Error promise rejection captured",
          /Failed to fetch/i,
          /NetworkError when attempting to fetch/i,
          "Load failed",
          "AbortError",
          // handled in map.ts: a rejected SDFI WMS request returns XML, one
          // decode error, then the layer is dropped and the map falls back to OSM
          "The source image could not be decoded",
        ],
        denyUrls: [
          /^chrome:\/\//i,
          /^chrome-extension:\/\//i,
          /^moz-extension:\/\//i,
          /^safari-web-extension:\/\//i,
          /extensions\//i,
        ],
        beforeSend(event) {
          if (event.request?.url) event.request.url = stripQuery(event.request.url) as string;
          event.breadcrumbs = event.breadcrumbs?.map((b) =>
            b.data?.url ? { ...b, data: { ...b.data, url: stripQuery(b.data.url) } } : b,
          );
          return event;
        },
      });
      stopBuffering();
      for (const err of early) captureException(err);
    })
    .catch(stopBuffering);
}
