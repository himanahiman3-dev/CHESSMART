/*
 * coi-serviceworker — страховка для хостингов, которые не отдают COOP/COEP.
 * Service Worker добавляет заголовки на стороне клиента, благодаря чему
 * страница становится cross-origin isolated и SharedArrayBuffer работает.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (ev) => {
  if (ev.data && ev.data.type === "deregister") {
    self.registration
      .unregister()
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((client) => client.navigate(client.url)));
  }
});

self.addEventListener("fetch", function (event) {
  const r = event.request;
  if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;

  event.respondWith(
    fetch(r)
      .then((response) => {
        // opaque-ответы изменить нельзя
        if (response.status === 0) return response;
        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        headers.set("Cross-Origin-Resource-Policy", "cross-origin");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
      .catch((e) => {
        console.error(e);
        return Promise.reject(e);
      })
  );
});
