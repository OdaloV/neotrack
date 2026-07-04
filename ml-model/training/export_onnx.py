"""
ml-model/training/export_onnx.py

Converts the trained sklearn pipeline to ONNX format.
Validates the export and benchmarks inference time.

Output: model.onnx  (committed to repo)
"""

import json
import pickle
import time
from pathlib import Path

import numpy as np
import onnxruntime as rt
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

BASE     = Path(__file__).parent
PKL_PATH = BASE / "model.pkl"
ONNX_PATH= BASE / "model.onnx"
MET_PATH = BASE / "model_metrics.json"


def load_model():
    if not PKL_PATH.exists():
        raise FileNotFoundError("model.pkl not found — run train.py first")
    with open(PKL_PATH, "rb") as f:
        return pickle.load(f)


def export_onnx(pipeline, n_features: int) -> None:
    """Convert sklearn Pipeline → ONNX."""
    initial_type = [("float_input", FloatTensorType([None, n_features]))]
    onnx_model = convert_sklearn(
        pipeline,
        initial_types=initial_type,
        target_opset=17,
        options={type(pipeline.named_steps["clf"]): {"zipmap": False}},
    )
    ONNX_PATH.write_bytes(onnx_model.SerializeToString())
    size_kb = ONNX_PATH.stat().st_size / 1024
    print(f"✓ Exported → {ONNX_PATH}  ({size_kb:.1f} KB)")


def validate_parity(pipeline, features: list, threshold: float) -> None:
    """Check sklearn vs ONNX predictions match on random inputs."""
    import pandas as pd

    rng = np.random.default_rng(0)

    # Build a few realistic test rows
    test_rows = pd.DataFrame({
        "temperature":        rng.uniform(35.0, 39.0, 20),
        "heart_rate":         rng.uniform(90,   180,  20),
        "respiratory_rate":   rng.uniform(25,   70,   20),
        "spo2":               rng.uniform(88,   100,  20),
        "birth_weight":       rng.uniform(800,  4500, 20),
        "gestational_age":    rng.uniform(28,   42,   20),
        "age_hours":          rng.uniform(1,    672,  20),
        "seizure":            rng.integers(0, 2, 20).astype(float),
        "apnea":              rng.integers(0, 2, 20).astype(float),
        "bradycardia":        rng.integers(0, 2, 20).astype(float),
        "cyanosis":           rng.integers(0, 2, 20).astype(float),
        "poor_tone":          rng.integers(0, 2, 20).astype(float),
        "bulging_fontanelle": rng.integers(0, 2, 20).astype(float),
        "jaundice":           rng.integers(0, 2, 20).astype(float),
        "abdominal_distension":rng.integers(0, 2, 20).astype(float),
    })[features]   # ensure column order matches training

    # sklearn predictions
    sk_probs  = pipeline.predict_proba(test_rows)[:, 1]
    sk_preds  = (sk_probs >= threshold).astype(int)

    # ONNX predictions
    sess = rt.InferenceSession(str(ONNX_PATH))
    inp  = test_rows.values.astype(np.float32)
    onnx_out  = sess.run(None, {"float_input": inp})
    onnx_prob = onnx_out[1][:, 1]          # probabilities
    onnx_pred = (onnx_prob >= threshold).astype(int)

    max_diff = float(np.abs(sk_probs - onnx_prob).max())
    matches  = int((sk_preds == onnx_pred).sum())

    print(f"\n── Parity check (20 random samples) ────────────────")
    print(f"  Max probability diff (sk vs onnx): {max_diff:.6f}")
    print(f"  Prediction agreement: {matches}/20")

    if max_diff > 0.01:
        print("   Probability diff > 0.01 — check export options")
    else:
        print("  ✓ Parity OK")


def benchmark_onnx(features: list, threshold: float, n: int = 500) -> float:
    """Measure single-sample ONNX inference time."""
    sess = rt.InferenceSession(str(ONNX_PATH))

    rng  = np.random.default_rng(1)
    sample = np.array([[
        37.1,   # temperature
        138.0,  # heart_rate
        46.0,   # respiratory_rate
        97.5,   # spo2
        3200.0, # birth_weight
        38.0,   # gestational_age
        96.0,   # age_hours
        0, 0, 0, 0, 0, 0, 1, 0,   # symptom flags
    ]], dtype=np.float32)

    # Warmup
    for _ in range(20):
        sess.run(None, {"float_input": sample})

    # Timed
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        sess.run(None, {"float_input": sample})
        times.append((time.perf_counter() - t0) * 1000)

    p50 = float(np.percentile(times, 50))
    p95 = float(np.percentile(times, 95))
    p99 = float(np.percentile(times, 99))

    print(f"\n── ONNX inference benchmark ({n} runs) ─────────────")
    print(f"  p50: {p50:.3f} ms")
    print(f"  p95: {p95:.3f} ms")
    print(f"  p99: {p99:.3f} ms")
    print(f"  {'✓ PASS' if p95 < 10 else '⚠ SLOW'} (target <10 ms per prediction)")

    return p50, p95


def update_metrics(onnx_p50, onnx_p95):
    """Append ONNX timing to model_metrics.json."""
    if not MET_PATH.exists():
        return
    metrics = json.loads(MET_PATH.read_text())
    metrics["onnx_p50_ms"] = round(onnx_p50, 3)
    metrics["onnx_p95_ms"] = round(onnx_p95, 3)
    metrics["pass_latency_target"] = onnx_p95 < 10
    MET_PATH.write_text(json.dumps(metrics, indent=2))
    print(f"✓ Updated metrics → {MET_PATH}")


def main():
    print("=" * 54)
    print("  NICUTrack — Export Pipeline → ONNX")
    print("=" * 54)

    bundle    = load_model()
    pipeline  = bundle["pipeline"]
    features  = bundle["features"]
    threshold = bundle["threshold"]

    print(f"\nFeatures ({len(features)}): {', '.join(features)}")
    print(f"Decision threshold: {threshold:.3f}")

    export_onnx(pipeline, n_features=len(features))
    validate_parity(pipeline, features, threshold)
    p50, p95 = benchmark_onnx(features, threshold)
    update_metrics(p50, p95)

    print("\n" + "=" * 54)
    print("  model.onnx ready — commit to repo")
    print("  Use inference.py (below) to call from Node.js / Python")
    print("=" * 54)


if __name__ == "__main__":
    main()
