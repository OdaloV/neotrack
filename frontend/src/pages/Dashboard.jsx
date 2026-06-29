
import { useState, useEffect, useCallback, useRef } from "react";
import "../styles/global.css";

const API_BASE = "/api";
const NEONATES_ENDPOINT = `${API_BASE}/v_high_risk_neonates`;
const ALERTS_ENDPOINT   = `${API_BASE}/alerts/pending/count`;
const REFRESH_INTERVAL  = 60_000;
const IDB_DB_NAME       = "nicu_cache";
const IDB_STORE         = "neonates";
const IDB_KEY           = "dashboard_snapshot";

const RISK_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const RISK_LABEL = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

function riskSort(a, b) {
  const aRank = RISK_ORDER[a.risk_level?.toUpperCase()] ?? 99;
  const bRank = RISK_ORDER[b.risk_level?.toUpperCase()] ?? 99;
  return aRank - bRank;
}

async function apiFetch(url) {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess  = (e) => resolve(e.target.result);
    req.onerror    = (e) => reject(e.target.error);
  });
}

async function cacheWrite(data) {
  try {
    const db = await openDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put({ data, savedAt: Date.now() }, IDB_KEY);
  } catch (err) {
    console.warn("[cache] write failed:", err);
  }
}

async function cacheRead() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = db
        .transaction(IDB_STORE, "readonly")
        .objectStore(IDB_STORE)
        .get(IDB_KEY);
      req.onsuccess = (e) => resolve(e.target.result ?? null);
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch {
    return null;
  }
}

function formatTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d)) return "—";
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60_000);
  if (diffMin < 1)  return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH  < 24)  return `${diffH}h ago`;
  return d.toLocaleDateString();
}

function formatSavedAt(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Dashboard() {
  const [neonates,      setNeonates]      = useState([]);
  const [alertCount,    setAlertCount]    = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [isOffline,     setIsOffline]     = useState(!navigator.onLine);
  const [lastRefresh,   setLastRefresh]   = useState(null);
  const [cacheTime,     setCacheTime]     = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const goOnline  = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const loadData = useCallback(async () => {
    setError(null);

    if (!navigator.onLine) {
      const cached = await cacheRead();
      if (cached) {
        setNeonates([...cached.data].sort(riskSort));
        setCacheTime(cached.savedAt);
      } else {
        setError("You are offline and no cached data is available.");
      }
      setLoading(false);
      return;
    }

    try {
      const [rows, alertData] = await Promise.all([
        apiFetch(NEONATES_ENDPOINT),
        apiFetch(ALERTS_ENDPOINT).catch(() => ({ count: 0 })),
      ]);

      const sorted = [...rows].sort(riskSort);
      setNeonates(sorted);
      setAlertCount(alertData?.count ?? 0);
      setLastRefresh(Date.now());
      setCacheTime(null);
      await cacheWrite(rows);
    } catch (err) {
      console.error("[Dashboard] fetch error:", err);
      const cached = await cacheRead();
      if (cached) {
        setNeonates([...cached.data].sort(riskSort));
        setCacheTime(cached.savedAt);
        setError("Live data unavailable — showing cached snapshot.");
      } else {
        setError(`Failed to load patients: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    timerRef.current = setInterval(loadData, REFRESH_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [loadData]);

  const criticalCount = neonates.filter(
    (n) => n.risk_level?.toUpperCase() === "CRITICAL"
  ).length;

  return (
    <div className="page">
      <header className="header">
        <div className="header-left">
          <h1 className="page-title">Active Neonates</h1>
          {lastRefresh && !isOffline && (
            <span className="text-muted">
              Updated {formatTime(new Date(lastRefresh).toISOString())}
            </span>
          )}
          {isOffline && <span className="pill-offline">● Offline</span>}
          {cacheTime && (
            <span className="pill-cache">
              Cached snapshot · {formatSavedAt(cacheTime)}
            </span>
          )}
        </div>

        <div className="header-right">
          {criticalCount > 0 && (
            <div className="pill-critical">⚠ {criticalCount} Critical</div>
          )}

          <button
            className="btn-icon"
            onClick={() => {}}
            aria-label={`${alertCount} pending alerts`}
          >
            🔔
            {alertCount > 0 && (
              <span className="badge">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </button>

          <button className="btn-refresh" onClick={loadData} title="Refresh now">
            ↺
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading">Loading patients…</div>
      ) : neonates.length === 0 ? (
        <div className="empty">No active neonates found.</div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Risk</th>
                <th>ID / Name</th>
                <th>Age (days)</th>
                <th>Ward / Bed</th>
                <th>Diagnosis</th>
                <th>Last Assessment</th>
                <th>Assigned Nurse</th>
              </tr>
            </thead>
            <tbody>
              {neonates.map((n) => {
                const level = n.risk_level?.toUpperCase();
                const isCritical = level === "CRITICAL";
                const isHigh = level === "HIGH";
                const rowClass = isCritical ? "tr-critical" : isHigh ? "tr-high" : "";

                return (
                  <tr key={n.id ?? n.neonate_id} className={rowClass}>
                    <td>
                      <RiskBadge level={level} />
                    </td>
                    <td>
                      <strong>{n.patient_id ?? n.id}</strong>
                      {n.name && <div className="subtext">{n.name}</div>}
                    </td>
                    <td className="text-center">{n.age_days ?? "—"}</td>
                    <td>
                      {n.ward ?? "—"}
                      {n.bed_number && <span className="subtext"> · Bed {n.bed_number}</span>}
                    </td>
                    <td>{n.diagnosis ?? "—"}</td>
                    <td>
                      <span
                        className={isCritical || isHigh ? "text-critical" : "text-muted"}
                        title={n.last_assessment_time}
                      >
                        {formatTime(n.last_assessment_time)}
                      </span>
                    </td>
                    <td>{n.assigned_nurse ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RiskBadge({ level }) {
  const badgeClass = {
    CRITICAL: "risk-critical",
    HIGH: "risk-high",
    MEDIUM: "risk-medium",
    LOW: "risk-low",
  }[level] ?? "risk-unknown";

  const label = RISK_LABEL[level] ?? level ?? "Unknown";
  const isCritical = level === "CRITICAL";

  return (
    <span className={badgeClass}>
      {isCritical && "⚠ "}
      {label}
    </span>
  );
}