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
  const token = localStorage.getItem("token");
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": token ? `Bearer ${token}` : "",
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

function getRiskEmoji(level) {
  const emojis = {
    CRITICAL: "🚨",
    HIGH: "⚠️",
    MEDIUM: "📊",
    LOW: "✅",
  };
  return emojis[level] || "❓";
}

export default function Dashboard() {
  const [neonates,      setNeonates]      = useState([]);
  const [alertCount,    setAlertCount]    = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [isOffline,     setIsOffline]     = useState(!navigator.onLine);
  const [lastRefresh,   setLastRefresh]   = useState(null);
  const [cacheTime,     setCacheTime]     = useState(null);
  const [stats,         setStats]         = useState({ critical: 0, high: 0, medium: 0, low: 0 });
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

  const calculateStats = useCallback((data) => {
    const critical = data.filter(n => n.risk_level?.toUpperCase() === "CRITICAL").length;
    const high = data.filter(n => n.risk_level?.toUpperCase() === "HIGH").length;
    const medium = data.filter(n => n.risk_level?.toUpperCase() === "MEDIUM").length;
    const low = data.filter(n => n.risk_level?.toUpperCase() === "LOW").length;
    return { critical, high, medium, low };
  }, []);

  const loadData = useCallback(async () => {
    setError(null);

    if (!navigator.onLine) {
      const cached = await cacheRead();
      if (cached) {
        const sorted = [...cached.data].sort(riskSort);
        setNeonates(sorted);
        setStats(calculateStats(sorted));
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
      setStats(calculateStats(sorted));
      setAlertCount(alertData?.count ?? 0);
      setLastRefresh(Date.now());
      setCacheTime(null);
      await cacheWrite(rows);
    } catch (err) {
      console.error("[Dashboard] fetch error:", err);
      const cached = await cacheRead();
      if (cached) {
        const sorted = [...cached.data].sort(riskSort);
        setNeonates(sorted);
        setStats(calculateStats(sorted));
        setCacheTime(cached.savedAt);
        setError("Live data unavailable — showing cached snapshot.");
      } else {
        setError(`Failed to load patients: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [calculateStats]);

  useEffect(() => {
    loadData();
    timerRef.current = setInterval(loadData, REFRESH_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [loadData]);

  const criticalCount = stats.critical;

  return (
    <div className="page">
      <header className="header">
        <div className="header-left">
          <h1 className="page-title">🏥 Active Neonates</h1>
          {lastRefresh && !isOffline && (
            <span className="text-muted">
              Updated {formatTime(new Date(lastRefresh).toISOString())}
            </span>
          )}
          {isOffline && <span className="pill-offline">● Offline Mode</span>}
          {cacheTime && (
            <span className="pill-cache">
              📦 Cached · {formatSavedAt(cacheTime)}
            </span>
          )}
        </div>

        <div className="header-right">
          {criticalCount > 0 && (
            <div className="pill-critical">🚨 {criticalCount} Critical</div>
          )}

          <button
            className="btn-icon"
            onClick={() => window.location.href = "/alerts"}
            aria-label={`${alertCount} pending alerts`}
            title="View pending alerts"
          >
            🔔
            {alertCount > 0 && (
              <span className="badge">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </button>

          <button 
            className="btn-refresh" 
            onClick={loadData} 
            title="Refresh now"
            disabled={loading}
          >
            {loading ? "⏳" : "↺"}
          </button>
        </div>
      </header>

      {/* Stats Summary */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-critical">{stats.critical}</div>
          <div className="stat-label">🚨 Critical</div>
        </div>
        <div className="stat-card">
          <div className="stat-high">{stats.high}</div>
          <div className="stat-label">⚠️ High</div>
        </div>
        <div className="stat-card">
          <div className="stat-medium">{stats.medium}</div>
          <div className="stat-label">📊 Medium</div>
        </div>
        <div className="stat-card">
          <div className="stat-low">{stats.low}</div>
          <div className="stat-label">✅ Low</div>
        </div>
      </div>

      {error && <div className="error-banner fade-in">⚠️ {error}</div>}

      {loading ? (
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Loading patients…</p>
        </div>
      ) : neonates.length === 0 ? (
        <div className="empty">
          <p style={{ fontSize: "48px", marginBottom: "16px" }}>👶</p>
          <p>No active neonates found.</p>
          <p className="text-muted" style={{ marginTop: "8px" }}>
            New admissions will appear here.
          </p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Risk</th>
                <th>Patient</th>
                <th className="text-center">Age</th>
                <th>Location</th>
                <th>Diagnosis</th>
                <th>Last Assessment</th>
                <th>Nurse</th>
              </tr>
            </thead>
            <tbody>
              {neonates.map((n) => {
                const level = n.risk_level?.toUpperCase();
                const isCritical = level === "CRITICAL";
                const isHigh = level === "HIGH";
                const rowClass = isCritical ? "tr-critical" : isHigh ? "tr-high" : "";

                return (
                  <tr 
                    key={n.id ?? n.neonate_id} 
                    className={rowClass}
                    onClick={() => window.location.href = `/neonates/${n.id}`}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <RiskBadge level={level} />
                    </td>
                    <td>
                      <strong>{n.patient_id ?? n.id}</strong>
                      {n.name && <div className="subtext">{n.name}</div>}
                    </td>
                    <td className="text-center">{n.age_days ?? "—"}</td>
                    <td>
                      {n.ward ?? "NICU"}
                      {n.bed_number && <span className="subtext"> · Bed {n.bed_number}</span>}
                    </td>
                    <td>{n.diagnosis ?? "Under observation"}</td>
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
          <div style={{ 
            padding: "12px 16px", 
            borderTop: "1px solid #1e293b",
            color: "#64748b",
            fontSize: "12px",
            display: "flex",
            justifyContent: "space-between"
          }}>
            <span>Showing {neonates.length} active patients</span>
            <span>Auto-refresh every 60s</span>
          </div>
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
  const emoji = getRiskEmoji(level);

  return (
    <span className={badgeClass}>
      {emoji} {label}
    </span>
  );
}