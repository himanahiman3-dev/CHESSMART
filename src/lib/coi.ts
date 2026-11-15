/**
 * Страховка для SharedArrayBuffer: если сервер не отдал COOP/COEP, регистрируем
 * coi-serviceworker, который добавит заголовки на клиенте, и один раз перезагружаем страницу.
 */
export async function registerCoiServiceWorker(): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    if (window.crossOriginIsolated) return; // сервер уже всё отдаёт
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    if (window.self !== window.top) return; // в iframe изоляция невозможна
    const url = new URL("coi-serviceworker.js", document.baseURI).href;
    // файл мог не попасть на хостинг (например, отдаётся только index.html)
    const probe = await fetch(url, { method: "GET", cache: "no-store" });
    const ct = probe.headers.get("content-type") || "";
    if (!probe.ok || !/javascript|ecmascript/.test(ct)) return;

    const reg = await navigator.serviceWorker.register(url);
    const reloadKey = "coi-reloaded";
    const reloadOnce = () => {
      if (window.crossOriginIsolated) return;
      if (sessionStorage.getItem(reloadKey)) return;
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    };
    if (reg.active && !navigator.serviceWorker.controller) {
      reloadOnce();
    } else if (!reg.active) {
      const sw = reg.installing || reg.waiting;
      sw?.addEventListener("statechange", () => {
        if (sw.state === "activated") reloadOnce();
      });
    }
  } catch (e) {
    console.warn("coi-serviceworker не зарегистрирован:", e);
  }
}
