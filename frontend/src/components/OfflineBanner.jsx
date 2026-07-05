import { useState, useEffect, useCallback } from "react";
import { getPendingCount, syncAll } from "../services/syncService";

export default function OfflineBanner() {
  const [isOffline,    setIsOffline]    = useState(!navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing,      setSyncing]      = useState(false);
  const [lastSynced,   setLastSynced]   = useState(null);

  const refreshCount = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  useEffect(() => {
    refreshCount();

    const goOnline = async () => {
      setIsOffline(false);
      setSyncing(true);
      await syncAll();
      setSyncing(false);
      setLastSynced(Date.now());
      refreshCount();
    };

    const goOffline = () => {
      setIsOffline(true);
      refreshCount();
    };

    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refreshCount]);

  // Poll pending count every 5s so badge stays fresh as user submits forms
  useEffect(() => {
    const t = setInterval(refreshCount, 5000);
    return () => clearInterval(t);
  }, [refreshCount]);

  if (!isOffline && pendingCount === 0 && !syncing) return null;

  return (
    <div className={`offline-banner ${isOffline ? "offline-banner-offline" : "offline-banner-syncing"}`}>
      <span className="offline-banner-icon">
        {isOffline ? "📡" : syncing ? "🔄" : "✓"}
      </span>

      <span className="offline-banner-text">
        {isOffline && pendingCount === 0 && "You are offline. New entries will be queued."}
        {isOffline && pendingCount > 0  && `Offline — ${pendingCount} item${pendingCount !== 1 ? "s" : ""} queued`}
        {!isOffline && syncing          && "Syncing queued items…"}
        {!isOffline && !syncing && pendingCount > 0 &&
          `${pendingCount} item${pendingCount !== 1 ? "s" : ""} pending sync`}
      </span>

      {!isOffline && !syncing && pendingCount > 0 && (
        <button
          className="offline-banner-btn"
          onClick={async () => {
            setSyncing(true);
            await syncAll();
            setSyncing(false);
            setLastSynced(Date.now());
            refreshCount();
          }}
        >
          Sync now
        </button>
      )}

      {lastSynced && !isOffline && !syncing && pendingCount === 0 && (
        <span className="offline-banner-synced">
          ✓ Synced {new Date(lastSynced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}