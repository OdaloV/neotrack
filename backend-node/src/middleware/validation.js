
const { query } = require('../db/postgres');

// Validate neonate admission data
const validateNeonateAdmission = (req, res, next) => {
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
        temperature_at_admission,
        heart_rate_at_admission,
        respiratory_rate_at_admission,
        spo2_at_admission
    } = req.body;

    const errors = [];

    // Required fields
    if (!mother_id) errors.push('mother_id is required');
    if (!facility_id) errors.push('facility_id is required');
    if (!birth_weight) errors.push('birth_weight is required');
    if (!gestational_age) errors.push('gestational_age is required');

    // Birth weight validation (0.5 - 6.0 kg)
    if (birth_weight !== undefined && (birth_weight < 0.5 || birth_weight > 6.0)) {
        errors.push('birth_weight must be between 0.5 and 6.0 kg');
    }

    // Gestational age validation (22 - 44 weeks)
    if (gestational_age !== undefined && (gestational_age < 22 || gestational_age > 44)) {
        errors.push('gestational_age must be between 22 and 44 weeks');
    }

    // Sex validation
    if (sex && !['MALE', 'FEMALE', 'UNKNOWN'].includes(sex)) {
        errors.push('sex must be MALE, FEMALE, or UNKNOWN');
    }

    // Delivery type validation
    if (delivery_type && !['SVD', 'C-SECTION', 'ASSISTED', 'BREECH'].includes(delivery_type)) {
        errors.push('delivery_type must be SVD, C-SECTION, ASSISTED, or BREECH');
    }

    // Apgar score validation (0-10)
    if (apgar_score_1min !== undefined && (apgar_score_1min < 0 || apgar_score_1min > 10)) {
        errors.push('apgar_score_1min must be between 0 and 10');
    }
    if (apgar_score_5min !== undefined && (apgar_score_5min < 0 || apgar_score_5min > 10)) {
        errors.push('apgar_score_5min must be between 0 and 10');
    }
    if (apgar_score_10min !== undefined && (apgar_score_10min < 0 || apgar_score_10min > 10)) {
        errors.push('apgar_score_10min must be between 0 and 10');
    }

    // Vital signs validation
    if (temperature_at_admission !== undefined && (temperature_at_admission < 32 || temperature_at_admission > 42)) {
        errors.push('temperature_at_admission must be between 32.0 and 42.0 °C');
    }
    if (heart_rate_at_admission !== undefined && (heart_rate_at_admission < 60 || heart_rate_at_admission > 220)) {
        errors.push('heart_rate_at_admission must be between 60 and 220 bpm');
    }
    if (respiratory_rate_at_admission !== undefined && (respiratory_rate_at_admission < 20 || respiratory_rate_at_admission > 100)) {
        errors.push('respiratory_rate_at_admission must be between 20 and 100 breaths/min');
    }
    if (spo2_at_admission !== undefined && (spo2_at_admission < 60 || spo2_at_admission > 100)) {
        errors.push('spo2_at_admission must be between 60 and 100%');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors
        });
    }

    next();
};

// Validate discharge data
const validateDischarge = (req, res, next) => {
    const { outcome, outcome_notes, discharge_datetime, referral_id } = req.body;
    const errors = [];

    const validOutcomes = ['DISCHARGED_HEALTHY', 'REFERRED', 'DIED', 'AMA', 'TRANSFERRED'];
    if (!outcome) {
        errors.push('outcome is required');
    } else if (!validOutcomes.includes(outcome)) {
        errors.push(`outcome must be one of: ${validOutcomes.join(', ')}`);
    }

    if (outcome_notes && outcome_notes.length > 1000) {
        errors.push('outcome_notes must be less than 1000 characters');
    }

    if (discharge_datetime && isNaN(Date.parse(discharge_datetime))) {
        errors.push('discharge_datetime must be a valid ISO timestamp');
    }

    if (['REFERRED', 'TRANSFERRED'].includes(outcome) && !referral_id) {
        errors.push('referral_id is required for REFERRED or TRANSFERRED outcomes');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors
        });
    }

    next();
};

// Validate facility_id query parameter
const validateFacilityId = (req, res, next) => {
    const { facility_id } = req.query;
    const errors = [];

    if (!facility_id) {
        errors.push('facility_id query parameter is required');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors
        });
    }

    next();
};

// Validate vitals data
const validateVitals = (req, res, next) => {
    const {
        temperature,
        heart_rate,
        respiratory_rate,
        spo2,
        blood_glucose,
        weight
    } = req.body;

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

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors
        });
    }

    next();
};

module.exports = {
    validateNeonateAdmission,
    validateDischarge,
    validateFacilityId,
    validateVitals
};
