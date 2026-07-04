package model

import (
	"fmt"

	"github.com/OdaloV/neotrack/backend-go/pkg/types"
)

const threshold = float32(0.330)

func Predict(v types.VitalSigns) (*types.PredictResponse, error) {
	if session == nil {
		return nil, fmt.Errorf("model not loaded — call model.Load() first")
	}

	copy(inputTensor.GetData(), []float32{
		v.Temperature,
		v.HeartRate,
		v.RespiratoryRate,
		v.SpO2,
		v.BirthWeight,
		v.GestationalAge,
		v.AgeHours,
		v.Seizure,
		v.Apnea,
		v.Bradycardia,
		v.Cyanosis,
		v.PoorTone,
		v.BulgingFontanelle,
		v.Jaundice,
		v.AbdominalDistension,
	})

	if err := session.Run(); err != nil {
		return nil, fmt.Errorf("inference failed: %w", err)
	}

	probs := outputTensor.GetData() // [P(stable), P(deteriorating)]
	prob := probs[1]

	return &types.PredictResponse{
		Score:       prob,
		Probability: prob,
		Level:       scoreToLevel(prob),
	}, nil
}

func scoreToLevel(prob float32) string {
	switch {
	case prob >= 0.75:
		return "CRITICAL"
	case prob >= threshold:
		return "HIGH"
	case prob >= 0.25:
		return "MEDIUM"
	default:
		return "LOW"
	}
}
