const express = require('express');
const router = express.Router();
const { query } = require('../db/postgres');
const { verifyToken, requireRole } = require('../middleware/auth');

router.post('/neonates', 
    verifyToken, 
    requireRole('NURSE'),
    async (req, res) => {
        try {
            const {
                mother_id,
                facility_id,
                birth_weight,
                gestational_age,
                apgar_score_1min,
                apgar_score_5min,
                apgar_score_10min,
                sex,
                delivery_type,
                presentation,
                resus_cpr,
                resus_oxygen,
                resus_intubation,
                skin_to_skin,
                exclusive_breastfeeding,
                temperature_at_admission,
                heart_rate_at_admission,
                respiratory_rate_at_admission,
                spo2_at_admission
            } = req.body;

            if (!mother_id || !facility_id || !birth_weight || !gestational_age) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: mother_id, facility_id, birth_weight, gestational_age'
                });
            }

            if (birth_weight < 0.5 || birth_weight > 6.0) {
                return res.status(400).json({
                    success: false,
                    message: 'birth_weight must be between 0.5 and 6.0 kg'
                });
            }

            if (gestational_age < 22 || gestational_age > 44) {
                return res.status(400).json({
                    success: false,
                    message: 'gestational_age must be between 22 and 44 weeks'
                });
            }

            if (sex && !['MALE', 'FEMALE', 'UNKNOWN'].includes(sex)) {
                return res.status(400).json({
                    success: false,
                    message: 'sex must be MALE, FEMALE, or UNKNOWN'
                });
            }

            if (delivery_type && !['SVD', 'C-SECTION', 'ASSISTED', 'BREECH'].includes(delivery_type)) {
                return res.status(400).json({
                    success: false,
                    message: 'delivery_type must be SVD, C-SECTION, ASSISTED, or BREECH'
                });
            }

            if (apgar_score_1min !== undefined && (apgar_score_1min < 0 || apgar_score_1min > 10)) {
                return res.status(400).json({
                    success: false,
                    message: 'apgar_score_1min must be between 0 and 10'
                });
            }

            if (apgar_score_5min !== undefined && (apgar_score_5min < 0 || apgar_score_5min > 10)) {
                return res.status(400).json({
                    success: false,
                    message: 'apgar_score_5min must be between 0 and 10'
                });
            }

            if (apgar_score_10min !== undefined && (apgar_score_10min < 0 || apgar_score_10min > 10)) {
                return res.status(400).json({
                    success: false,
                    message: 'apgar_score_10min must be between 0 and 10'
                });
            }

            if (temperature_at_admission !== undefined && (temperature_at_admission < 32 || temperature_at_admission > 42)) {
                return res.status(400).json({
                    success: false,
                    message: 'temperature_at_admission must be between 32.0 and 42.0 °C'
                });
            }

            if (heart_rate_at_admission !== undefined && (heart_rate_at_admission < 60 || heart_rate_at_admission > 220)) {
                return res.status(400).json({
                    success: false,
                    message: 'heart_rate_at_admission must be between 60 and 220 bpm'
                });
            }

            if (respiratory_rate_at_admission !== undefined && (respiratory_rate_at_admission < 20 || respiratory_rate_at_admission > 100)) {
                return res.status(400).json({
                    success: false,
                    message: 'respiratory_rate_at_admission must be between 20 and 100 breaths/min'
                });
            }

            if (spo2_at_admission !== undefined && (spo2_at_admission < 60 || spo2_at_admission > 100)) {
                return res.status(400).json({
                    success: false,
                    message: 'spo2_at_admission must be between 60 and 100%'
                });
            }

            const motherCheck = await query(
                'SELECT id FROM mothers WHERE id = $1',
                [mother_id]
            );
            if (motherCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Mother not found'
                });
            }

            const facilityCheck = await query(
                'SELECT id FROM facilities WHERE id = $1',
                [facility_id]
            );
            if (facilityCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Facility not found'
                });
            }

            if (req.user.role !== 'ADMIN') {
                if (req.user.facility_id !== facility_id) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only admit neonates to your facility'
                    });
                }
            }

            const currentYear = new Date().getFullYear();
            const countResult = await query(
                `SELECT COUNT(*) as count FROM neonates 
                 WHERE admission_number LIKE $1`,
                [`NEO-${currentYear}-%`]
            );
            const count = parseInt(countResult.rows[0].count) || 0;
            const sequence = String(count + 1).padStart(4, '0');
            const admission_number = `NEO-${currentYear}-${sequence}`;

            const client = await query.getClient ? await query.getClient() : null;
            
            try {
                let result;
                if (client) {
                    await client.query('BEGIN');
                    result = await client.query(
                        `INSERT INTO neonates (
                            mother_id, facility_id, admission_number,
                            birth_weight, gestational_age,
                            apgar_score_1min, apgar_score_5min, apgar_score_10min,
                            sex, delivery_type, presentation,
                            resus_cpr, resus_oxygen, resus_intubation,
                            skin_to_skin, exclusive_breastfeeding,
                            temperature_at_admission, heart_rate_at_admission,
                            respiratory_rate_at_admission, spo2_at_admission,
                            is_active
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                        RETURNING *`,
                        [
                            mother_id, facility_id, admission_number,
                            birth_weight, gestational_age,
                            apgar_score_1min || null, apgar_score_5min || null, apgar_score_10min || null,
                            sex || null, delivery_type || null, presentation || null,
                            resus_cpr || false, resus_oxygen || false, resus_intubation || false,
                            skin_to_skin || false, exclusive_breastfeeding || false,
                            temperature_at_admission || null, heart_rate_at_admission || null,
                            respiratory_rate_at_admission || null, spo2_at_admission || null,
                            true
                        ]
                    );
                    await client.query('COMMIT');
                } else {
                    result = await query(
                        `INSERT INTO neonates (
                            mother_id, facility_id, admission_number,
                            birth_weight, gestational_age,
                            apgar_score_1min, apgar_score_5min, apgar_score_10min,
                            sex, delivery_type, presentation,
                            resus_cpr, resus_oxygen, resus_intubation,
                            skin_to_skin, exclusive_breastfeeding,
                            temperature_at_admission, heart_rate_at_admission,
                            respiratory_rate_at_admission, spo2_at_admission,
                            is_active
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                        RETURNING *`,
                        [
                            mother_id, facility_id, admission_number,
                            birth_weight, gestational_age,
                            apgar_score_1min || null, apgar_score_5min || null, apgar_score_10min || null,
                            sex || null, delivery_type || null, presentation || null,
                            resus_cpr || false, resus_oxygen || false, resus_intubation || false,
                            skin_to_skin || false, exclusive_breastfeeding || false,
                            temperature_at_admission || null, heart_rate_at_admission || null,
                            respiratory_rate_at_admission || null, spo2_at_admission || null,
                            true
                        ]
                    );
                }

                const neonate = result.rows[0];

                if (temperature_at_admission || heart_rate_at_admission || 
                    respiratory_rate_at_admission || spo2_at_admission) {
                    
                    await query(
                        `INSERT INTO vital_signs (
                            neonate_id, temperature, heart_rate, 
                            respiratory_rate, spo2, recorded_at
                        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
                        [
                            neonate.id,
                            temperature_at_admission || null,
                            heart_rate_at_admission || null,
                            respiratory_rate_at_admission || null,
                            spo2_at_admission || null
                        ]
                    );
                }

                res.status(201).json({
                    success: true,
                    message: 'Neonate admitted successfully',
                    data: {
                        id: neonate.id,
                        admission_number: neonate.admission_number,
                        neonate: {
                            ...neonate,
                        }
                    }
                });

            } catch (error) {
                if (client) {
                    await client.query('ROLLBACK');
                }
                throw error;
            } finally {
                if (client) {
                    client.release();
                }
            }

        } catch (error) {
            console.error('Error admitting neonate:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error while admitting neonate',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

module.exports = router;