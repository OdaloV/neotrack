import { registerSyncListener } from "./services/syncService";


registerSyncListener();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/src/sw/serviceWorker.js")
      .then((reg) => console.log("[sw] registered:", reg.scope))
      .catch((err) => console.warn("[sw] registration failed:", err));
  });
}