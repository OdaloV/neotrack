const express = require('express');
const router = express.Router();
const { query } = require('../db/postgres');
const { verifyToken, requireRole } = require('../middleware/auth');
const { getRiskScore } = require('../services/goClient');

router.post('/vitals',
    verifyToken,
    requireRole('NURSE'),
    async (req, res) => {
        try {
            const {
                neonate_id,
                temperature,
                heart_rate,
                respiratory_rate,
                spo2,
                blood_pressure_systolic,
                blood_pressure_diastolic,
                blood_glucose,
                weight,
                head_circumference,
                length,
                feeding_status,
                jaundice_present,
                jaundice_level,
                convulsions,
                lethargy,
                cyanosis,
                grunting,
                chest_indrawing,
                recorded_at
            } = req.body;

            if (!neonate_id) {
                return res.status(400).json({
                    success: false,
                    message: 'neonate_id is required'
                });
            }

            const hasVitals = temperature || heart_rate || respiratory_rate || spo2 ||
                             blood_pressure_systolic || blood_glucose || weight;

            if (!hasVitals) {
                return res.status(400).json({
                    success: false,
                    message: 'At least one vital sign must be provided'
                });
            }

            const errors = [];
            if (temperature !== undefined && (temperature < 32 || temperature > 42)) {
                errors.push('temperature must be between 32.0 and 42.0 °C');
            }
            if (heart_rate !== undefined && (heart_rate < 60 || heart_rate > 220)) {
                errors.push('heart_rate must be between 60 and 220 bpm');
            }
            if (respiratory_rate !== undefined && (respiratory_rate < 20 || respiratory_rate > 100)) {
                errors.push('respiratory_rate must be between 20 and 100 breaths/min');
            }
            if (spo2 !== undefined && (spo2 < 60 || spo2 > 100)) {
                errors.push('spo2 must be between 60 and 100%');
            }
            if (blood_glucose !== undefined && (blood_glucose < 0.5 || blood_glucose > 30)) {
                errors.push('blood_glucose must be between 0.5 and 30 mmol/L');
            }
            if (weight !== undefined && (weight < 0.5 || weight > 6.0)) {
                errors.push('weight must be between 0.5 and 6.0 kg');
            }
            if (jaundice_level && !['MILD', 'MODERATE', 'SEVERE'].includes(jaundice_level)) {
                errors.push('jaundice_level must be MILD, MODERATE, or SEVERE');
            }
            if (feeding_status && !['GOOD', 'POOR', 'NPO', 'NG_TUBE', 'IV_FLUIDS'].includes(feeding_status)) {
                errors.push('feeding_status must be GOOD, POOR, NPO, NG_TUBE, or IV_FLUIDS');
            }

            if (errors.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors
                });
            }

            const neonateCheck = await query(
                `SELECT id, facility_id, birth_weight, is_active 
                 FROM neonates 
                 WHERE id = $1`,
                [neonate_id]
            );

            if (neonateCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Neonate not found'
                });
            }

            const neonate = neonateCheck.rows[0];

            if (!neonate.is_active) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot record vitals for discharged neonate'
                });
            }

            if (req.user.role !== 'ADMIN') {
                if (req.user.facility_id !== neonate.facility_id) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only record vitals for neonates at your facility'
                    });
                }
            }

            const vitalsForScoring = {
                neonate_id,
                temperature: temperature || null,
                heart_rate: heart_rate || null,
                respiratory_rate: respiratory_rate || null,
                spo2: spo2 || null,
                blood_glucose: blood_glucose || null,
                weight: weight || null,
                birth_weight: parseFloat(neonate.birth_weight) || null,
                grunting: grunting || false,
                chest_indrawing: chest_indrawing || false,
                cyanosis: cyanosis || false,
                lethargy: lethargy || false,
                convulsions: convulsions || false,
            };

            const riskResult = await getRiskScore(vitalsForScoring);

            const riskScore = Math.round(riskResult.risk_score * 100) / 100;
            const riskLevel = riskResult.risk_level;
            const riskReasons = riskResult.risk_reasons || [];
            const aiRecommendation = riskResult.ai_recommendation || null;
            const modelVersion = riskResult.model_version || null;
            const processingTimeMs = riskResult.processing_time_ms || 0;

            const insertResult = await query(
                `INSERT INTO vital_signs (
                    neonate_id,
                    temperature,
                    heart_rate,
                    respiratory_rate,
                    spo2,
                    blood_pressure_systolic,
                    blood_pressure_diastolic,
                    blood_glucose,
                    weight,
                    head_circumference,
                    length,
                    feeding_status,
                    jaundice_present,
                    jaundice_level,
                    convulsions,
                    lethargy,
                    cyanosis,
                    grunting,
                    chest_indrawing,
                    risk_score,
                    risk_level,
                    risk_reasons,
                    ai_recommendation,
                    recorded_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
                RETURNING *`,
                [
                    neonate_id,
                    temperature || null,
                    heart_rate || null,
                    respiratory_rate || null,
                    spo2 || null,
                    blood_pressure_systolic || null,
                    blood_pressure_diastolic || null,
                    blood_glucose || null,
                    weight || null,
                    head_circumference || null,
                    length || null,
                    feeding_status || null,
                    jaundice_present || false,
                    jaundice_level || null,
                    convulsions || false,
                    lethargy || false,
                    cyanosis || false,
                    grunting || false,
                    chest_indrawing || false,
                    riskScore,
                    riskLevel,
                    riskReasons,
                    aiRecommendation,
                    recorded_at || new Date().toISOString()
                ]
            );

            const vitalSign = insertResult.rows[0];

            await query(
                `INSERT INTO model_predictions (
                    neonate_id,
                    vital_sign_id,
                    model_version,
                    input_features,
                    prediction_score,
                    confidence_score,
                    processing_time_ms
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    neonate_id,
                    vitalSign.id,
                    modelVersion || 'unknown',
                    JSON.stringify(vitalsForScoring),
                    riskScore,
                    riskScore,
                    processingTimeMs
                ]
            );

            res.status(201).json({
                success: true,
                message: 'Vital signs recorded successfully',
                data: {
                    vital_sign: {
                        id: vitalSign.id,
                        neonate_id: vitalSign.neonate_id,
                        temperature: parseFloat(vitalSign.temperature),
                        heart_rate: vitalSign.heart_rate,
                        respiratory_rate: vitalSign.respiratory_rate,
                        spo2: vitalSign.spo2,
                        blood_pressure_systolic: vitalSign.blood_pressure_systolic,
                        blood_pressure_diastolic: vitalSign.blood_pressure_diastolic,
                        blood_glucose: parseFloat(vitalSign.blood_glucose),
                        weight: parseFloat(vitalSign.weight),
                        head_circumference: parseFloat(vitalSign.head_circumference),
                        length: parseFloat(vitalSign.length),
                        feeding_status: vitalSign.feeding_status,
                        jaundice_present: vitalSign.jaundice_present,
                        jaundice_level: vitalSign.jaundice_level,
                        convulsions: vitalSign.convulsions,
                        lethargy: vitalSign.lethargy,
                        cyanosis: vitalSign.cyanosis,
                        grunting: vitalSign.grunting,
                        chest_indrawing: vitalSign.chest_indrawing,
                        risk_score: parseFloat(vitalSign.risk_score),
                        risk_level: vitalSign.risk_level,
                        risk_reasons: vitalSign.risk_reasons,
                        ai_recommendation: vitalSign.ai_recommendation,
                        recorded_at: vitalSign.recorded_at
                    },
                    risk_assessment: {
                        risk_score: riskScore,
                        risk_level: riskLevel,
                        risk_reasons: riskReasons,
                        recommendation: aiRecommendation,
                        model_version: modelVersion,
                        processing_time_ms: processingTimeMs,
                        go_service_used: riskResult.success
                    },
                    alert_triggered: ['HIGH', 'CRITICAL'].includes(riskLevel)
                }
            });

        } catch (error) {
            console.error('Error recording vitals:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error while recording vitals',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

router.get('/vitals/:neonate_id',
    verifyToken,
    async (req, res) => {
        try {
            const { neonate_id } = req.params;
            const { limit = 20, since } = req.query;

            const neonateCheck = await query(
                'SELECT id, facility_id FROM neonates WHERE id = $1',
                [neonate_id]
            );

            if (neonateCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Neonate not found'
                });
            }

            const neonate = neonateCheck.rows[0];

            if (req.user.role !== 'ADMIN') {
                if (req.user.facility_id !== neonate.facility_id) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only view vitals for neonates at your facility'
                    });
                }
            }

            let queryText = `
                SELECT 
                    id,
                    temperature,
                    heart_rate,
                    respiratory_rate,
                    spo2,
                    blood_pressure_systolic,
                    blood_pressure_diastolic,
                    blood_glucose,
                    weight,
                    head_circumference,
                    length,
                    feeding_status,
                    jaundice_present,
                    jaundice_level,
                    convulsions,
                    lethargy,
                    cyanosis,
                    grunting,
                    chest_indrawing,
                    risk_score,
                    risk_level,
                    risk_reasons,
                    ai_recommendation,
                    recorded_at
                FROM vital_signs
                WHERE neonate_id = $1
            `;

            const params = [neonate_id];

            if (since) {
                queryText += ` AND recorded_at >= $2`;
                params.push(since);
            }

            queryText += ` ORDER BY recorded_at DESC LIMIT $${params.length + 1}`;
            params.push(parseInt(limit) || 20);

            const result = await query(queryText, params);

            res.json({
                success: true,
                data: {
                    neonate_id,
                    vitals: result.rows.map(v => ({
                        id: v.id,
                        temperature: parseFloat(v.temperature),
                        heart_rate: v.heart_rate,
                        respiratory_rate: v.respiratory_rate,
                        spo2: v.spo2,
                        blood_pressure_systolic: v.blood_pressure_systolic,
                        blood_pressure_diastolic: v.blood_pressure_diastolic,
                        blood_glucose: parseFloat(v.blood_glucose),
                        weight: parseFloat(v.weight),
                        head_circumference: parseFloat(v.head_circumference),
                        length: parseFloat(v.length),
                        feeding_status: v.feeding_status,
                        jaundice_present: v.jaundice_present,
                        jaundice_level: v.jaundice_level,
                        convulsions: v.convulsions,
                        lethargy: v.lethargy,
                        cyanosis: v.cyanosis,
                        grunting: v.grunting,
                        chest_indrawing: v.chest_indrawing,
                        risk_score: parseFloat(v.risk_score),
                        risk_level: v.risk_level,
                        risk_reasons: v.risk_reasons,
                        ai_recommendation: v.ai_recommendation,
                        recorded_at: v.recorded_at
                    })),
                    total: result.rows.length
                }
            });

        } catch (error) {
            console.error('Error fetching vitals:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error while fetching vitals',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

module.exports = router;