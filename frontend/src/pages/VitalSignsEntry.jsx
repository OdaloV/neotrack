import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import RiskIndicator from "../components/RiskIndicator";
import VitalSignsChart from "../components/VitalSignsChart";


const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

const VITAL_FIELDS = [
  { key:"temp",   label:"Temperature", unit:"°C",  step:"0.1", min:30,  max:42,  placeholder:"36.5–37.5" },
  { key:"hr",     label:"Heart Rate",  unit:"bpm", step:"1",   min:60,  max:250, placeholder:"100–160"   },
  { key:"rr",     label:"Resp. Rate",  unit:"/min",step:"1",   min:10,  max:100, placeholder:"30–60"     },
  { key:"spo2",   label:"SpO₂",        unit:"%",   step:"0.1", min:50,  max:100, placeholder:"≥95"       },
  { key:"weight", label:"Weight",      unit:"g",   step:"1",   min:400, max:8000,placeholder:"grams"     },
];

const FEEDING_OPTIONS = [
  { value:"breastfed",    label:"Breastfed"    },
  { value:"formula",      label:"Formula"      },
  { value:"ng_tube",      label:"NG Tube"      },
  { value:"tpn",          label:"TPN / IV"     },
  { value:"nil_by_mouth", label:"Nil by Mouth" },
];

const SYMPTOM_FLAGS = [
  { key:"seizure",              label:"Seizure activity"     },
  { key:"apnea",                label:"Apnea episode"        },
  { key:"bradycardia",          label:"Bradycardia"          },
  { key:"cyanosis",             label:"Cyanosis"             },
  { key:"poor_tone",            label:"Poor muscle tone"     },
  { key:"bulging_fontanelle",   label:"Bulging fontanelle"   },
  { key:"jaundice",             label:"Jaundice"             },
  { key:"abdominal_distension", label:"Abdominal distension" },
];


const DB_NAME = "nicu_cache";
const QUEUE   = "submit_queue";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots");
      if (!db.objectStoreNames.contains(QUEUE))       db.createObjectStore(QUEUE, { autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function enqueue(neonateId, payload) {
  const db = await openDB();
  db.transaction(QUEUE, "readwrite").objectStore(QUEUE).add({ neonateId, payload, queuedAt: Date.now() });
}

async function readQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const items = [];
    const req = db.transaction(QUEUE, "readonly").objectStore(QUEUE).openCursor();
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (c) { items.push({ idbKey: c.key, ...c.value }); c.continue(); }
      else resolve(items);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dequeue(idbKey) {
  const db = await openDB();
  db.transaction(QUEUE, "readwrite").objectStore(QUEUE).delete(idbKey);
}


function getToken() { return localStorage.getItem("nicu_token") ?? ""; }

async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const fetchNeonate      = (id)         => apiFetch(`/neonates/${id}`);
const fetchVitalHistory = (id)         => apiFetch(`/neonates/${id}/vitals?limit=6`);
const postVitals        = (id, body)   => apiFetch(`/neonates/${id}/vitals`, { method: "POST", body: JSON.stringify(body) });


function calcRisk(values, symptoms) {
  let score = 0;
  const flags = [];
  const { temp, hr, rr, spo2 } = values;

  if (temp != null) {
    if (temp < 36 || temp > 38)        { score += 25; flags.push("abnormal temp"); }
    else if (temp < 36.5 || temp > 37.5) score += 10;
  }
  if (hr != null) {
    if (hr < 80 || hr > 200)           { score += 25; flags.push("abnormal HR"); }
    else if (hr < 100 || hr > 160)       score += 10;
  }
  if (rr != null) {
    if (rr < 20 || rr > 80)            { score += 20; flags.push("abnormal RR"); }
    else if (rr < 30 || rr > 60)         score += 8;
  }
  if (spo2 != null) {
    if (spo2 < 90)                      { score += 30; flags.push("critical SpO₂"); }
    else if (spo2 < 95)                   score += 15;
  }

  SYMPTOM_FLAGS.filter(s => symptoms[s.key])
    .forEach(s => { score += 12; flags.push(s.label.toLowerCase()); });

  score = Math.min(score, 100);

  let level, recommendation;
  if (score >= 70) {
    level = "CRITICAL";
    recommendation = `Immediate escalation required. Concerns: ${flags.slice(0,3).join(", ")}. Alert attending physician now.`;
  } else if (score >= 45) {
    level = "HIGH";
    recommendation = `Close monitoring needed. Concerns: ${flags.slice(0,3).join(", ")}. Notify senior nurse, reassess in 30 min.`;
  } else if (score >= 20) {
    level = "MEDIUM";
    recommendation = flags.length
      ? `Monitor closely. Note: ${flags.join(", ")}. Reassess in 1 hour.`
      : "Stable but monitor. Reassess in 1 hour.";
  } else {
    level = "LOW";
    recommendation = "Vitals within acceptable range. Routine monitoring every 2–4 hours.";
  }

  return { level, score, recommendation };
}



const EMPTY_VALUES   = { temp:"", hr:"", rr:"", spo2:"", weight:"" };
const EMPTY_SYMPTOMS = Object.fromEntries(SYMPTOM_FLAGS.map(s => [s.key, false]));

export default function VitalSignsEntry() {
  const { neonateId } = useParams();

  const [neonate,     setNeonate]     = useState(null);
  const [values,      setValues]      = useState(EMPTY_VALUES);
  const [feeding,     setFeeding]     = useState("");
  const [symptoms,    setSymptoms]    = useState(EMPTY_SYMPTOMS);
  const [notes,       setNotes]       = useState("");
  const [risk,        setRisk]        = useState(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [history,     setHistory]     = useState([]);
  const [activeVital, setActiveVital] = useState("hr");
  const [submitting,  setSubmitting]  = useState(false);
  const [status,      setStatus]      = useState(null); // "success"|"queued"|"error"
  const [isOffline,   setIsOffline]   = useState(!navigator.onLine);
  const [queueCount,  setQueueCount]  = useState(0);
  const [errors,      setErrors]      = useState({});

  useEffect(() => {
    const goOn  = () => { setIsOffline(false); flush(); };
    const goOff = () => setIsOffline(true);
    window.addEventListener("online",  goOn);
    window.addEventListener("offline", goOff);
    return () => { window.removeEventListener("online", goOn); window.removeEventListener("offline", goOff); };
  }, []);

  useEffect(() => {
    if (!neonateId) return;
    fetchNeonate(neonateId).then(setNeonate).catch(() => {});
    loadHistory();
    readQueue().then(q => setQueueCount(q.filter(i => i.neonateId === neonateId).length));
  }, [neonateId]);

  function loadHistory() {
    fetchVitalHistory(neonateId)
      .then(d => setHistory(Array.isArray(d) ? d : d.readings ?? []))
      .catch(() => {});
  }

  const flush = useCallback(async () => {
    const items = await readQueue();
    for (const item of items) {
      try   { await postVitals(item.neonateId, item.payload); await dequeue(item.idbKey); }
      catch { break; }
    }
    readQueue().then(q => setQueueCount(q.filter(i => i.neonateId === neonateId).length));
    loadHistory();
  }, [neonateId]);

  useEffect(() => {
    const parsed = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v !== "" ? parseFloat(v) : null])
    );
    if (Object.values(parsed).every(v => v == null)) { setRisk(null); return; }
    setRisk(calcRisk(parsed, symptoms));
  }, [values, symptoms]);

  function validate() {
    const errs = {};
    if (!values.temp) errs.temp    = "Required";
    if (!values.hr)   errs.hr      = "Required";
    if (!values.rr)   errs.rr      = "Required";
    if (!values.spo2) errs.spo2    = "Required";
    if (!feeding)     errs.feeding = "Select feeding status";
    VITAL_FIELDS.forEach(f => {
      const v = parseFloat(values[f.key]);
      if (values[f.key] && (v < f.min || v > f.max))
        errs[f.key] = `${f.min}–${f.max} ${f.unit}`;
    });
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSubmitting(true);
    setStatus(null);

    const payload = {
      ...Object.fromEntries(Object.entries(values).map(([k,v]) => [k, v!==""?parseFloat(v):null])),
      feeding_status: feeding,
      symptoms,
      notes,
      recorded_at: new Date().toISOString(),
    };

    if (!navigator.onLine) {
      await enqueue(neonateId, payload);
      readQueue().then(q => setQueueCount(q.filter(i => i.neonateId === neonateId).length));
      setStatus("queued");
      setSubmitting(false);
      return;
    }

    try {
      setRiskLoading(true);
      const result = await postVitals(neonateId, payload);
      if (result?.risk) setRisk(result.risk);
      setStatus("success");
      loadHistory();
      setValues(EMPTY_VALUES);
      setFeeding("");
      setSymptoms(EMPTY_SYMPTOMS);
      setNotes("");
    } catch {
      await enqueue(neonateId, payload);
      readQueue().then(q => setQueueCount(q.filter(i => i.neonateId === neonateId).length));
      setStatus("queued");
    } finally {
      setSubmitting(false);
      setRiskLoading(false);
    }
  }

  return (
    <div className="vitals-page">

      {/* header */}
      <div className="vitals-header">
        <div>
          <h1 className="vitals-title">Vital Signs Entry</h1>
          {neonate && (
            <p className="vitals-subtitle">
              Patient <strong>{neonate.patient_id ?? neonateId}</strong>
              {neonate.name      ? ` · ${neonate.name}`        : ""}
              {neonate.age_days != null ? ` · Day ${neonate.age_days}` : ""}
            </p>
          )}
        </div>
        <div className="vitals-header-right">
          {isOffline    && <span className="vitals-offline-pill">● Offline</span>}
          {queueCount > 0 && <span className="vitals-queue-pill">{queueCount} queued</span>}
        </div>
      </div>

      <div className="vitals-layout">

        <div className="vitals-form-col">
          <form onSubmit={handleSubmit} noValidate>

            <section className="vitals-section">
              <h2 className="vitals-section-title">Measurements</h2>
              <div className="vitals-grid">
                {VITAL_FIELDS.map(f => (
                  <div key={f.key} className={`vitals-field${errors[f.key] ? " vitals-field-error" : ""}`}>
                    <label className="vitals-label" htmlFor={f.key}>
                      {f.label}<span className="vitals-unit">{f.unit}</span>
                    </label>
                    <input
                      id={f.key}
                      className="vitals-input"
                      type="number"
                      step={f.step} min={f.min} max={f.max}
                      placeholder={f.placeholder}
                      value={values[f.key]}
                      onChange={e => {
                        setValues(p => ({ ...p, [f.key]: e.target.value }));
                        setErrors(p => ({ ...p, [f.key]: undefined }));
                      }}
                    />
                    {errors[f.key] && <span className="vitals-error-msg">{errors[f.key]}</span>}
                  </div>
                ))}
              </div>
            </section>

            <section className="vitals-section">
              <h2 className="vitals-section-title">Feeding Status</h2>
              <div className="vitals-feeding-grid">
                {FEEDING_OPTIONS.map(opt => (
                  <label key={opt.value}
                    className={`vitals-radio-card${feeding === opt.value ? " vitals-radio-card-active" : ""}`}>
                    <input type="radio" name="feeding" value={opt.value}
                      checked={feeding === opt.value}
                      onChange={() => { setFeeding(opt.value); setErrors(p => ({ ...p, feeding: undefined })); }}
                      style={{ display:"none" }}/>
                    {opt.label}
                  </label>
                ))}
              </div>
              {errors.feeding && <span className="vitals-error-msg">{errors.feeding}</span>}
            </section>

            <section className="vitals-section">
              <h2 className="vitals-section-title">Symptom Flags</h2>
              <div className="vitals-symptoms-grid">
                {SYMPTOM_FLAGS.map(s => (
                  <label key={s.key}
                    className={`vitals-symptom-card${symptoms[s.key] ? " vitals-symptom-card-active" : ""}`}>
                    <input type="checkbox" checked={symptoms[s.key]}
                      onChange={e => setSymptoms(p => ({ ...p, [s.key]: e.target.checked }))}
                      style={{ accentColor:"#ef4444", width:14, height:14, flexShrink:0 }}/>
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="vitals-section">
              <h2 className="vitals-section-title">
                Notes <span className="vitals-optional">(optional)</span>
              </h2>
              <textarea className="vitals-textarea" rows={3}
                placeholder="Additional observations…"
                value={notes} onChange={e => setNotes(e.target.value)}/>
            </section>

            <div className="vitals-submit-row">
              <button className="vitals-submit-btn" type="submit" disabled={submitting}>
                {submitting ? "Saving…" : isOffline ? "Save (queue offline)" : "Save Vitals"}
              </button>
              {status === "success" && <span className="vitals-status vitals-status-success">✓ Saved</span>}
              {status === "queued"  && <span className="vitals-status vitals-status-queued">📶 Queued — syncs when online</span>}
              {status === "error"   && <span className="vitals-status vitals-status-error">⚠ Save failed</span>}
            </div>

          </form>
        </div>

        <div className="vitals-results-col">
          <RiskIndicator risk={risk} loading={riskLoading} />
          <div className="vitals-chart-card">
            <h2 className="vitals-section-title" style={{ marginBottom: 12 }}>
              Trend — Last 6 Readings
            </h2>
            <VitalSignsChart
              history={history}
              activeVital={activeVital}
              onVitalChange={setActiveVital}
            />
          </div>
        </div>

      </div>
    </div>
  );
}