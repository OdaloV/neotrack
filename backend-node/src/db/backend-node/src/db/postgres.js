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
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    admission_datetime TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    discharge_datetime TIMESTAMPTZ,
    outcome outcome_enum,
    outcome_notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    -- Fixed the bug where NULL was explicitly placed in the CHECK array
    jaundice_level VARCHAR(20) CHECK (jaundice_level IN ('MILD', 'MODERATE', 'SEVERE')),
    convulsions BOOLEAN DEFAULT FALSE,
    lethargy BOOLEAN DEFAULT FALSE,
    cyanosis BOOLEAN DEFAULT FALSE,
    grunting BOOLEAN DEFAULT FALSE,
    chest_indrawing BOOLEAN DEFAULT FALSE,
    risk_score DECIMAL(3,2),
    risk_level risk_level_enum,
    risk_reasons TEXT[],
    ai_recommendation TEXT,
    recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_offline BOOLEAN DEFAULT FALSE,
    synced_at TIMESTAMPTZ
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
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    escalated_at TIMESTAMPTZ,
    escalated_to UUID REFERENCES users(id),
    escalation_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sms_logs (
    id BIGSERIAL PRIMARY KEY,
    alert_id BIGINT REFERENCES alerts(id),
    recipient_phone VARCHAR(20) NOT NULL,
    recipient_name VARCHAR(100),
    message TEXT NOT NULL,
    status VARCHAR(20) CHECK (status IN ('SENT', 'DELIVERED', 'FAILED', 'PENDING')),
    provider_response TEXT,
    sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMPTZ,
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
    accepted_at TIMESTAMPTZ,
    departed_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMPTZ
);

-- Fixed the incomplete final block
CREATE TABLE model_predictions (
    id BIGSERIAL PRIMARY KEY,
    neonate_id UUID REFERENCES neonates(id) ON DELETE CASCADE,
    vital_sign_id BIGINT REFERENCES vital_signs(id) ON DELETE CASCADE,
    model_version VARCHAR(50) NOT NULL,
    input_features JSONB NOT NULL,
    prediction_score DECIMAL(3,2) NOT NULL,
    confidence_score DECIMAL(3,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- AUTOMATION: UPDATED_AT TRIGGER SETUP
-- ============================================

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_facilities_modtime BEFORE UPDATE ON facilities FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_users_modtime BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_mothers_modtime BEFORE UPDATE ON mothers FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_neonates_modtime BEFORE UPDATE ON neonates FOR EACH ROW EXECUTE FUNCTION update_modified_column();
