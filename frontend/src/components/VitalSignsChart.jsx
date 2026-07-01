import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const VITALS = [
  { key:"temp",   label:"Temp",   unit:"°C",   color:"#f87171", normal:[36.5,37.5] },
  { key:"hr",     label:"HR",     unit:"bpm",  color:"#38bdf8", normal:[100,160]   },
  { key:"rr",     label:"RR",     unit:"/min", color:"#a78bfa", normal:[30,60]     },
  { key:"spo2",   label:"SpO₂",   unit:"%",    color:"#34d399", normal:[95,100]    },
  { key:"weight", label:"Weight", unit:"g",    color:"#fbbf24", normal:null        },
];

const Tip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">{label}</div>
      <div className="chart-tooltip-value">{payload[0].value} {unit}</div>
    </div>
  );
};

export default function VitalSignsChart({ history = [], activeVital = "hr", onVitalChange }) {
  const vital = VITALS.find(v => v.key === activeVital) ?? VITALS[0];
  const data = history.slice(-6).map(r => ({
    time:  new Date(r.recorded_at ?? r.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
    value: r[vital.key] ?? null,
  }));

  return (
    <div className="chart-wrap">
      <div className="chart-tabs">
        {VITALS.map(v => (
          <button key={v.key}
            className={`chart-tab${activeVital === v.key ? " chart-tab-active" : ""}`}
            onClick={() => onVitalChange?.(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="chart-title">
        {vital.label} <span className="chart-unit">({vital.unit})</span>
        {vital.normal && <span className="chart-normal-range">Normal: {vital.normal[0]}–{vital.normal[1]}</span>}
      </div>
      {!data.some(d => d.value != null) ? (
        <div className="chart-empty">No readings yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{top:8,right:16,left:-10,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)"/>
            <XAxis dataKey="time" tick={{fill:"#64748b",fontSize:11}} tickLine={false} axisLine={false}/>
            <YAxis tick={{fill:"#64748b",fontSize:11}} tickLine={false} axisLine={false}/>
            <Tooltip content={<Tip unit={vital.unit}/>}/>
            {vital.normal && <>
              <ReferenceLine y={vital.normal[0]} stroke="rgba(74,222,128,0.3)" strokeDasharray="4 3"/>
              <ReferenceLine y={vital.normal[1]} stroke="rgba(74,222,128,0.3)" strokeDasharray="4 3"/>
            </>}
            <Line type="monotone" dataKey="value" stroke={vital.color} strokeWidth={2}
              dot={{fill:vital.color,r:4,strokeWidth:0}} activeDot={{r:6,strokeWidth:0}} connectNulls={false}/>
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}