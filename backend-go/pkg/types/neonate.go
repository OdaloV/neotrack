package types

type VitalSigns struct {
	Temperature         float32 `json:"temperature"`
	HeartRate           float32 `json:"heart_rate"`
	RespiratoryRate     float32 `json:"respiratory_rate"`
	SpO2                float32 `json:"spo2"`
	BirthWeight         float32 `json:"birth_weight"`
	GestationalAge      float32 `json:"gestational_age"`
	AgeHours            float32 `json:"age_hours"`
	Seizure             float32 `json:"seizure"`
	Apnea               float32 `json:"apnea"`
	Bradycardia         float32 `json:"bradycardia"`
	Cyanosis            float32 `json:"cyanosis"`
	PoorTone            float32 `json:"poor_tone"`
	BulgingFontanelle   float32 `json:"bulging_fontanelle"`
	Jaundice            float32 `json:"jaundice"`
	AbdominalDistension float32 `json:"abdominal_distension"`
}

type PredictRequest struct {
	Vitals VitalSigns `json:"vitals"`
}

type PredictResponse struct {
	Score       float32 `json:"score"`
	Level       string  `json:"level"`
	Probability float32 `json:"probability"`
	InferenceMs float32 `json:"inference_ms"`
}
