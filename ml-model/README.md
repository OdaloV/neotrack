# NICUTrack — Deterioration Risk ML Model

Gradient boosting classifier that predicts neonatal deterioration risk from vital signs and symptom flags. Exported to ONNX for sub-millisecond inference in the backend.

---

## Quick start

```bash
cd ml-model/training

# 1 — Generate synthetic training data
python generate_data.py          # → data/synthetic_vitals.csv

# 2 — Train model
python train.py                  # → model.pkl + model_metrics.json

# 3 — Export to ONNX
python export_onnx.py            # → model.onnx

# 4 — Test inference
python inference.py
```

---

## Model performance

| Metric | Value | Target |
|---|---|---|
| AUC-ROC (test set) | **0.9955** | > 0.85 ✓ |
| AUC-ROC (5-fold CV) | **0.9949 ± 0.0016** | — |
| F1 score | **0.9173** | — |
| Sensitivity (recall) | **0.931** | — |
| Specificity | **0.985** | — |
| ONNX inference p50 | **0.017 ms** | < 10 ms ✓ |
| ONNX inference p95 | **0.025 ms** | < 10 ms ✓ |
| Model size | **228.6 KB** | — |

Evaluated on 1,000 held-out test records (20% stratified split).

---

## Feature importances

Ranked by mean decrease in impurity (Gradient Boosting):

| Rank | Feature | Importance | Notes |
|---|---|---|---|
| 1 | `spo2` | 0.2102 | SpO₂ < 92% is the strongest single deterioration signal |
| 2 | `apnea` | 0.1729 | Apnea episodes correlate strongly with acute deterioration |
| 3 | `heart_rate` | 0.1279 | Tachycardia (>160) and bradycardia (<100) both flagged |
| 4 | `seizure` | 0.1132 | Rare but high-severity symptom |
| 5 | `temperature` | 0.1105 | Hypothermia (<36°C) and hyperthermia (>37.9°C) |
| 6 | `respiratory_rate` | 0.1047 | Tachypnoea >60 and apnea risk <30 |
| 7 | `cyanosis` | 0.0836 | Peripheral/central cyanosis flag |
| 8 | `birth_weight` | 0.0252 | Lower weight increases baseline risk |
| 9 | `bradycardia` | 0.0198 | Symptom flag (separate from HR measurement) |
| 10 | `gestational_age` | 0.0175 | Extreme preterm (<32 weeks) higher risk |
| 11 | `age_hours` | 0.0108 | First 24–48h highest risk window |
| 12 | `poor_tone` | 0.0023 | Mild predictor |
| 13 | `jaundice` | 0.0011 | Low independent predictive value |
| 14 | `abdominal_distension` | 0.0001 | Low independent predictive value |
| 15 | `bulging_fontanelle` | 0.0001 | Low independent predictive value |

> **Clinical note:** Low importance for jaundice and abdominal distension doesn't mean they're clinically unimportant — they matter for diagnosis. They just don't independently predict the binary deterioration label used here.

---

## Input features

All 15 features must be passed as `float32` in this exact order:

```
temperature           °C      (30.0–42.0)
heart_rate            bpm     (40–300)
respiratory_rate      /min    (5–100)
spo2                  %       (50–100)
birth_weight          g       (300–8000)
gestational_age       weeks   (28–42)
age_hours             hours   (0–672)
seizure               0/1
apnea                 0/1
bradycardia           0/1
cyanosis              0/1
poor_tone             0/1
bulging_fontanelle    0/1
jaundice              0/1
abdominal_distension  0/1
```

---

## Output

The ONNX model returns two arrays:
- `output_label` — `int64[N]` — binary label (0=stable, 1=deteriorating)
- `output_probability` — `float32[N, 2]` — class probabilities `[P(stable), P(deteriorating)]`

The decision threshold is **0.330** (tuned to maximise F1 on training set). Use `output_probability[:, 1] >= 0.330` rather than `output_label` directly if you want to adjust sensitivity/specificity tradeoff.

Risk level mapping used in inference.py:

| Probability | Level |
|---|---|
| ≥ 0.75 | CRITICAL |
| ≥ 0.330 (threshold) | HIGH |
| ≥ 0.25 | MEDIUM |
| < 0.25 | LOW |

---

## Calling from Node.js (backend)

Install `onnxruntime-node`:

```bash
npm install onnxruntime-node
```

```js
const ort = require('onnxruntime-node');

async function predictRisk(vitals) {
  const session = await ort.InferenceSession.create('./ml-model/training/model.onnx');

  const features = [
    vitals.temperature, vitals.heart_rate, vitals.respiratory_rate,
    vitals.spo2, vitals.birth_weight, vitals.gestational_age, vitals.age_hours,
    vitals.seizure ?? 0, vitals.apnea ?? 0, vitals.bradycardia ?? 0,
    vitals.cyanosis ?? 0, vitals.poor_tone ?? 0, vitals.bulging_fontanelle ?? 0,
    vitals.jaundice ?? 0, vitals.abdominal_distension ?? 0,
  ];

  const tensor = new ort.Tensor('float32', Float32Array.from(features), [1, 15]);
  const results = await session.run({ float_input: tensor });
  const prob = results['output_probability'].data[1];  // P(deteriorating)

  const THRESHOLD = 0.330;
  const level = prob >= 0.75 ? 'CRITICAL'
              : prob >= THRESHOLD ? 'HIGH'
              : prob >= 0.25 ? 'MEDIUM'
              : 'LOW';

  return { level, score: Math.round(prob * 100), probability: prob };
}
```

---

## Clinical labeling rules (training data)

Deterioration labels were applied using published WHO/NICE criteria:

| Condition | Rule |
|---|---|
| Hypothermia | temp < 36.0°C |
| Hyperthermia | temp > 37.9°C |
| Bradycardia | HR < 100 bpm |
| Tachycardia | HR > 160 bpm |
| Apnoea risk | RR < 30 /min |
| Tachypnoea | RR > 60 /min |
| Hypoxia (critical) | SpO₂ < 92% (weight ×2) |
| Low SpO₂ | SpO₂ < 95% |
| Hypoglycaemia | glucose < 2.6 mmol/L |
| Seizure | flag present (weight ×3) |

Records with cumulative flag weight ≥ 3 labelled as deteriorating (HIGH/CRITICAL).

---

## Files

```
ml-model/training/
├── generate_data.py       synthetic data generator
├── train.py               model training + evaluation
├── export_onnx.py         ONNX export + benchmark
├── inference.py           Python inference helper
├── model.pkl              sklearn pipeline (not committed — generated locally)
├── model.onnx             ONNX model (committed)
├── model_metrics.json     AUC, F1, threshold, importances
└── data/
    └── synthetic_vitals.csv   5,000 training records
```
