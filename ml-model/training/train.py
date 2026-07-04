"""
ml-model/training/train.py

Trains a GradientBoostingClassifier on synthetic neonatal vitals data.
Target: binary deterioration label (HIGH + CRITICAL = 1, LOW + MEDIUM = 0)

Features used:
  temperature, heart_rate, respiratory_rate, spo2, birth_weight,
  gestational_age, age_hours, + 8 symptom flags

Outputs:
  - model.pkl          (sklearn pipeline, for export_onnx.py)
  - model_metrics.json (AUC-ROC, F1, threshold, feature importances)
"""

import json
import pickle
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    roc_auc_score, classification_report, confusion_matrix,
    precision_recall_curve, f1_score,
)

BASE    = Path(__file__).parent
DATA    = BASE / "data" / "synthetic_vitals.csv"
OUT_PKL = BASE / "model.pkl"
OUT_MET = BASE / "model_metrics.json"

# Maps CSV column → canonical feature name used in ONNX / inference
FEATURE_MAP = {
    "temp":                 "temperature",
    "hr":                   "heart_rate",
    "rr":                   "respiratory_rate",
    "spo2":                 "spo2",
    "weight_g":             "birth_weight",
    "gestational_age_weeks":"gestational_age",
    "age_hours":            "age_hours",          # derived from age_days
    "seizure":              "seizure",
    "apnea":                "apnea",
    "bradycardia_flag":     "bradycardia",
    "cyanosis":             "cyanosis",
    "poor_tone":            "poor_tone",
    "bulging_fontanelle":   "bulging_fontanelle",
    "jaundice":             "jaundice",
    "abdominal_distension": "abdominal_distension",
}

FEATURES = list(FEATURE_MAP.values())   # ordered list used everywhere
TARGET   = "deterioration"



def load_data(path: Path) -> tuple[pd.DataFrame, pd.Series]:
    df = pd.read_csv(path)

    # Derive age_hours from age_days (add jitter for realism)
    rng = np.random.default_rng(42)
    df["age_hours"] = df["age_days"] * 24 + rng.integers(0, 24, size=len(df))

    # Rename to canonical feature names
    df = df.rename(columns=FEATURE_MAP)

    X = df[FEATURES].copy()
    y = df[TARGET].copy()

    print(f"Dataset: {len(df):,} rows  |  features: {len(FEATURES)}")
    print(f"Class balance: {y.mean():.1%} deterioration  /  {1-y.mean():.1%} stable")
    return X, y



def build_pipeline() -> Pipeline:
    """
    GradientBoostingClassifier chosen for:
      - Strong performance on tabular clinical data
      - Native feature importances
      - Deterministic inference (no random state at predict time)
      - skl2onnx support
    """
    return Pipeline([
        ("scaler", StandardScaler()),
        ("clf", GradientBoostingClassifier(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.08,
            subsample=0.85,
            min_samples_leaf=20,
            max_features="sqrt",
            random_state=42,
            verbose=0,
        )),
    ])



def best_threshold(y_true, y_prob) -> float:
    """Pick threshold that maximises F1 on validation predictions."""
    precision, recall, thresholds = precision_recall_curve(y_true, y_prob)
    f1 = 2 * precision * recall / (precision + recall + 1e-9)
    return float(thresholds[np.argmax(f1[:-1])])



def evaluate(pipeline, X_test, y_test, threshold):
    y_prob = pipeline.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= threshold).astype(int)

    auc  = roc_auc_score(y_test, y_prob)
    f1   = f1_score(y_test, y_pred)
    cm   = confusion_matrix(y_test, y_pred)
    tn, fp, fn, tp = cm.ravel()

    print(f"\n Test set result ")
    print(f"  AUC-ROC:     {auc:.4f}  {'✓ PASS' if auc > 0.85 else '✗ FAIL (target >0.85)'}")
    print(f"  F1 score:    {f1:.4f}")
    print(f"  Threshold:   {threshold:.3f}")
    print(f"  Sensitivity: {tp/(tp+fn):.3f}  (recall for deterioration)")
    print(f"  Specificity: {tn/(tn+fp):.3f}")
    print(f"  Confusion matrix:\n    TN={tn}  FP={fp}\n    FN={fn}  TP={tp}")
    print(f"\n{classification_report(y_test, y_pred, target_names=['Stable','Deteriorating'])}")

    return auc, f1, y_prob


def inference_benchmark(pipeline, X_test, n=200) -> float:
    """Measure single-sample inference time (µs)."""
    sample = X_test.iloc[:1]
    # Warmup
    for _ in range(10):
        pipeline.predict_proba(sample)
    # Timed
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        pipeline.predict_proba(sample)
        times.append((time.perf_counter() - t0) * 1000)   # ms
    p50 = float(np.percentile(times, 50))
    p95 = float(np.percentile(times, 95))
    print(f"\n Inference benchmark ({n} runs, sklearn)")
    print(f"  p50: {p50:.3f} ms   p95: {p95:.3f} ms")
    return p50



def feature_importances(pipeline) -> list[dict]:
    clf = pipeline.named_steps["clf"]
    importances = clf.feature_importances_
    ranked = sorted(zip(FEATURES, importances), key=lambda x: x[1], reverse=True)
    print("\n Feature importances ")
    for feat, imp in ranked:
        bar = "█" * int(imp * 200)
        print(f"  {feat:<25} {imp:.4f}  {bar}")
    return [{"feature": f, "importance": round(float(i), 6)} for f, i in ranked]


def cross_validate(pipeline, X, y) -> float:
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_val_score(pipeline, X, y, cv=cv, scoring="roc_auc", n_jobs=-1)
    print(f"\n 5-fold cross-validation AUC-ROC ")
    for i, s in enumerate(scores, 1):
        print(f"  Fold {i}: {s:.4f}")
    print(f"  Mean: {scores.mean():.4f} ± {scores.std():.4f}")
    return float(scores.mean())



def main():
    print("=" * 54)
    print("  NICUTrack — Deterioration Risk Model Training")
    print("=" * 54)

    X, y = load_data(DATA)

    # 80 / 20 stratified split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    print(f"\nTrain: {len(X_train):,}  |  Test: {len(X_test):,}")

    # Cross-validation first (on full data)
    pipeline = build_pipeline()
    cv_auc = cross_validate(pipeline, X, y)

    # Final fit on training set
    print("\nFitting final model on training set…")
    t0 = time.perf_counter()
    pipeline.fit(X_train, y_train)
    fit_time = time.perf_counter() - t0
    print(f"  Fit time: {fit_time:.2f}s")

    # Tune threshold on training predictions
    y_train_prob = pipeline.predict_proba(X_train)[:, 1]
    threshold = best_threshold(y_train, y_train_prob)

    # Evaluate on held-out test set
    auc, f1, y_test_prob = evaluate(pipeline, X_test, y_test, threshold)

    # Feature importances
    importances = feature_importances(pipeline)

    # Sklearn inference speed
    sklearn_p50 = inference_benchmark(pipeline, X_test)

    # Save model
    with open(OUT_PKL, "wb") as f:
        pickle.dump({
            "pipeline": pipeline,
            "features": FEATURES,
            "threshold": threshold,
            "feature_map": FEATURE_MAP,
        }, f)
    print(f"\n✓ Saved model → {OUT_PKL}")

    # Save metrics
    metrics = {
        "auc_roc_test":       round(auc, 4),
        "auc_roc_cv_mean":    round(cv_auc, 4),
        "f1_score":           round(f1, 4),
        "threshold":          round(threshold, 4),
        "sklearn_p50_ms":     round(sklearn_p50, 3),
        "pass_auc_target":    auc > 0.85,
        "n_train":            len(X_train),
        "n_test":             len(X_test),
        "features":           FEATURES,
        "feature_importances": importances,
        "model_params":       pipeline.named_steps["clf"].get_params(),
    }
    OUT_MET.write_text(json.dumps(metrics, indent=2))
    print(f"✓ Saved metrics → {OUT_MET}")

    if auc > 0.85:
        print(f"\n  AUC-ROC {auc:.4f} > 0.85 — target met")
    else:
        print(f"\n AUC-ROC {auc:.4f} < 0.85 — retune hyperparameters")

    print("\nNext: python export_onnx.py")


if __name__ == "__main__":
    main()
