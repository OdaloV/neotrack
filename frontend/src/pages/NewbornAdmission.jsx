import { useState, useEffect } from "react";
import "../styles/global.css";

const API_BASE = "/api";

export default function NewbornAdmission() {
  const [formData, setFormData] = useState({
    mother_mch: "",
    mother_id: "",
    facility_id: "",
    birth_weight: "",
    gestational_age: "",
    apgar_score_1min: "",
    apgar_score_5min: "",
    apgar_score_10min: "",
    sex: "",
    delivery_type: "",
    presentation: "",
    resus_cpr: false,
    resus_oxygen: false,
    resus_intubation: false,
    skin_to_skin: false,
    exclusive_breastfeeding: false,
    temperature_at_admission: "",
    heart_rate_at_admission: "",
    respiratory_rate_at_admission: "",
    spo2_at_admission: "",
  });

  const [mother, setMother] = useState(null);
  const [motherLoading, setMotherLoading] = useState(false);
  const [motherError, setMotherError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [facilities, setFacilities] = useState([]);
  const [facilityLoading, setFacilityLoading] = useState(true);

  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    loadFacilities();
  }, []);

  const loadFacilities = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/facilities`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFacilities(data.data || []);
      }
    } catch (err) {
      console.warn("Failed to load facilities:", err);
    } finally {
      setFacilityLoading(false);
    }
  };

  const lookupMother = async () => {
    const { mother_mch } = formData;
    if (!mother_mch || mother_mch.length < 3) {
      setMotherError("Please enter at least 3 characters to search");
      return;
    }

    setMotherLoading(true);
    setMotherError(null);
    setMother(null);

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/mothers?mch=${mother_mch}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.data && data.data.length > 0) {
          setMother(data.data[0]);
          setFormData(prev => ({ ...prev, mother_id: data.data[0].id }));
          setMotherError(null);
        } else {
          setMotherError("No mother found with that MCH number");
        }
      } else if (res.status === 404) {
        setMotherError("Mother not found. Please check the MCH number.");
      } else {
        setMotherError("Error searching for mother. Please try again.");
      }
    } catch (err) {
      if (!navigator.onLine) {
        setMotherError("You are offline. Please connect to the internet to search for mothers.");
      } else {
        setMotherError("Network error. Please try again.");
      }
    } finally {
      setMotherLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const validateForm = () => {
    const errors = [];

    if (!formData.mother_id) errors.push("Mother must be selected");
    if (!formData.facility_id) errors.push("Facility is required");
    if (!formData.birth_weight) errors.push("Birth weight is required");
    if (formData.birth_weight < 0.5 || formData.birth_weight > 6.0) {
      errors.push("Birth weight must be between 0.5 and 6.0 kg");
    }
    if (!formData.gestational_age) errors.push("Gestational age is required");
    if (formData.gestational_age < 22 || formData.gestational_age > 44) {
      errors.push("Gestational age must be between 22 and 44 weeks");
    }
    if (formData.apgar_score_1min && (formData.apgar_score_1min < 0 || formData.apgar_score_1min > 10)) {
      errors.push("APGAR 1min must be between 0 and 10");
    }
    if (formData.apgar_score_5min && (formData.apgar_score_5min < 0 || formData.apgar_score_5min > 10)) {
      errors.push("APGAR 5min must be between 0 and 10");
    }
    if (formData.apgar_score_10min && (formData.apgar_score_10min < 0 || formData.apgar_score_10min > 10)) {
      errors.push("APGAR 10min must be between 0 and 10");
    }
    if (formData.temperature_at_admission && (formData.temperature_at_admission < 32 || formData.temperature_at_admission > 42)) {
      errors.push("Temperature must be between 32.0 and 42.0 °C");
    }
    if (formData.heart_rate_at_admission && (formData.heart_rate_at_admission < 60 || formData.heart_rate_at_admission > 220)) {
      errors.push("Heart rate must be between 60 and 220 bpm");
    }
    if (formData.respiratory_rate_at_admission && (formData.respiratory_rate_at_admission < 20 || formData.respiratory_rate_at_admission > 100)) {
      errors.push("Respiratory rate must be between 20 and 100 breaths/min");
    }
    if (formData.spo2_at_admission && (formData.spo2_at_admission < 60 || formData.spo2_at_admission > 100)) {
      errors.push("SpO2 must be between 60 and 100%");
    }

    return errors;
  };

  const saveToOffline = (data) => {
    try {
      const offlineQueue = JSON.parse(localStorage.getItem("offline_admissions") || "[]");
      offlineQueue.push({
        ...data,
        offline_id: Date.now(),
        saved_at: new Date().toISOString(),
      });
      localStorage.setItem("offline_admissions", JSON.stringify(offlineQueue));
    } catch (err) {
      console.error("Failed to save offline:", err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    const errors = validateForm();
    if (errors.length > 0) {
      setSubmitError(errors.join(". "));
      return;
    }

    setSubmitting(true);

    const payload = {
      mother_id: formData.mother_id,
      facility_id: formData.facility_id,
      birth_weight: parseFloat(formData.birth_weight),
      gestational_age: parseInt(formData.gestational_age),
      apgar_score_1min: formData.apgar_score_1min ? parseInt(formData.apgar_score_1min) : null,
      apgar_score_5min: formData.apgar_score_5min ? parseInt(formData.apgar_score_5min) : null,
      apgar_score_10min: formData.apgar_score_10min ? parseInt(formData.apgar_score_10min) : null,
      sex: formData.sex || null,
      delivery_type: formData.delivery_type || null,
      presentation: formData.presentation || null,
      resus_cpr: formData.resus_cpr,
      resus_oxygen: formData.resus_oxygen,
      resus_intubation: formData.resus_intubation,
      skin_to_skin: formData.skin_to_skin,
      exclusive_breastfeeding: formData.exclusive_breastfeeding,
      temperature_at_admission: formData.temperature_at_admission ? parseFloat(formData.temperature_at_admission) : null,
      heart_rate_at_admission: formData.heart_rate_at_admission ? parseInt(formData.heart_rate_at_admission) : null,
      respiratory_rate_at_admission: formData.respiratory_rate_at_admission ? parseInt(formData.respiratory_rate_at_admission) : null,
      spo2_at_admission: formData.spo2_at_admission ? parseInt(formData.spo2_at_admission) : null,
    };

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/neonates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setSubmitSuccess(`Neonate admitted successfully! Admission Number: ${data.data.admission_number}`);
        setFormData({
          mother_mch: "",
          mother_id: "",
          facility_id: "",
          birth_weight: "",
          gestational_age: "",
          apgar_score_1min: "",
          apgar_score_5min: "",
          apgar_score_10min: "",
          sex: "",
          delivery_type: "",
          presentation: "",
          resus_cpr: false,
          resus_oxygen: false,
          resus_intubation: false,
          skin_to_skin: false,
          exclusive_breastfeeding: false,
          temperature_at_admission: "",
          heart_rate_at_admission: "",
          respiratory_rate_at_admission: "",
          spo2_at_admission: "",
        });
        setMother(null);
      } else {
        const errorData = await res.json();
        setSubmitError(errorData.message || "Failed to admit neonate");
      }
    } catch (err) {
      if (!navigator.onLine) {
        saveToOffline(payload);
        setSubmitSuccess("Saved offline. Will sync when back online.");
        setFormData({
          mother_mch: "",
          mother_id: "",
          facility_id: "",
          birth_weight: "",
          gestational_age: "",
          apgar_score_1min: "",
          apgar_score_5min: "",
          apgar_score_10min: "",
          sex: "",
          delivery_type: "",
          presentation: "",
          resus_cpr: false,
          resus_oxygen: false,
          resus_intubation: false,
          skin_to_skin: false,
          exclusive_breastfeeding: false,
          temperature_at_admission: "",
          heart_rate_at_admission: "",
          respiratory_rate_at_admission: "",
          spo2_at_admission: "",
        });
        setMother(null);
      } else {
        setSubmitError("Network error. Please check your connection.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <header className="header">
        <div className="header-left">
          <h1 className="page-title">Newborn Admission</h1>
          {isOffline && <span className="pill-offline">● Offline Mode</span>}
        </div>
      </header>

      {submitSuccess && (
        <div className="success-banner fade-in">
          ✅ {submitSuccess}
        </div>
      )}

      {submitError && (
        <div className="error-banner fade-in">
          ❌ {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="fade-in">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Mother Information</span>
          </div>

          <div className="form-group">
            <label className="form-label">MCH Number *</label>
            <div className="flex" style={{ gap: "8px" }}>
              <input
                type="text"
                name="mother_mch"
                className="form-input"
                value={formData.mother_mch}
                onChange={handleChange}
                placeholder="Enter MCH number"
                disabled={submitting}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={lookupMother}
                disabled={motherLoading || submitting || !formData.mother_mch}
              >
                {motherLoading ? "Searching..." : "Lookup"}
              </button>
            </div>
            {motherError && <div className="form-error">{motherError}</div>}
          </div>

          {mother && (
            <div className="card" style={{ backgroundColor: "#0f172a", borderColor: "#22c55e" }}>
              <div className="flex-between">
                <div>
                  <div style={{ fontWeight: 600, color: "#f1f5f9" }}>
                    {mother.first_name} {mother.last_name}
                  </div>
                  <div className="subtext">MCH: {mother.mch_number}</div>
                  <div className="subtext">Phone: {mother.phone || "N/A"}</div>
                </div>
                <span className="risk-low">✓ Found</span>
              </div>
            </div>
          )}

          <div className="form-group" style={{ marginTop: "12px" }}>
            <label className="form-label">Facility *</label>
            <select
              name="facility_id"
              className="form-select"
              value={formData.facility_id}
              onChange={handleChange}
              disabled={submitting || facilityLoading}
              required
            >
              <option value="">Select facility</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="card" style={{ marginTop: "16px" }}>
          <div className="card-header">
            <span className="card-title">Neonate Details</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="form-group">
              <label className="form-label">Birth Weight (kg) *</label>
              <input
                type="number"
                name="birth_weight"
                className="form-input"
                value={formData.birth_weight}
                onChange={handleChange}
                placeholder="0.5 - 6.0"
                step="0.01"
                min="0.5"
                max="6.0"
                disabled={submitting}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Gestational Age (weeks) *</label>
              <input
                type="number"
                name="gestational_age"
                className="form-input"
                value={formData.gestational_age}
                onChange={handleChange}
                placeholder="22 - 44"
                min="22"
                max="44"
                disabled={submitting}
                required
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            <div className="form-group">
              <label className="form-label">APGAR 1min</label>
              <input
                type="number"
                name="apgar_score_1min"
                className="form-input"
                value={formData.apgar_score_1min}
                onChange={handleChange}
                placeholder="0-10"
                min="0"
                max="10"
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label className="form-label">APGAR 5min</label>
              <input
                type="number"
                name="apgar_score_5min"
                className="form-input"
                value={formData.apgar_score_5min}
                onChange={handleChange}
                placeholder="0-10"
                min="0"
                max="10"
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label className="form-label">APGAR 10min</label>
              <input
                type="number"
                name="apgar_score_10min"
                className="form-input"
                value={formData.apgar_score_10min}
                onChange={handleChange}
                placeholder="0-10"
                min="0"
                max="10"
                disabled={submitting}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="form-group">
              <label className="form-label">Sex</label>
              <select
                name="sex"
                className="form-select"
                value={formData.sex}
                onChange={handleChange}
                disabled={submitting}
              >
                <option value="">Select</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Delivery Type</label>
              <select
                name="delivery_type"
                className="form-select"
                value={formData.delivery_type}
                onChange={handleChange}
                disabled={submitting}
              >
                <option value="">Select</option>
                <option value="SVD">SVD</option>
                <option value="C-SECTION">C-Section</option>
                <option value="ASSISTED">Assisted</option>
                <option value="BREECH">Breech</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Presentation</label>
            <input
              type="text"
              name="presentation"
              className="form-input"
              value={formData.presentation}
              onChange={handleChange}
              placeholder="e.g., Cephalic, Breech, Transverse"
              disabled={submitting}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginTop: "8px" }}>
            <label className="flex" style={{ alignItems: "center", gap: "6px", fontSize: "13px", color: "#94a3b8" }}>
              <input
                type="checkbox"
                name="resus_cpr"
                checked={formData.resus_cpr}
                onChange={handleChange}
                disabled={submitting}
              />
              CPR
            </label>
            <label className="flex" style={{ alignItems: "center", gap: "6px", fontSize: "13px", color: "#94a3b8" }}>
              <input
                type="checkbox"
                name="resus_oxygen"
                checked={formData.resus_oxygen}
                onChange={handleChange}
                disabled={submitting}
              />
              Oxygen
            </label>
            <label className="flex" style={{ alignItems: "center", gap: "6px", fontSize: "13px", color: "#94a3b8" }}>
              <input
                type="checkbox"
                name="resus_intubation"
                checked={formData.resus_intubation}
                onChange={handleChange}
                disabled={submitting}
              />
              Intubation
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "4px" }}>
            <label className="flex" style={{ alignItems: "center", gap: "6px", fontSize: "13px", color: "#94a3b8" }}>
              <input
                type="checkbox"
                name="skin_to_skin"
                checked={formData.skin_to_skin}
                onChange={handleChange}
                disabled={submitting}
              />
              Skin-to-Skin
            </label>
            <label className="flex" style={{ alignItems: "center", gap: "6px", fontSize: "13px", color: "#94a3b8" }}>
              <input
                type="checkbox"
                name="exclusive_breastfeeding"
                checked={formData.exclusive_breastfeeding}
                onChange={handleChange}
                disabled={submitting}
              />
              Exclusive Breastfeeding
            </label>
          </div>
        </div>

        <div className="card" style={{ marginTop: "16px" }}>
          <div className="card-header">
            <span className="card-title">Initial Vitals</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="form-group">
              <label className="form-label">Temperature (°C)</label>
              <input
                type="number"
                name="temperature_at_admission"
                className="form-input"
                value={formData.temperature_at_admission}
                onChange={handleChange}
                placeholder="32.0 - 42.0"
                step="0.1"
                min="32"
                max="42"
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Heart Rate (bpm)</label>
              <input
                type="number"
                name="heart_rate_at_admission"
                className="form-input"
                value={formData.heart_rate_at_admission}
                onChange={handleChange}
                placeholder="60 - 220"
                min="60"
                max="220"
                disabled={submitting}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="form-group">
              <label className="form-label">Respiratory Rate (/min)</label>
              <input
                type="number"
                name="respiratory_rate_at_admission"
                className="form-input"
                value={formData.respiratory_rate_at_admission}
                onChange={handleChange}
                placeholder="20 - 100"
                min="20"
                max="100"
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label className="form-label">SpO₂ (%)</label>
              <input
                type="number"
                name="spo2_at_admission"
                className="form-input"
                value={formData.spo2_at_admission}
                onChange={handleChange}
                placeholder="60 - 100"
                min="60"
                max="100"
                disabled={submitting}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px", marginTop: "20px", flexWrap: "wrap" }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={submitting || !formData.mother_id || !formData.facility_id}
            style={{ flex: 1, minWidth: "150px" }}
          >
            {submitting ? "Admitting..." : "Admit Newborn"}
          </button>
          <button
            type="reset"
            className="btn-secondary"
            onClick={() => {
              setFormData({
                mother_mch: "",
                mother_id: "",
                facility_id: "",
                birth_weight: "",
                gestational_age: "",
                apgar_score_1min: "",
                apgar_score_5min: "",
                apgar_score_10min: "",
                sex: "",
                delivery_type: "",
                presentation: "",
                resus_cpr: false,
                resus_oxygen: false,
                resus_intubation: false,
                skin_to_skin: false,
                exclusive_breastfeeding: false,
                temperature_at_admission: "",
                heart_rate_at_admission: "",
                respiratory_rate_at_admission: "",
                spo2_at_admission: "",
              });
              setMother(null);
              setMotherError(null);
              setSubmitError(null);
              setSubmitSuccess(null);
            }}
            disabled={submitting}
          >
            Clear Form
          </button>
        </div>
      </form>
    </div>
  );
}