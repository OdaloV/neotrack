const express = require('express');
const router = express.Router();
const { query } = require('../db/postgres');
const { verifyToken, requireRole } = require('../middleware/auth');

// POST /neonates - Admit a new neonate
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

// GET /neonates - Get active neonates for a facility
router.get('/neonates',
    verifyToken,
    async (req, res) => {
        try {
            const { facility_id, page = 1, limit = 20 } = req.query;
            const offset = (page - 1) * limit;

            if (!facility_id) {
                return res.status(400).json({
                    success: false,
                    message: 'facility_id is required'
                });
            }

            if (req.user.role !== 'ADMIN') {
                if (req.user.facility_id !== facility_id) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only view neonates from your facility'
                    });
                }
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

            const countResult = await query(
                `SELECT COUNT(*) as total 
                 FROM neonates 
                 WHERE facility_id = $1 AND is_active = true`,
                [facility_id]
            );
            const total = parseInt(countResult.rows[0].total);

            const result = await query(
                `SELECT 
                    n.id,
                    n.admission_number,
                    n.birth_weight,
                    n.gestational_age,
                    n.sex,
                    n.apgar_score_1min,
                    n.apgar_score_5min,
                    n.apgar_score_10min,
                    n.delivery_type,
                    n.admission_datetime,
                    n.is_active,
                    n.created_at,
                    m.id as mother_id,
                    m.first_name as mother_first_name,
                    m.last_name as mother_last_name,
                    m.mch_number,
                    m.phone as mother_phone,
                    vs.temperature as latest_temperature,
                    vs.heart_rate as latest_heart_rate,
                    vs.respiratory_rate as latest_respiratory_rate,
                    vs.spo2 as latest_spo2,
                    vs.risk_score as latest_risk_score,
                    vs.risk_level as latest_risk_level,
                    vs.recorded_at as latest_vitals_time
                FROM neonates n
                JOIN mothers m ON n.mother_id = m.id
                LEFT JOIN LATERAL (
                    SELECT * FROM vital_signs 
                    WHERE neonate_id = n.id 
                    ORDER BY recorded_at DESC 
                    LIMIT 1
                ) vs ON true
                WHERE n.facility_id = $1 AND n.is_active = true
                ORDER BY n.admission_datetime DESC
                LIMIT $2 OFFSET $3`,
                [facility_id, parseInt(limit), parseInt(offset)]
            );

            const neonates = result.rows.map(neonate => {
                const daysAdmitted = Math.floor(
                    (new Date() - new Date(neonate.admission_datetime)) / (1000 * 60 * 60 * 24)
                );

                return {
                    id: neonate.id,
                    admission_number: neonate.admission_number,
                    birth_weight: parseFloat(neonate.birth_weight),
                    gestational_age: neonate.gestational_age,
                    sex: neonate.sex,
                    apgar_score_1min: neonate.apgar_score_1min,
                    apgar_score_5min: neonate.apgar_score_5min,
                    apgar_score_10min: neonate.apgar_score_10min,
                    delivery_type: neonate.delivery_type,
                    admission_datetime: neonate.admission_datetime,
                    days_admitted: daysAdmitted,
                    mother: {
                        id: neonate.mother_id,
                        first_name: neonate.mother_first_name,
                        last_name: neonate.mother_last_name,
                        mch_number: neonate.mch_number,
                        phone: neonate.mother_phone
                    },
                    latest_vitals: neonate.latest_temperature ? {
                        temperature: parseFloat(neonate.latest_temperature),
                        heart_rate: neonate.latest_heart_rate,
                        respiratory_rate: neonate.latest_respiratory_rate,
                        spo2: neonate.latest_spo2,
                        risk_score: parseFloat(neonate.latest_risk_score),
                        risk_level: neonate.latest_risk_level,
                        recorded_at: neonate.latest_vitals_time
                    } : null
                };
            });

            const pages = Math.ceil(total / parseInt(limit));

            res.json({
                success: true,
                data: {
                    neonates,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: total,
                        pages: pages
                    }
                }
            });

        } catch (error) {
            console.error('Error fetching neonates:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error while fetching neonates',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);
// GET /neonates/:id - Get single neonate with latest vitals
router.get('/neonates/:id',
    verifyToken,
    async (req, res) => {
        try {
            const { id } = req.params;

            // Get neonate with mother and facility info
            const result = await query(
                `SELECT 
                    n.id,
                    n.admission_number,
                    n.birth_weight,
                    n.gestational_age,
                    n.apgar_score_1min,
                    n.apgar_score_5min,
                    n.apgar_score_10min,
                    n.sex,
                    n.delivery_type,
                    n.presentation,
                    n.resus_cpr,
                    n.resus_oxygen,
                    n.resus_intubation,
                    n.skin_to_skin,
                    n.exclusive_breastfeeding,
                    n.temperature_at_admission,
                    n.heart_rate_at_admission,
                    n.respiratory_rate_at_admission,
                    n.spo2_at_admission,
                    n.admission_datetime,
                    n.discharge_datetime,
                    n.outcome,
                    n.outcome_notes,
                    n.is_active,
                    n.created_at,
                    n.updated_at,
                    m.id as mother_id,
                    m.first_name as mother_first_name,
                    m.last_name as mother_last_name,
                    m.mch_number,
                    m.phone as mother_phone,
                    m.date_of_birth as mother_dob,
                    f.id as facility_id,
                    f.name as facility_name,
                    f.facility_code,
                    f.county
                FROM neonates n
                JOIN mothers m ON n.mother_id = m.id
                JOIN facilities f ON n.facility_id = f.id
                WHERE n.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Neonate not found'
                });
            }

            const neonate = result.rows[0];

            // Check facility access
            if (req.user.role !== 'ADMIN') {
                if (req.user.facility_id !== neonate.facility_id) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only view neonates from your facility'
                    });
                }
            }

            // Get latest vitals
            const vitalsResult = await query(
                `SELECT 
                    id, temperature, heart_rate, respiratory_rate, spo2,
                    blood_pressure_systolic, blood_pressure_diastolic,
                    blood_glucose, weight, head_circumference, length,
                    feeding_status, jaundice_present, jaundice_level,
                    convulsions, lethargy, cyanosis, grunting, chest_indrawing,
                    risk_score, risk_level, risk_reasons, ai_recommendation,
                    recorded_at
                FROM vital_signs 
                WHERE neonate_id = $1 
                ORDER BY recorded_at DESC 
                LIMIT 1`,
                [id]
            );

            // Get vitals history (last 20)
            const historyResult = await query(
                `SELECT 
                    id, temperature, heart_rate, respiratory_rate, spo2,
                    risk_score, risk_level, recorded_at
                FROM vital_signs 
                WHERE neonate_id = $1 
                ORDER BY recorded_at DESC 
                LIMIT 20`,
                [id]
            );

            // Get recent alerts
            const alertsResult = await query(
                `SELECT 
                    id, alert_type, risk_score, risk_level, reasons,
                    recommended_intervention, urgency, status,
                    created_at, acknowledged_at, resolved_at
                FROM alerts 
                WHERE neonate_id = $1 
                ORDER BY created_at DESC 
                LIMIT 10`,
                [id]
            );

            const daysAdmitted = neonate.is_active ? Math.floor(
                (new Date() - new Date(neonate.admission_datetime)) / (1000 * 60 * 60 * 24)
            ) : null;

            res.json({
                success: true,
                data: {
                    neonate: {
                        id: neonate.id,
                        admission_number: neonate.admission_number,
                        birth_weight: parseFloat(neonate.birth_weight),
                        gestational_age: neonate.gestational_age,
                        apgar_score_1min: neonate.apgar_score_1min,
                        apgar_score_5min: neonate.apgar_score_5min,
                        apgar_score_10min: neonate.apgar_score_10min,
                        sex: neonate.sex,
                        delivery_type: neonate.delivery_type,
                        presentation: neonate.presentation,
                        resus_cpr: neonate.resus_cpr,
                        resus_oxygen: neonate.resus_oxygen,
                        resus_intubation: neonate.resus_intubation,
                        skin_to_skin: neonate.skin_to_skin,
                        exclusive_breastfeeding: neonate.exclusive_breastfeeding,
                        temperature_at_admission: parseFloat(neonate.temperature_at_admission),
                        heart_rate_at_admission: neonate.heart_rate_at_admission,
                        respiratory_rate_at_admission: neonate.respiratory_rate_at_admission,
                        spo2_at_admission: neonate.spo2_at_admission,
                        admission_datetime: neonate.admission_datetime,
                        discharge_datetime: neonate.discharge_datetime,
                        outcome: neonate.outcome,
                        outcome_notes: neonate.outcome_notes,
                        is_active: neonate.is_active,
                        days_admitted: daysAdmitted,
                        mother: {
                            id: neonate.mother_id,
                            first_name: neonate.mother_first_name,
                            last_name: neonate.mother_last_name,
                            mch_number: neonate.mch_number,
                            phone: neonate.mother_phone,
                            date_of_birth: neonate.mother_dob
                        },
                        facility: {
                            id: neonate.facility_id,
                            name: neonate.facility_name,
                            code: neonate.facility_code,
                            county: neonate.county
                        }
                    },
                    latest_vitals: vitalsResult.rows[0] ? {
                        id: vitalsResult.rows[0].id,
                        temperature: parseFloat(vitalsResult.rows[0].temperature),
                        heart_rate: vitalsResult.rows[0].heart_rate,
                        respiratory_rate: vitalsResult.rows[0].respiratory_rate,
                        spo2: vitalsResult.rows[0].spo2,
                        blood_pressure_systolic: vitalsResult.rows[0].blood_pressure_systolic,
                        blood_pressure_diastolic: vitalsResult.rows[0].blood_pressure_diastolic,
                        blood_glucose: parseFloat(vitalsResult.rows[0].blood_glucose),
                        weight: parseFloat(vitalsResult.rows[0].weight),
                        head_circumference: parseFloat(vitalsResult.rows[0].head_circumference),
                        length: parseFloat(vitalsResult.rows[0].length),
                        feeding_status: vitalsResult.rows[0].feeding_status,
                        jaundice_present: vitalsResult.rows[0].jaundice_present,
                        jaundice_level: vitalsResult.rows[0].jaundice_level,
                        convulsions: vitalsResult.rows[0].convulsions,
                        lethargy: vitalsResult.rows[0].lethargy,
                        cyanosis: vitalsResult.rows[0].cyanosis,
                        grunting: vitalsResult.rows[0].grunting,
                        chest_indrawing: vitalsResult.rows[0].chest_indrawing,
                        risk_score: parseFloat(vitalsResult.rows[0].risk_score),
                        risk_level: vitalsResult.rows[0].risk_level,
                        risk_reasons: vitalsResult.rows[0].risk_reasons,
                        ai_recommendation: vitalsResult.rows[0].ai_recommendation,
                        recorded_at: vitalsResult.rows[0].recorded_at
                    } : null,
                    vitals_history: historyResult.rows.map(v => ({
                        id: v.id,
                        temperature: parseFloat(v.temperature),
                        heart_rate: v.heart_rate,
                        respiratory_rate: v.respiratory_rate,
                        spo2: v.spo2,
                        risk_score: parseFloat(v.risk_score),
                        risk_level: v.risk_level,
                        recorded_at: v.recorded_at
                    })),
                    alerts: alertsResult.rows.map(a => ({
                        id: a.id,
                        alert_type: a.alert_type,
                        risk_score: parseFloat(a.risk_score),
                        risk_level: a.risk_level,
                        reasons: a.reasons,
                        recommended_intervention: a.recommended_intervention,
                        urgency: a.urgency,
                        status: a.status,
                        created_at: a.created_at,
                        acknowledged_at: a.acknowledged_at,
                        resolved_at: a.resolved_at
                    }))
                }
            });

        } catch (error) {
            console.error('Error fetching neonate:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error while fetching neonate',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);
// PATCH /neonates/:id/discharge - Set outcome and discharge
router.patch('/neonates/:id/discharge',
    verifyToken,
    requireRole('CLINICIAN'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { 
                outcome, 
                outcome_notes, 
                discharge_datetime,
                referral_id 
            } = req.body;

            // Validate outcome
            const validOutcomes = ['DISCHARGED_HEALTHY', 'REFERRED', 'DIED', 'AMA', 'TRANSFERRED'];
            if (!outcome || !validOutcomes.includes(outcome)) {
                return res.status(400).json({
                    success: false,
                    message: `outcome must be one of: ${validOutcomes.join(', ')}`
                });
            }

            // Check if neonate exists and is active
            const neonateCheck = await query(
                `SELECT id, facility_id, is_active, admission_datetime 
                 FROM neonates 
                 WHERE id = $1`,
                [id]
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
                    message: 'Neonate is already discharged'
                });
            }

            // Check facility access
            if (req.user.role !== 'ADMIN') {
                if (req.user.facility_id !== neonate.facility_id) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only discharge neonates from your facility'
                    });
                }
            }

            // If outcome is REFERRED or TRANSFERRED, validate referral_id
            if (['REFERRED', 'TRANSFERRED'].includes(outcome)) {
                if (!referral_id) {
                    return res.status(400).json({
                        success: false,
                        message: 'referral_id is required for REFERRED or TRANSFERRED outcomes'
                    });
                }

                const referralCheck = await query(
                    'SELECT id FROM referrals WHERE id = $1 AND neonate_id = $2',
                    [referral_id, id]
                );
                if (referralCheck.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Referral not found for this neonate'
                    });
                }
            }

            const dischargeTime = discharge_datetime || new Date().toISOString();

            const client = await query.getClient ? await query.getClient() : null;

            try {
                let result;
                if (client) {
                    await client.query('BEGIN');

                    // Update neonate
                    result = await client.query(
                        `UPDATE neonates 
                         SET outcome = $1, 
                             outcome_notes = $2, 
                             discharge_datetime = $3, 
                             is_active = false,
                             updated_at = NOW()
                         WHERE id = $4
                         RETURNING *`,
                        [outcome, outcome_notes || null, dischargeTime, id]
                    );

                    // If referral, update referral status
                    if (['REFERRED', 'TRANSFERRED'].includes(outcome) && referral_id) {
                        await client.query(
                            `UPDATE referrals 
                             SET status = 'COMPLETED', 
                                 completed_at = NOW(),
                                 updated_at = NOW()
                             WHERE id = $1`,
                            [referral_id]
                        );
                    }

                    await client.query('COMMIT');
                } else {
                    result = await query(
                        `UPDATE neonates 
                         SET outcome = $1, 
                             outcome_notes = $2, 
                             discharge_datetime = $3, 
                             is_active = false,
                             updated_at = NOW()
                         WHERE id = $4
                         RETURNING *`,
                        [outcome, outcome_notes || null, dischargeTime, id]
                    );

                    if (['REFERRED', 'TRANSFERRED'].includes(outcome) && referral_id) {
                        await query(
                            `UPDATE referrals 
                             SET status = 'COMPLETED', 
                                 completed_at = NOW(),
                                 updated_at = NOW()
                             WHERE id = $1`,
                            [referral_id]
                        );
                    }
                }

                const updatedNeonate = result.rows[0];

                res.json({
                    success: true,
                    message: 'Neonate discharged successfully',
                    data: {
                        id: updatedNeonate.id,
                        admission_number: updatedNeonate.admission_number,
                        outcome: updatedNeonate.outcome,
                        outcome_notes: updatedNeonate.outcome_notes,
                        discharge_datetime: updatedNeonate.discharge_datetime,
                        is_active: updatedNeonate.is_active
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
            console.error('Error discharging neonate:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error while discharging neonate',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

module.exports = router;