import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

function getToken() { return localStorage.getItem("nicu_token") ?? ""; }

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diff < 1)  return "just now";
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24)    return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

const URGENCY_ORDER = { IMMEDIATE: 0, URGENT: 1, ROUTINE: 2 };

function sortAlerts(alerts) {
  return [...alerts].sort((a, b) => {
    // Resolved always at bottom
    const aResolved = a.status === "RESOLVED" ? 1 : 0;
    const bResolved = b.status === "RESOLVED" ? 1 : 0;
    if (aResolved !== bResolved) return aResolved - bResolved;
    // Then by urgency
    const uDiff = (URGENCY_ORDER[a.urgency] ?? 99) - (URGENCY_ORDER[b.urgency] ?? 99);
    if (uDiff !== 0) return uDiff;
    // Then by created_at descending
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

export default function AlertsList() {
  const [alerts,        setAlerts]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [escalateId,    setEscalateId]    = useState(null);
  const [escalateReason,setEscalateReason]= useState("");
  const [noteValues,    setNoteValues]    = useState({});
  const [actionLoading, setActionLoading] = useState({});

  const load = useCallback(async () => {
    try {
      const data = await apiFetch("/alerts");
      setAlerts(sortAlerts(data));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function acknowledge(id) {
    setActionLoading((p) => ({ ...p, [id]: "ack" }));
    try {
      await apiFetch(`/alerts/${id}/acknowledge`, {
        method: "PATCH",
        body: JSON.stringify({ notes: noteValues[id] ?? "" }),
      });
      await load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setActionLoading((p) => ({ ...p, [id]: null }));
    }
  }

  async function escalate(id) {
    if (!escalateReason.trim()) return;
    setActionLoading((p) => ({ ...p, [id]: "esc" }));
    try {
      await apiFetch(`/alerts/${id}/escalate`, {
        method: "PATCH",
        body: JSON.stringify({ reason: escalateReason }),
      });
      setEscalateId(null);
      setEscalateReason("");
      await load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setActionLoading((p) => ({ ...p, [id]: null }));
    }
  }

  async function resolve(id) {
    setActionLoading((p) => ({ ...p, [id]: "res" }));
    try {
      await apiFetch(`/alerts/${id}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({ notes: noteValues[id] ?? "" }),
      });
      await load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setActionLoading((p) => ({ ...p, [id]: null }));
    }
  }

  const pending = alerts.filter((a) => a.status !== "RESOLVED").length;

  if (loading) return <div className="alerts-loading">Loading alerts…</div>;

  return (
    <div className="alerts-page">
      <div className="alerts-header">
        <div>
          <h1 className="alerts-title">
            Alerts
            {pending > 0 && <span className="alerts-badge">{pending}</span>}
          </h1>
          <p className="alerts-subtitle">Sorted by urgency — auto-refreshes every 30s</p>
        </div>
        <button className="alerts-refresh-btn" onClick={load}>↺ Refresh</button>
      </div>

      {error && <div className="alerts-error">{error}</div>}

      {alerts.length === 0 ? (
        <div className="alerts-empty">No alerts at this time.</div>
      ) : (
        <div className="alerts-list">
          {alerts.map((alert) => {
            const isCritical  = alert.risk_level === "CRITICAL";
            const isImmediate = alert.urgency    === "IMMEDIATE";
            const isResolved  = alert.status     === "RESOLVED";
            const isEscalated = alert.status     === "ESCALATED";
            const busy        = actionLoading[alert.id];

            return (
              <div
                key={alert.id}
                className={[
                  "alert-card",
                  isCritical  ? "alert-card-critical"  : "",
                  isImmediate ? "alert-card-immediate"  : "",
                  isResolved  ? "alert-card-resolved"   : "",
                  isEscalated ? "alert-card-escalated"  : "",
                ].join(" ")}
              >
                {/* Card header */}
                <div className="alert-card-header">
                  <div className="alert-card-left">
                    <span className={`alert-urgency-badge alert-urgency-${alert.urgency}`}>
                      {isImmediate && "⚠ "}{alert.urgency}
                    </span>
                    <span className={`alert-status-badge alert-status-${alert.status}`}>
                      {alert.status}
                    </span>
                  </div>
                  <span className="alert-time">{timeAgo(alert.created_at)}</span>
                </div>

                {/* Patient info */}
                <div className="alert-card-body">
                  <div className="alert-patient">
                    <strong>{alert.admission_number}</strong>
                    <span className="alert-patient-name">
                      {alert.mother_first_name} {alert.mother_last_name} baby
                    </span>
                    <span className="alert-facility">{alert.facility_name}</span>
                  </div>

                  {/* Risk */}
                  <div className="alert-risk-row">
                    <span className={`alert-risk-level alert-risk-${alert.risk_level}`}>
                      {alert.risk_level}
                    </span>
                    {alert.risk_score != null && (
                      <span className="alert-risk-score">
                        Score: {Math.round(alert.risk_score * 100)}
                      </span>
                    )}
                  </div>

                  {/* Reasons */}
                  {alert.reasons?.length > 0 && (
                    <ul className="alert-reasons">
                      {alert.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}

                  {/* Recommendation */}
                  {alert.recommended_intervention && (
                    <div className="alert-recommendation">
                      💡 {alert.recommended_intervention}
                    </div>
                  )}

                  {/* Escalation info */}
                  {isEscalated && alert.escalation_reason && (
                    <div className="alert-escalation-info">
                      Escalated: {alert.escalation_reason}
                    </div>
                  )}
                </div>

                {/* Actions — hide for resolved */}
                {!isResolved && (
                  <div className="alert-card-footer">
                    <textarea
                      className="alert-notes"
                      placeholder="Resolution notes (optional)…"
                      rows={2}
                      value={noteValues[alert.id] ?? ""}
                      onChange={(e) =>
                        setNoteValues((p) => ({ ...p, [alert.id]: e.target.value }))
                      }
                    />
                    <div className="alert-actions">
                      <button
                        className="alert-btn alert-btn-ack"
                        disabled={!!busy}
                        onClick={() => acknowledge(alert.id)}
                      >
                        {busy === "ack" ? "…" : "✓ Acknowledge"}
                      </button>

                      <button
                        className="alert-btn alert-btn-esc"
                        disabled={!!busy}
                        onClick={() => setEscalateId(alert.id)}
                      >
                        ↑ Escalate
                      </button>

                      <button
                        className="alert-btn alert-btn-res"
                        disabled={!!busy}
                        onClick={() => resolve(alert.id)}
                      >
                        {busy === "res" ? "…" : "Resolve"}
                      </button>
                    </div>
                  </div>
                )}

                {isResolved && (
                  <div className="alert-resolved-stamp">
                    ✓ Resolved {timeAgo(alert.resolved_at)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Escalate modal */}
      {escalateId && (
        <div className="alert-modal-overlay" onClick={() => setEscalateId(null)}>
          <div className="alert-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="alert-modal-title">Escalate Alert</h2>
            <p className="alert-modal-subtitle">Provide a reason for escalation.</p>
            <textarea
              className="alert-modal-textarea"
              rows={4}
              placeholder="Reason for escalation…"
              value={escalateReason}
              onChange={(e) => setEscalateReason(e.target.value)}
              autoFocus
            />
            <div className="alert-modal-actions">
              <button
                className="alert-btn alert-btn-esc"
                disabled={!escalateReason.trim() || !!actionLoading[escalateId]}
                onClick={() => escalate(escalateId)}
              >
                {actionLoading[escalateId] === "esc" ? "Escalating…" : "Confirm Escalate"}
              </button>
              <button
                className="alert-btn alert-btn-cancel"
                onClick={() => { setEscalateId(null); setEscalateReason(""); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}