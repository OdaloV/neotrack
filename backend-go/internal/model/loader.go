package model

import (
	"fmt"
	"os"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

var (
	inputTensor  *ort.Tensor[float32]
	outputTensor *ort.Tensor[float32]
	session      *ort.AdvancedSession
	sessionOnce  sync.Once
	sessionErr   error
)

func Load(modelPath string) error {
	sessionOnce.Do(func() {
		if _, err := os.Stat(modelPath); err != nil {
			sessionErr = fmt.Errorf("model file not found: %s", modelPath)
			return
		}

		if err := ort.InitializeEnvironment(); err != nil {
			sessionErr = fmt.Errorf("ort init: %w", err)
			return
		}

		var err error
		inputTensor, err = ort.NewEmptyTensor[float32](ort.NewShape(1, 15))
		if err != nil {
			sessionErr = fmt.Errorf("create input tensor: %w", err)
			return
		}

		outputTensor, err = ort.NewEmptyTensor[float32](ort.NewShape(1, 2))
		if err != nil {
			sessionErr = fmt.Errorf("create output tensor: %w", err)
			return
		}

		opts, err := ort.NewSessionOptions()
		if err != nil {
			sessionErr = fmt.Errorf("session options: %w", err)
			return
		}
		defer opts.Destroy()

		session, err = ort.NewAdvancedSession(
			modelPath,
			[]string{"float_input"},
			[]string{"output_probability"},
			[]ort.Value{inputTensor},
			[]ort.Value{outputTensor},
			opts,
		)
		if err != nil {
			sessionErr = fmt.Errorf("create session: %w", err)
		}
	})
	return sessionErr
}
