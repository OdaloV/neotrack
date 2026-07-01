import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import RiskIndicator from "../components/RiskIndicator";
import VitalSignsChart from "../components/VitalSignsChart";
import { getVitalHistory, submitVitals, getNeonate } from "../services/api";
import { queueVitalSubmit, getQueue, dequeueItem } from "../services/indexedDB";

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
  { key:"seizure",              label:"Seizure activity"      },
  { key:"apnea",                label:"Apnea episode"         },
  { key:"bradycardia",          label:"Bradycardia"           },
  { key:"cyanosis",             label:"Cyanosis"              },
  { key:"poor_tone",            label:"Poor muscle tone"      },
  { key:"bulging_fontanelle",   label:"Bulging fontanelle"    },
  { key:"jaundice",             label:"Jaundice"              },
  { key:"abdominal_distension", label:"Abdominal distension"  },
];

function calcRisk(values, symptoms) {
  let score = 0;
  const flags = [];
  const { temp, hr, rr, spo2 } = values;

  if (temp  != null) { if (temp  < 36   || temp  > 38)  { score+=25; flags.push("abnormal temp");  } else if (temp  < 36.5 || temp  > 37.5) score+=10; }
  if (hr    != null) { if (hr    < 80   || hr    > 200) { score+=25; flags.push("abnormal HR");    } else if (hr    < 100  || hr    > 160)  score+=10; }
  if (rr    != null) { if (rr    < 20   || rr    > 80)  { score+=20; flags.push("abnormal RR");    } else if (rr    < 30   || rr    > 60)   score+=8;  }
  if (spo2  != null) { if (spo2  < 90)                  { score+=30; flags.push("critical SpO₂");  } else if (spo2  < 95)                  score+=15; }

  SYMPTOM_FLAGS.filter(s => symptoms[s.key]).forEach(s => { score += 12; flags.push(s.label.toLowerCase()); });
  score = Math.min(score, 100);

  let level, recommendation;
  if      (score >= 70) { level="CRITICAL"; recommendation=`Immediate escalation. Concerns: ${flags.slice(0,3).join(", ")}. Alert attending physician now.`; }
  else if (score >= 45) { level="HIGH";     recommendation=`Close monitoring needed. Concerns: ${flags.slice(0,3).join(", ")}. Notify senior nurse, reassess in 30 min.`; }
  else if (score >= 20) { level="MEDIUM";   recommendation=flags.length ? `Monitor closely. Note: ${flags.join(", ")}. Reassess in 1 hour.` : "Stable but monitor. Reassess in 1 hour."; }
  else                  { level="LOW";      recommendation="Vitals within acceptable range. Routine monitoring every 2–4 hours."; }

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
  const [history,     setHistory]     = useState([]);
  const [activeVital, setActiveVital] = useState("hr");
  const [submitting,  setSubmitting]  = useState(false);
  const [status,      setStatus]      = useState(null);
  const [isOffline,   setIsOffline]   = useState(!navigator.onLine);
  const [queueCount,  setQueueCount]  = useState(0);
  const [errors,      setErrors]      = useState({});

  useEffect(() => {
    const on  = () => { setIsOffline(false); flushQueue(); };
    const off = () => setIsOffline(true);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    if (!neonateId) return;
    getNeonate(neonateId).then(setNeonate).catch(()=>{});
    getVitalHistory(neonateId).then(d => setHistory(Array.isArray(d) ? d : d.readings ?? [])).catch(()=>{});
    getQueue().then(q => setQueueCount(q.filter(i => i.neonateId === neonateId).length));
  }, [neonateId]);

  useEffect(() => {
    const parsed = Object.fromEntries(Object.entries(values).map(([k,v]) => [k, v!==""?parseFloat(v):null]));
    if (Object.values(parsed).every(v => v == null)) { setRisk(null); return; }
    setRisk(calcRisk(parsed, symptoms));
  }, [values, symptoms]);

  const flushQueue = useCallback(async () => {
    const items = await getQueue();
    for (const item of items) {
      try { await submitVitals(item.neonateId, item.payload); await dequeueItem(item.idbKey); }
      catch { break; }
    }
    getQueue().then(q => setQueueCount(q.filter(i => i.neonateId === neonateId).length));
    getVitalHistory(neonateId).then(d => setHistory(Array.isArray(d) ? d : d.readings ?? [])).catch(()=>{});
  }, [neonateId]);

  function validate() {
    const errs = {};
    if (!values.temp)  errs.temp    = "Required";
    if (!values.hr)    errs.hr      = "Required";
    if (!values.rr)    errs.rr      = "Required";
    if (!values.spo2)  errs.spo2    = "Required";
    if (!feeding)      errs.feeding = "Select feeding status";
    VITAL_FIELDS.forEach(f => {
      const v = parseFloat(values[f.key]);
      if (values[f.key] && (v < f.min || v > f.max)) errs[f.key] = `${f.min}–${f.max} ${f.unit}`;
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
      feeding_status: feeding, symptoms, notes, recorded_at: new Date().toISOString(),
    };

    if (!navigator.onLine) {
      await queueVitalSubmit(neonateId, payload);
      getQueue().then(q => setQueueCount(q.filter(i => i.neonateId === neonateId).length));
      setStatus("queued"); setSubmitting(false); return;
    }

    try {
      const result = await submitVitals(neonateId, payload);
      if (result?.risk) setRisk(result.risk);
      setStatus("success");
      getVitalHistory(neonateId).then(d => setHistory(Array.isArray(d) ? d : d.readings ?? []));
      setValues(EMPTY_VALUES); setFeeding(""); setSymptoms(EMPTY_SYMPTOMS); setNotes("");
    } catch {
      await queueVitalSubmit(neonateId, payload);
      getQueue().then(q => setQueueCount(q.filter(i => i.neonateId === neonateId).length));
      setStatus("queued");
    } finally { setSubmitting(false); }
  }

  return (
    <div className="vitals-page">
      <div className="vitals-header">
        <div>
          <h1 className="vitals-title">Vital Signs Entry</h1>
          {neonate && (
            <p className="vitals-subtitle">
              Patient <strong>{neonate.patient_id ?? neonateId}</strong>
              {neonate.name ? ` · ${neonate.name}` : ""}
              {neonate.age_days != null ? ` · Day ${neonate.age_days}` : ""}
            </p>
          )}
        </div>
        <div className="vitals-header-right">
          {isOffline   && <span className="vitals-offline-pill">● Offline</span>}
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
                  <div key={f.key} className={`vitals-field${errors[f.key]?" vitals-field-error":""}`}>
                    <label className="vitals-label" htmlFor={f.key}>
                      {f.label}<span className="vitals-unit">{f.unit}</span>
                    </label>
                    <input id={f.key} className="vitals-input"