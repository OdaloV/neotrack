"""
ml-model/training/generate_data.py

Generates clinically plausible synthetic neonatal vital signs data.
Based on WHO neonatal reference ranges and clinical deterioration rules.

Deterioration labels follow published clinical criteria:
  - Hypothermia:    temp < 36.0°C
  - Hyperthermia:   temp > 37.9°C
  - Bradycardia:    HR < 100 bpm
  - Tachycardia:    HR > 160 bpm (sustained)
  - Tachypnoea:     RR > 60 breaths/min
  - Apnoea risk:    RR < 30 breaths/min
  - Hypoxia:        SpO2 < 92%
  - Low SpO2:       SpO2 < 95% (moderate concern)
  - Hypoglycaemia:  glucose < 2.6 mmol/L
  - Combined flags: ≥2 concurrent abnormals → deterioration

References:
  WHO (2003). Managing Newborn Problems.
  Ballard & Khoury gestational age assessment ranges.
  NICE NG124 Neonatal infection guidelines.
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import uuid

RNG = np.random.default_rng(42)


GA_GROUPS = {
    "extreme_preterm": (28, 31),   # 28–31 weeks
    "very_preterm":    (32, 33),   # 32–33 weeks
    "moderate_preterm":(34, 36),   # 34–36 weeks
    "late_preterm":    (37, 38),   # 37–38 weeks
    "term":            (39, 42),   # 39–42 weeks
}

# Normal ranges per GA group: (mean, std) tuples
# Sources: WHO, AAP, Gomella's Neonatology
REFERENCE = {
    "extreme_preterm": {
        "temp_mean":   36.6,  "temp_std":   0.35,
        "hr_mean":     155,   "hr_std":     15,
        "rr_mean":     52,    "rr_std":     8,
        "spo2_mean":   94,    "spo2_std":   2.5,
        "weight_mean": 1050,  "weight_std": 280,
        "glucose_mean":3.2,   "glucose_std":0.6,
    },
    "very_preterm": {
        "temp_mean":   36.7,  "temp_std":   0.32,
        "hr_mean":     150,   "hr_std":     14,
        "rr_mean":     50,    "rr_std":     7,
        "spo2_mean":   95,    "spo2_std":   2.2,
        "weight_mean": 1650,  "weight_std": 320,
        "glucose_mean":3.4,   "glucose_std":0.55,
    },
    "moderate_preterm": {
        "temp_mean":   36.8,  "temp_std":   0.30,
        "hr_mean":     145,   "hr_std":     13,
        "rr_mean":     48,    "rr_std":     7,
        "spo2_mean":   96,    "spo2_std":   1.8,
        "weight_mean": 2200,  "weight_std": 380,
        "glucose_mean":3.6,   "glucose_std":0.5,
    },
    "late_preterm": {
        "temp_mean":   36.9,  "temp_std":   0.28,
        "hr_mean":     138,   "hr_std":     12,
        "rr_mean":     46,    "rr_std":     6,
        "spo2_mean":   97,    "spo2_std":   1.5,
        "weight_mean": 2950,  "weight_std": 380,
        "glucose_mean":3.8,   "glucose_std":0.45,
    },
    "term": {
        "temp_mean":   37.0,  "temp_std":   0.27,
        "hr_mean":     130,   "hr_std":     12,
        "rr_mean":     44,    "rr_std":     6,
        "spo2_mean":   98,    "spo2_std":   1.2,
        "weight_mean": 3300,  "weight_std": 420,
        "glucose_mean":4.0,   "glucose_std":0.4,
    },
}

FEEDING_OPTIONS = ["breastfed", "formula", "ng_tube", "tpn", "nil_by_mouth"]

# Feeding distribution by GA group (realistic clinical practice)
FEEDING_DIST = {
    "extreme_preterm":  [0.05, 0.05, 0.35, 0.50, 0.05],
    "very_preterm":     [0.08, 0.07, 0.45, 0.35, 0.05],
    "moderate_preterm": [0.15, 0.15, 0.45, 0.20, 0.05],
    "late_preterm":     [0.30, 0.25, 0.30, 0.10, 0.05],
    "term":             [0.55, 0.30, 0.08, 0.03, 0.04],
}

SYMPTOM_KEYS = [
    "seizure", "apnea", "bradycardia_flag", "cyanosis",
    "poor_tone", "bulging_fontanelle", "jaundice", "abdominal_distension",
]

# Base symptom prevalence in stable neonates (per symptom)
SYMPTOM_BASE_PREV = {
    "seizure":              0.008,
    "apnea":                0.035,
    "bradycardia_flag":     0.025,
    "cyanosis":             0.018,
    "poor_tone":            0.030,
    "bulging_fontanelle":   0.010,
    "jaundice":             0.120,
    "abdominal_distension": 0.022,
}

# Symptom multiplier during deterioration
SYMPTOM_DETERI_MULT = {
    "seizure":              6.0,
    "apnea":                8.0,
    "bradycardia_flag":     7.0,
    "cyanosis":             9.0,
    "poor_tone":            4.0,
    "bulging_fontanelle":   3.0,
    "jaundice":             1.8,
    "abdominal_distension": 2.5,
}


def ga_group(ga_weeks):
    if ga_weeks <= 31: return "extreme_preterm"
    if ga_weeks <= 33: return "very_preterm"
    if ga_weeks <= 36: return "moderate_preterm"
    if ga_weeks <= 38: return "late_preterm"
    return "term"


def sample_vitals(ref, deteriorating):
    """Sample raw vitals. Deteriorating cases have shifted distributions."""

    if deteriorating:
        # Pick 1–3 deterioration patterns to apply
        patterns = RNG.choice([
            "hypothermia", "hyperthermia", "tachycardia", "bradycardia",
            "tachypnoea",  "apnoea",       "hypoxia",     "hypoglycaemia",
        ], size=RNG.integers(1, 4), replace=False)

        temp = RNG.normal(ref["temp_mean"], ref["temp_std"])
        hr   = RNG.normal(ref["hr_mean"],   ref["hr_std"])
        rr   = RNG.normal(ref["rr_mean"],   ref["rr_std"])
        spo2 = RNG.normal(ref["spo2_mean"], ref["spo2_std"])
        gluc = RNG.normal(ref["glucose_mean"], ref["glucose_std"])

        for p in patterns:
            if p == "hypothermia":   temp = RNG.uniform(34.5, 35.9)
            if p == "hyperthermia":  temp = RNG.uniform(38.0, 39.2)
            if p == "tachycardia":   hr   = RNG.uniform(161, 210)
            if p == "bradycardia":   hr   = RNG.uniform(70,  99)
            if p == "tachypnoea":    rr   = RNG.uniform(61,  80)
            if p == "apnoea":        rr   = RNG.uniform(10,  28)
            if p == "hypoxia":       spo2 = RNG.uniform(80,  91)
            if p == "hypoglycaemia": gluc = RNG.uniform(1.5, 2.5)
    else:
        temp = RNG.normal(ref["temp_mean"], ref["temp_std"])
        hr   = RNG.normal(ref["hr_mean"],   ref["hr_std"])
        rr   = RNG.normal(ref["rr_mean"],   ref["rr_std"])
        spo2 = RNG.normal(ref["spo2_mean"], ref["spo2_std"])
        gluc = RNG.normal(ref["glucose_mean"], ref["glucose_std"])

    return temp, hr, rr, spo2, gluc


def apply_clinical_label(temp, hr, rr, spo2, glucose, symptoms):
    """
    Apply deterministic clinical deterioration label.
    Mirrors clinical escalation rules used in NICU practice.
    """
    flags = 0

    # Temperature
    if temp < 36.0 or temp > 37.9: flags += 1

    # Heart rate
    if hr < 100 or hr > 160: flags += 1

    # Respiratory rate
    if rr < 30 or rr > 60: flags += 1

    # SpO2
    if spo2 < 92:          flags += 2   # critical — weight double
    elif spo2 < 95:        flags += 1

    # Glucose
    if glucose < 2.6:      flags += 1

    # Symptoms (high-severity ones)
    if symptoms.get("seizure"):            flags += 3
    if symptoms.get("apnea"):             flags += 2
    if symptoms.get("cyanosis"):          flags += 2
    if symptoms.get("bradycardia_flag"):  flags += 1

    # Risk level
    if flags >= 4:   return "CRITICAL"
    elif flags >= 3: return "HIGH"
    elif flags >= 1: return "MEDIUM"
    else:            return "LOW"


def generate_record(target_deteriorating):
    # Gestational age — weighted toward term (realistic birth distribution)
    # range(28,43) = 15 values
    ga_weights = [0.02, 0.02, 0.02, 0.02, 0.03, 0.03, 0.04, 0.04, 0.04, 0.07, 0.08, 0.17, 0.20, 0.14, 0.08]
    ga_weeks   = int(RNG.choice(range(28, 43), p=ga_weights))
    group      = ga_group(ga_weeks)
    ref        = REFERENCE[group]

    # Age of neonate at time of reading (1–28 days)
    age_days = int(RNG.integers(1, 29))

    # Sex
    sex = RNG.choice(["M", "F"])

    # Vitals
    temp, hr, rr, spo2, glucose = sample_vitals(ref, target_deteriorating)

    # Weight — slight decrease first 3–5 days then recovery
    base_weight = RNG.normal(ref["weight_mean"], ref["weight_std"])
    if age_days <= 4:
        weight = base_weight * RNG.uniform(0.93, 0.99)
    else:
        weight = base_weight * RNG.uniform(0.99, 1.04)

    # Feeding
    feeding = RNG.choice(FEEDING_OPTIONS, p=FEEDING_DIST[group])

    # Symptoms
    symptoms = {}
    for key in SYMPTOM_KEYS:
        base = SYMPTOM_BASE_PREV[key]
        prob = base * SYMPTOM_DETERI_MULT[key] if target_deteriorating else base
        symptoms[key] = bool(RNG.random() < min(prob, 0.95))

    # Clinical label (ground truth)
    risk_level = apply_clinical_label(temp, hr, rr, spo2, glucose, symptoms)

    # Timestamp (random over past 90 days)
    recorded_at = datetime.now() - timedelta(
        days=int(RNG.integers(0, 90)),
        hours=int(RNG.integers(0, 24)),
        minutes=int(RNG.integers(0, 60)),
    )

    return {
        "patient_id":            str(uuid.uuid4())[:8].upper(),
        "recorded_at":           recorded_at.strftime("%Y-%m-%d %H:%M:%S"),
        "gestational_age_weeks": ga_weeks,
        "ga_group":              group,
        "age_days":              age_days,
        "sex":                   sex,
        # Vitals (rounded to clinical precision)
        "temp":                  round(float(np.clip(temp,  30.0, 42.0)), 1),
        "hr":                    int(np.clip(round(hr),     40,   300)),
        "rr":                    int(np.clip(round(rr),     5,    100)),
        "spo2":                  round(float(np.clip(spo2,  50.0, 100.0)), 1),
        "weight_g":              int(np.clip(round(weight), 300,  8000)),
        "glucose_mmol":          round(float(np.clip(glucose, 0.5, 15.0)), 1),
        "feeding_status":        feeding,
        # Symptom flags
        **{k: int(v) for k, v in symptoms.items()},
        # Label
        "risk_level":            risk_level,
        "deterioration":         int(risk_level in ("HIGH", "CRITICAL")),
    }


def generate_dataset(n=5000, deterioration_rate=0.15, seed=42):
    print(f"Generating {n:,} synthetic neonatal records "
          f"(target deterioration rate: {deterioration_rate:.0%})...")

    n_deteriorating = int(n * deterioration_rate)
    n_stable        = n - n_deteriorating

    records = []

    for _ in range(n_stable):
        records.append(generate_record(target_deteriorating=False))

    for _ in range(n_deteriorating):
        records.append(generate_record(target_deteriorating=True))

    RNG.shuffle(records)   # shuffle so deterioration isn't at the end

    df = pd.DataFrame(records)

    actual_rate = df["deterioration"].mean()
    print(f"\n Summary")
    print(f"  Total records:        {len(df):,}")
    print(f"  Deterioration rate:   {actual_rate:.1%}  (target {deterioration_rate:.0%})")
    print(f"\n  Risk level distribution:")
    for level, count in df["risk_level"].value_counts().items():
        print(f"    {level:<10} {count:>5,}  ({count/len(df):.1%})")

    print(f"\n  GA group distribution:")
    for group, count in df["ga_group"].value_counts().items():
        print(f"    {group:<20} {count:>5,}  ({count/len(df):.1%})")

    print(f"\n  Vital sign ranges:")
    for col in ["temp", "hr", "rr", "spo2", "weight_g", "glucose_mmol"]:
        print(f"    {col:<14} min={df[col].min():.1f}  mean={df[col].mean():.1f}  max={df[col].max():.1f}")

    print(f"\n  Symptom prevalence:")
    for key in SYMPTOM_KEYS:
        print(f"    {key:<25} {df[key].mean():.1%}")

    return df


if __name__ == "__main__":
    df = generate_dataset(n=5000, deterioration_rate=0.15)

    out_path = "data/synthetic_vitals.csv"
    df.to_csv(out_path, index=False)
    print(f"\n✓ Saved {len(df):,} records → {out_path}")
