export default function RiskIndicator({ risk, loading }) {
  if (loading) {
    return (
      <div className="risk-indicator risk-indicator-loading">
        <div className="risk-indicator-spinner" />
        <span>Calculating risk…</span>
      </div>
    );
  }
  if (!risk) return null;

  const level = risk.level?.toUpperCase() ?? "UNKNOWN";

  return (
    <div className={`risk-indicator risk-indicator-${level}`} role="status" aria-live="polite">
      <div className="risk-indicator-top">
        <div className="risk-indicator-label-group">
          <span className="risk-indicator-eyebrow">Risk Assessment</span>
          <span className="risk-indicator-level">{level === "CRITICAL" && "⚠ "}{level}</span>
        </div>
        {risk.score != null && <ScoreRing score={risk.score} level={level} />}
      </div>
      {risk.recommendation && (
        <div className="risk-indicator-rec">
          <span className="risk-indicator-rec-icon">💡</span>
          <p className="risk-indicator-rec-text">{risk.recommendation}</p>
        </div>
      )}
    </div>
  );
}

function ScoreRing({ score, level }) {
  const r = 28, circ = 2 * Math.PI * r;
  const COLOR = { CRITICAL:"#ef4444", HIGH:"#f87171", MEDIUM:"#f59e0b", LOW:"#4ade80" }[level] ?? "#94a3b8";
  return (
    <svg viewBox="0 0 72 72" width="72" height="72">
      <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6"/>
      <circle cx="36" cy="36" r={r} fill="none" stroke={COLOR} strokeWidth="6"
        strokeDasharray={circ} strokeDashoffset={circ - (score/100)*circ}
        strokeLinecap="round" transform="rotate(-90 36 36)"
        style={{transition:"stroke-dashoffset 0.6s ease"}}/>
      <text x="36" y="36" textAnchor="middle" dominantBaseline="central"
        fill="#f1f5f9" fontSize="14" fontWeight="700">{score}</text>
    </svg>
  );
}