// A minimal service worker — just enough for Chrome to consider this site a
// real installable PWA (uses the manifest icon properly) rather than falling
// back to a generic bookmark shortcut. It doesn't cache anything.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
