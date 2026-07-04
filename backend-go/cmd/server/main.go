package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/OdaloV/neotrack/backend-go/internal/model"
	"github.com/OdaloV/neotrack/backend-go/pkg/types"
	"github.com/gin-gonic/gin"
)

func main() {
	modelPath := os.Getenv("MODEL_PATH")
	if modelPath == "" {
		modelPath = "model.onnx"
	}

	log.Printf("Loading ONNX model from %s ...", modelPath)
	if err := model.Load(modelPath); err != nil {
		log.Fatalf("Failed to load model: %v", err)
	}
	log.Println("Model loaded OK")

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/predict", func(c *gin.Context) {
		var req types.PredictRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "malformed input",
				"details": err.Error(),
			})
			return
		}

		start := time.Now()
		result, err := model.Predict(req.Vitals)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		result.InferenceMs = float32(time.Since(start).Microseconds()) / 1000

		c.JSON(http.StatusOK, result)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Listening on :%s", port)
	r.Run(":" + port)
}
