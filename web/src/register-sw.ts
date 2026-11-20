// Register the offline service worker in production builds only (in dev it would
// just get in the way of hot reload). See web/public/sw.js.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      // updateViaCache: "none" -> the browser always revalidates sw.js itself,
      // so a deploy's new worker takes over promptly instead of being pinned by
      // HTTP caching.
      .register("/sw.js", { updateViaCache: "none" })
      .catch((err) => console.warn("service worker registration failed", err));
  });
}
