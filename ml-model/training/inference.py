"""
ml-model/training/inference.py

Drop-in inference helper.
Call from your Node.js backend via python subprocess, or use onnxruntime-node.

Usage (Python):
    from inference import predict
    result = predict(temp=37.1, heart_rate=138, respiratory_rate=46,
                     spo2=97.5, birth_weight=3200, gestational_age=38,
                     age_hours=96, jaundice=1)
    # → {"level": "LOW", "score": 8, "probability": 0.08, "recommendation": "..."}
"""

import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as rt

BASE      = Path(__file__).parent
ONNX_PATH = BASE / "model.onnx"
MET_PATH  = BASE / "model_metrics.json"

FEATURES = [
    "temperature", "heart_rate", "respiratory_rate", "spo2",
    "birth_weight", "gestational_age", "age_hours",
    "seizure", "apnea", "bradycardia", "cyanosis",
    "poor_tone", "bulging_fontanelle", "jaundice", "abdominal_distension",
]

RECOMMENDATIONS = {
    "CRITICAL": "Immediate escalation required. Alert attending physician and prepare for intervention.",
    "HIGH":     "Close monitoring needed. Notify senior nurse and reassess within 30 minutes.",
    "MEDIUM":   "Monitor closely. Reassess in 1 hour as per protocol.",
    "LOW":      "Vitals within acceptable range. Continue routine monitoring every 2–4 hours.",
}

_sess      = None
_threshold = None


def _load():
    global _sess, _threshold
    if _sess is None:
        _sess = rt.InferenceSession(str(ONNX_PATH))
    if _threshold is None and MET_PATH.exists():
        _threshold = json.loads(MET_PATH.read_text()).get("threshold", 0.5)
    if _threshold is None:
        _threshold = 0.5


def predict(**kwargs) -> dict:
    """
    Predict deterioration risk for one patient reading.
    All feature arguments optional — missing values default to population mean.
    Returns dict with: level, score (0-100), probability, recommendation, inference_ms
    """
    _load()

    DEFAULTS = {
        "temperature": 37.0, "heart_rate": 135, "respiratory_rate": 46,
        "spo2": 97.0, "birth_weight": 2800, "gestational_age": 38,
        "age_hours": 72, "seizure": 0, "apnea": 0, "bradycardia": 0,
        "cyanosis": 0, "poor_tone": 0, "bulging_fontanelle": 0,
        "jaundice": 0, "abdominal_distension": 0,
    }

    row = np.array([[float(kwargs.get(f, DEFAULTS[f])) for f in FEATURES]], dtype=np.float32)

    t0  = time.perf_counter()
    out = _sess.run(None, {"float_input": row})
    ms  = (time.perf_counter() - t0) * 1000

    prob = float(out[1][0, 1])
    score = int(round(prob * 100))

    if prob >= _threshold:
        level = "CRITICAL" if prob > 0.75 else "HIGH"
    else:
        level = "MEDIUM" if prob > 0.25 else "LOW"

    return {
        "level":          level,
        "score":          score,
        "probability":    round(prob, 4),
        "recommendation": RECOMMENDATIONS[level],
        "inference_ms":   round(ms, 3),
    }


if __name__ == "__main__":
    # Quick smoke test
    cases = [
        dict(temperature=36.9, heart_rate=135, respiratory_rate=46, spo2=97.5,
             birth_weight=3200, gestational_age=39, age_hours=48),
        dict(temperature=35.2, heart_rate=175, respiratory_rate=65, spo2=89.0,
             birth_weight=1100, gestational_age=29, age_hours=12,
             seizure=1, cyanosis=1),
        dict(temperature=37.8, heart_rate=158, respiratory_rate=58, spo2=93.5,
             birth_weight=2100, gestational_age=35, age_hours=36, apnea=1),
    ]
    labels = ["Healthy term", "Critical preterm", "Moderate preterm"]
    print(f"{'Case':<20} {'Level':<10} {'Score':>5}  {'Prob':>6}  {'ms':>6}")
    print("-" * 56)
    for label, case in zip(labels, cases):
        r = predict(**case)
        print(f"{label:<20} {r['level']:<10} {r['score']:>5}  {r['probability']:>6.3f}  {r['inference_ms']:>5.2f}ms")
