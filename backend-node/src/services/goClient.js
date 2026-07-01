const axios = require('axios');

const GO_SERVICE_URL = process.env.GO_SERVICE_URL || 'http://localhost:8080';
const GO_SERVICE_TIMEOUT = parseInt(process.env.GO_SERVICE_TIMEOUT) || 3000;

function ruleBasedRiskScore(vitals) {
  let score = 0;
  const reasons = [];

  if (vitals.temperature < 36.0) {
    score += 0.3;
    reasons.push('Hypothermia');
  } else if (vitals.temperature > 37.5) {
    score += 0.2;
    reasons.push('Fever');
  }

  if (vitals.heart_rate < 100) {
    score += 0.2;
    reasons.push('Bradycardia');
  } else if (vitals.heart_rate > 180) {
    score += 0.2;
    reasons.push('Tachycardia');
  }

  if (vitals.respiratory_rate < 20) {
    score += 0.3;
    reasons.push('Bradypnea');
  } else if (vitals.respiratory_rate > 70) {
    score += 0.3;
    reasons.push('Tachypnea');
  }

  if (vitals.spo2 < 90) {
    score += 0.4;
    reasons.push('Hypoxia');
  } else if (vitals.spo2 < 95) {
    score += 0.2;
    reasons.push('Mild hypoxia');
  }

  if (vitals.weight && vitals.birth_weight) {
    const weightLoss = ((vitals.birth_weight - vitals.weight) / vitals.birth_weight) * 100;
    if (weightLoss > 10) {
      score += 0.3;
      reasons.push(`Weight loss: ${weightLoss.toFixed(1)}%`);
    } else if (weightLoss > 5) {
      score += 0.1;
      reasons.push(`Weight loss: ${weightLoss.toFixed(1)}%`);
    }
  }

  if (vitals.grunting) {
    score += 0.3;
    reasons.push('Grunting');
  }
  if (vitals.chest_indrawing) {
    score += 0.4;
    reasons.push('Chest indrawing');
  }
  if (vitals.cyanosis) {
    score += 0.3;
    reasons.push('Cyanosis');
  }
  if (vitals.lethargy) {
    score += 0.2;
    reasons.push('Lethargy');
  }
  if (vitals.convulsions) {
    score += 0.5;
    reasons.push('Convulsions');
  }

  const finalScore = Math.min(score, 1.0);
  return { score: finalScore, reasons };
}

function getFallbackRecommendation(riskLevel, reasons) {
  if (riskLevel === 'CRITICAL') {
    return 'Immediate medical review required. Consider emergency intervention.';
  }
  if (riskLevel === 'HIGH') {
    return `Urgent assessment needed. Notify clinician immediately. Reasons: ${reasons.join(', ')}`;
  }
  if (riskLevel === 'MEDIUM') {
    return `Monitor closely. Consider increasing observation frequency. Reasons: ${reasons.join(', ')}`;
  }
  return 'Continue routine monitoring.';
}

async function getRiskScore(vitals) {
  try {
    const response = await axios.post(
      `${GO_SERVICE_URL}/predict`,
      vitals,
      {
        timeout: GO_SERVICE_TIMEOUT,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    return {
      success: true,
      risk_score: response.data.risk_score || 0,
      risk_level: response.data.risk_level || 'LOW',
      risk_reasons: response.data.reasons || [],
      ai_recommendation: response.data.recommendation || null,
      processing_time_ms: response.data.processing_time_ms || 0,
      model_version: response.data.model_version || 'go-service-v1',
    };
  } catch (error) {
    console.warn('[goClient] Go service error, using fallback:', error.message);

    const fallback = ruleBasedRiskScore(vitals);
    const riskLevel = fallback.score >= 0.7 ? 'CRITICAL' :
                      fallback.score >= 0.5 ? 'HIGH' :
                      fallback.score >= 0.3 ? 'MEDIUM' : 'LOW';

    return {
      success: false,
      risk_score: fallback.score,
      risk_level: riskLevel,
      risk_reasons: fallback.reasons,
      ai_recommendation: getFallbackRecommendation(riskLevel, fallback.reasons),
      processing_time_ms: 0,
      model_version: 'fallback-rule-based',
    };
  }
}

module.exports = {
  getRiskScore,
  ruleBasedRiskScore,
  GO_SERVICE_URL,
};