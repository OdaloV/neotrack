-- ============================================
-- NEONATAL EARLY WARNING SYSTEM - PostgreSQL Schema
-- ============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ENUM TYPES
-- ============================================

CREATE TYPE risk_level_enum AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE outcome_enum AS ENUM ('DISCHARGED_HEALTHY', 'REFERRED', 'DIED', 'AMA', 'TRANSFERRED');
CREATE TYPE alert_status_enum AS ENUM ('PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'ESCALATED');
CREATE TYPE user_role_enum AS ENUM ('NURSE', 'CLINICIAN', 'ADMIN', 'CHW', 'MANAGER');

-- ============================================
-- FACILITIES & USERS
-- ============================================

CREATE TABLE facilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    facility_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    facility_type VARCHAR(50) NOT NULL,
    county VARCHAR(100) NOT NULL,
    sub_county VARCHAR(100),
    ward VARCHAR(100),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    contact_phone VARCHAR(20),
    contact_email VARCHAR(100),
    has_maternity_ward BOOLEAN DEFAULT FALSE,
    has_nicu BOOLEAN DEFAULT FALSE,
    has_ambulance BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    facility_id UUID REFERENCES facilities(id) ON DELETE SET NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20),
    full_name VARCHAR(150) NOT NULL,
    role user_role_enum DEFAULT 'NURSE',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MOTHERS & NEONATES
-- ============================================

CREATE TABLE mothers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    facility_id UUID REFERENCES facilities(id),
    mch_number VARCHAR(50) UNIQUE,
    national_id VARCHAR(20),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    phone VARCHAR(20),
    alternative_phone VARCHAR(20),
    village VARCHAR(100),
    sub_location VARCHAR(100),
    location VARCHAR(100),
    ward VARCHAR(100),
    county VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE neonates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mother_id UUID REFERENCES mothers(id),
    facility_id UUID REFERENCES facilities(id),
    admission_number VARCHAR(50) UNIQUE NOT NULL,
    birth_weight DECIMAL(5,2) NOT NULL,
    gestational_age INTEGER NOT NULL,
    apgar_score_1min INTEGER,
    apgar_score_5min INTEGER,
    apgar_score_10min INTEGER,
    sex VARCHAR(10) CHECK (sex IN ('MALE', 'FEMALE', 'UNKNOWN')),
    delivery_type VARCHAR(30) CHECK (delivery_type IN ('SVD', 'C-SECTION', 'ASSISTED', 'BREECH')),
    presentation VARCHAR(30),
    resus_cpr BOOLEAN DEFAULT FALSE,
    resus_oxygen BOOLEAN DEFAULT FALSE,
    resus_intubation BOOLEAN DEFAULT FALSE,
    skin_to_skin BOOLEAN DEFAULT FALSE,
    exclusive_breastfeeding BOOLEAN DEFAULT FALSE,
    temperature_at_admission DECIMAL(4,1),
    heart_rate_at_admission INTEGER,
    respiratory_rate_at_admission INTEGER,
    spo2_at_admission INTEGER,
    admission_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    discharge_datetime TIMESTAMP,
    outcome outcome_enum,
    outcome_notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- VITAL SIGNS (CORE TABLE)
-- ============================================

CREATE TABLE vital_signs (
    id BIGSERIAL PRIMARY KEY,
    neonate_id UUID REFERENCES neonates(id) ON DELETE CASCADE,
    temperature DECIMAL(4,1),
    heart_rate INTEGER,
    respiratory_rate INTEGER,
    spo2 INTEGER,
    blood_pressure_systolic INTEGER,
    blood_pressure_diastolic INTEGER,
    blood_glucose DECIMAL(4,2),
    weight DECIMAL(5,2),
    head_circumference DECIMAL(5,2),
    length DECIMAL(5,2),
    feeding_status VARCHAR(20) CHECK (feeding_status IN ('GOOD', 'POOR', 'NPO', 'NG_TUBE', 'IV_FLUIDS')),
    jaundice_present BOOLEAN DEFAULT FALSE,
    jaundice_level VARCHAR(20) CHECK (jaundice_level IN ('MILD', 'MODERATE', 'SEVERE', NULL)),
    convulsions BOOLEAN DEFAULT FALSE,
    lethargy BOOLEAN DEFAULT FALSE,
    cyanosis BOOLEAN DEFAULT FALSE,
    grunting BOOLEAN DEFAULT FALSE,
    chest_indrawing BOOLEAN DEFAULT FALSE,
    risk_score DECIMAL(3,2),
    risk_level risk_level_enum,
    risk_reasons TEXT[],
    ai_recommendation TEXT,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_offline BOOLEAN DEFAULT FALSE,
    synced_at TIMESTAMP
);

-- ============================================
-- ALERTS & SMS
-- ============================================

CREATE TABLE alerts (
    id BIGSERIAL PRIMARY KEY,
    neonate_id UUID REFERENCES neonates(id) ON DELETE CASCADE,
    vital_sign_id BIGINT REFERENCES vital_signs(id),
    alert_type VARCHAR(50) NOT NULL,
    risk_score DECIMAL(3,2),
    risk_level risk_level_enum,
    reasons TEXT[] NOT NULL,
    recommended_intervention TEXT NOT NULL,
    urgency VARCHAR(20) CHECK (urgency IN ('IMMEDIATE', 'URGENT', 'ROUTINE')),
    status alert_status_enum DEFAULT 'PENDING',
    acknowledged_at TIMESTAMP,
    acknowledged_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    escalated_at TIMESTAMP,
    escalated_to UUID REFERENCES users(id),
    escalation_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sms_logs (
    id BIGSERIAL PRIMARY KEY,
    alert_id BIGINT REFERENCES alerts(id),
    recipient_phone VARCHAR(20) NOT NULL,
    recipient_name VARCHAR(100),
    message TEXT NOT NULL,
    status VARCHAR(20) CHECK (status IN ('SENT', 'DELIVERED', 'FAILED', 'PENDING')),
    provider_response TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0
);

-- ============================================
-- REFERRALS
-- ============================================

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    neonate_id UUID REFERENCES neonates(id),
    from_facility_id UUID REFERENCES facilities(id),
    to_facility_id UUID REFERENCES facilities(id),
    referral_reason TEXT NOT NULL,
    clinical_summary TEXT,
    urgency VARCHAR(20) CHECK (urgency IN ('EMERGENCY', 'URGENT', 'ROUTINE')),
    transport_type VARCHAR(30) CHECK (transport_type IN ('AMBULANCE', 'BODA_BODA', 'PRIVATE_CAR', 'WALKING', 'OTHER')),
    transport_provider VARCHAR(100),
    transport_contact VARCHAR(20),
    status VARCHAR(30) CHECK (status IN ('PENDING', 'ACCEPTED', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'CANCELLED')),
    accepted_at TIMESTAMP,
    departed_at TIMESTAMP,
    arrived_at TIMESTAMP,
    completed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SYSTEM TABLES
-- ============================================

CREATE TABLE sync_queue (
    id BIGSERIAL PRIMARY KEY,
    facility_id UUID REFERENCES facilities(id),
    operation_type VARCHAR(50) NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    record_id UUID NOT NULL,
    data JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP
);

CREATE TABLE model_predictions (
    id BIGSERIAL PRIMARY KEY,
    neonate_id UUID REFERENCES neonates(id),
    vital_sign_id BIGINT REFERENCES vital_signs(id),
    model_version VARCHAR(50),
    input_features JSONB,
    prediction_score DECIMAL(3,2),
    confidence_score DECIMAL(3,2),
    processing_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(50),
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_vitals_neonate ON vital_signs(neonate_id, recorded_at DESC);
CREATE INDEX idx_vitals_risk ON vital_signs(risk_level, recorded_at);
CREATE INDEX idx_alerts_pending ON alerts(status, created_at) WHERE status = 'PENDING';
CREATE INDEX idx_alerts_neonate ON alerts(neonate_id, created_at DESC);
CREATE INDEX idx_neonates_admission ON neonates(admission_number);
CREATE INDEX idx_neonates_active ON neonates(is_active) WHERE is_active = true;
CREATE INDEX idx_mothers_mch ON mothers(mch_number);
CREATE INDEX idx_facilities_county ON facilities(county);
CREATE INDEX idx_sync_status ON sync_queue(status, created_at);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);

-- ============================================
-- VIEWS
-- ============================================

CREATE OR REPLACE VIEW v_high_risk_neonates AS
SELECT 
    n.id,
    n.admission_number,
    n.birth_weight,
    n.gestational_age,
    m.first_name as mother_first_name,
    m.last_name as mother_last_name,
    m.phone as mother_phone,
    f.name as facility_name,
    vs.risk_score,
    vs.risk_level,
    vs.risk_reasons,
    vs.ai_recommendation,
    vs.recorded_at as last_assessment
FROM neonates n
JOIN mothers m ON n.mother_id = m.id
JOIN facilities f ON n.facility_id = f.id
LEFT JOIN LATERAL (
    SELECT * FROM vital_signs 
    WHERE neonate_id = n.id 
    ORDER BY recorded_at DESC 
    LIMIT 1
) vs ON true
WHERE n.is_active = true
AND vs.risk_level IN ('HIGH', 'CRITICAL');

-- ============================================
-- TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_facilities_updated_at BEFORE UPDATE ON facilities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mothers_updated_at BEFORE UPDATE ON mothers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_neonates_updated_at BEFORE UPDATE ON neonates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-create alert on HIGH risk
CREATE OR REPLACE FUNCTION auto_create_alert()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.risk_level IN ('HIGH', 'CRITICAL') THEN
        INSERT INTO alerts (
            neonate_id, 
            vital_sign_id, 
            alert_type, 
            risk_score, 
            risk_level, 
            reasons, 
            recommended_intervention,
            urgency
        ) VALUES (
            NEW.neonate_id,
            NEW.id,
            'HIGH_RISK',
            NEW.risk_score,
            NEW.risk_level,
            NEW.risk_reasons,
            NEW.ai_recommendation,
            CASE 
                WHEN NEW.risk_level = 'CRITICAL' THEN 'IMMEDIATE'
                WHEN NEW.risk_level = 'HIGH' THEN 'URGENT'
                ELSE 'ROUTINE'
            END
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_create_alert_on_high_risk
AFTER INSERT ON vital_signs
FOR EACH ROW
EXECUTE FUNCTION auto_create_alert();

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

INSERT INTO facilities (facility_code, name, facility_type, county, sub_county, has_maternity_ward, has_nicu)
VALUES ('H001', 'Machakos Level 5 Hospital', 'Level 5', 'Machakos', 'Machakos Town', true, true)
ON CONFLICT (facility_code) DO NOTHING;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON DATABASE neonatal_ews IS 'Neonatal Early Warning System - AI-powered newborn deterioration detection';
COMMENT ON TABLE neonates IS 'Main table for newborn admissions';
COMMENT ON TABLE vital_signs IS 'Continuous monitoring with AI risk assessment';
COMMENT ON TABLE alerts IS 'AI-generated alerts for high-risk neonates';
COMMENT ON COLUMN vital_signs.risk_score IS '0.00 to 1.00 - Higher score = higher deterioration risk';