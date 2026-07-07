const express = require("express");
const { query } = require("../db/postgres");
const router = express.Router();

// GET /api/alerts — all alerts sorted by urgency
router.get("/", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        a.id, a.neonate_id, a.alert_type, a.risk_score, a.risk_level,
        a.reasons, a.recommended_intervention, a.urgency, a.status,
        a.acknowledged_at, a.resolved_at, a.escalated_at,
        a.escalation_reason, a.created_at,
        n.admission_number,
        m.first_name as mother_first_name,
        m.last_name  as mother_last_name,
        f.name       as facility_name,
        u_ack.full_name  as acknowledged_by_name,
        u_esc.full_name  as escalated_to_name
      FROM alerts a
      JOIN neonates n  ON a.neonate_id  = n.id
      JOIN mothers  m  ON n.mother_id   = m.id
      JOIN facilities f ON n.facility_id = f.id
      LEFT JOIN users u_ack ON a.acknowledged_by = u_ack.id
      LEFT JOIN users u_esc ON a.escalated_to    = u_esc.id
      ORDER BY
        CASE a.urgency
          WHEN 'IMMEDIATE' THEN 1
          WHEN 'URGENT'    THEN 2
          WHEN 'ROUTINE'   THEN 3
          ELSE 4
        END,
        CASE a.status
          WHEN 'PENDING'    THEN 1
          WHEN 'ESCALATED'  THEN 2
          WHEN 'ACKNOWLEDGED' THEN 3
          WHEN 'RESOLVED'   THEN 4
          ELSE 5
        END,
        a.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts/pending/count
router.get("/pending/count", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT COUNT(*) as count FROM alerts
      WHERE status IN ('PENDING', 'ESCALATED')
    `);
    res.json({ count: parseInt(rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:id/acknowledge
router.patch("/:id/acknowledge", async (req, res) => {
  const { id } = req.params;
  const { notes, user_id } = req.body;
  try {
    const { rows } = await query(`
      UPDATE alerts
      SET status           = 'ACKNOWLEDGED',
          acknowledged_at  = NOW(),
          acknowledged_by  = $1,
          resolution_notes = $2
      WHERE id = $3
      RETURNING *
    `, [user_id ?? null, notes ?? null, id]);

    if (!rows.length) return res.status(404).json({ error: "Alert not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:id/escalate
router.patch("/:id/escalate", async (req, res) => {
  const { id } = req.params;
  const { reason, escalated_to, user_id } = req.body;

  if (!reason) return res.status(400).json({ error: "reason is required" });

  try {
    const { rows } = await query(`
      UPDATE alerts
      SET status            = 'ESCALATED',
          escalated_at      = NOW(),
          escalated_to      = $1,
          escalation_reason = $2
      WHERE id = $3
      RETURNING *
    `, [escalated_to ?? null, reason, id]);

    if (!rows.length) return res.status(404).json({ error: "Alert not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:id/resolve
router.patch("/:id/resolve", async (req, res) => {
  const { id } = req.params;
  const { notes, user_id } = req.body;
  try {
    const { rows } = await query(`
      UPDATE alerts
      SET status           = 'RESOLVED',
          resolved_at      = NOW(),
          resolved_by      = $1,
          resolution_notes = $2
      WHERE id = $3
      RETURNING *
    `, [user_id ?? null, notes ?? null, id]);

    if (!rows.length) return res.status(404).json({ error: "Alert not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
