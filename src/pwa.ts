export type PwaStatus =
  | { kind: "ready" }
  | { kind: "offline" }
  | { kind: "update"; worker: ServiceWorker }
  | { kind: "error"; message: string };

const STATUS_EVENT = "melodialect:pwa-status";

function publish(status: PwaStatus): void {
  window.dispatchEvent(new CustomEvent<PwaStatus>(STATUS_EVENT, { detail: status }));
}

export function listenForPwaStatus(listener: (status: PwaStatus) => void): () => void {
  const receive = (event: Event) => listener((event as CustomEvent<PwaStatus>).detail);
  window.addEventListener(STATUS_EVENT, receive);
  return () => window.removeEventListener(STATUS_EVENT, receive);
}

export async function registerPwa(): Promise<void> {
  const reportConnection = () => publish(navigator.onLine ? { kind: "ready" } : { kind: "offline" });
  window.addEventListener("online", reportConnection);
  window.addEventListener("offline", reportConnection);
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) {
    reportConnection();
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(
      `${import.meta.env.BASE_URL}sw.js`,
      { scope: import.meta.env.BASE_URL },
    );
    const offerUpdate = (worker: ServiceWorker | null) => {
      if (worker && navigator.serviceWorker.controller) publish({ kind: "update", worker });
    };
    offerUpdate(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") offerUpdate(worker);
      });
    });
    // GitHub Pages is long-lived; check once at startup and periodically while open.
    try {
      await registration.update();
      reportConnection();
    } catch (error) {
      if (navigator.onLine) {
        publish({
          kind: "error",
          message: error instanceof Error ? error.message : "アプリ更新を確認できませんでした",
        });
      } else {
        reportConnection();
      }
    }
    window.setInterval(() => void registration.update().catch((error: unknown) => {
      if (navigator.onLine) publish({
        kind: "error",
        message: error instanceof Error ? error.message : "アプリ更新を確認できませんでした",
      });
    }), 60 * 60 * 1000);
  } catch (error) {
    publish({
      kind: "error",
      message: error instanceof Error ? error.message : "アプリキャッシュを準備できませんでした",
    });
  }
}

export function activatePwaUpdate(worker: ServiceWorker): void {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  worker.postMessage({ type: "SKIP_WAITING" });
}

/** Only reset the app shell. localStorage projects and IndexedDB/OPFS SoundFonts stay intact. */
export async function repairPwaCache(): Promise<void> {
  const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? [];
  await Promise.all(registrations
    .filter((registration) => registration.scope.startsWith(window.location.origin + import.meta.env.BASE_URL))
    .map((registration) => registration.unregister()));
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name.startsWith("melodialect-app-"))
    .map((name) => caches.delete(name)));
  window.location.reload();
}
