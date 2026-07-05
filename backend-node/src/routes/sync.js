const express = require("express");
const { query, getClient } = require("../db/postgres");
const router = express.Router();


const ALLOWED_TABLES = new Set(["vital_signs", "neonates", "mothers"]);
const ALLOWED_OPS    = new Set(["INSERT", "UPDATE"]);

function validateRecord(record, index) {
  const errors = [];
  if (!record.client_id)      errors.push("missing client_id");
  if (!record.operation_type) errors.push("missing operation_type");
  if (!record.table_name)     errors.push("missing table_name");
  if (!record.record_id)      errors.push("missing record_id");
  if (!record.data)           errors.push("missing data");
  if (!record.facility_id)    errors.push("missing facility_id");

  if (record.operation_type && !ALLOWED_OPS.has(record.operation_type.toUpperCase()))
    errors.push(`invalid operation_type: ${record.operation_type}`);

  if (record.table_name && !ALLOWED_TABLES.has(record.table_name))
    errors.push(`invalid table_name: ${record.table_name}`);

  return errors.length ? { index, client_id: record.client_id ?? null, errors } : null;
}


async function applyRecord(client, record) {
  const { operation_type, table_name, record_id, data } = record;
  const op = operation_type.toUpperCase();

  if (table_name === "vital_signs") {
    if (op === "INSERT") {
      await client.query(
        `INSERT INTO vital_signs (
          neonate_id, temperature, heart_rate, respiratory_rate,
          spo2, weight, feeding_status,
          jaundice_present, convulsions, lethargy, cyanosis,
          grunting, chest_indrawing,
          risk_score, risk_level, ai_recommendation,
          recorded_at, is_offline, synced_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::risk_level_enum,$16,$17,true,NOW()
        ) ON CONFLICT DO NOTHING`,
        [
          data.neonate_id,
          data.temperature,
          data.heart_rate,
          data.respiratory_rate,
          data.spo2,
          data.weight ?? null,
          data.feeding_status ?? null,
          data.jaundice      ?? false,
          data.seizure       ?? false,
          data.poor_tone     ?? false,
          data.cyanosis      ?? false,
          data.grunting      ?? false,
          data.chest_indrawing ?? false,
          data.risk_score    ?? null,
          data.risk_level    ?? null,
          data.ai_recommendation ?? null,
          data.recorded_at   ?? new Date(),
        ]
      );
    }
  } else if (table_name === "neonates") {
    if (op === "INSERT") {
      await client.query(
        `INSERT INTO neonates (
          id, mother_id, facility_id, admission_number,
          birth_weight, gestational_age, sex, delivery_type,
          admission_datetime, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
        ON CONFLICT (id) DO NOTHING`,
        [
          record_id,
          data.mother_id,
          data.facility_id,
          data.admission_number,
          data.birth_weight,
          data.gestational_age,
          data.sex ?? "UNKNOWN",
          data.delivery_type ?? "SVD",
          data.admission_datetime ?? new Date(),
        ]
      );
    }
  } else if (table_name === "mothers") {
    if (op === "INSERT") {
      await client.query(
        `INSERT INTO mothers (
          id, facility_id, first_name, last_name, date_of_birth,
          mch_number, phone, county
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING`,
        [
          record_id,
          data.facility_id,
          data.first_name,
          data.last_name,
          data.date_of_birth,
          data.mch_number ?? null,
          data.phone      ?? null,
          data.county     ?? null,
        ]
      );
    }
  }
}


router.post("/", async (req, res) => {
  const records = req.body?.records;

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({
      error: "Body must be { records: [...] } with at least one record",
    });
  }

  if (records.length > 500) {
    return res.status(400).json({ error: "Batch limit is 500 records" });
  }

  const validationErrors = records
    .map((r, i) => validateRecord(r, i))
    .filter(Boolean);

  if (validationErrors.length) {
    return res.status(400).json({
      error:   "Validation failed",
      details: validationErrors,
    });
  }

  const { rows: existing } = await query(
    `SELECT record_id::text FROM sync_queue
     WHERE record_id = ANY($1::uuid[]) AND status = 'SYNCED'`,
    [records.map((r) => r.record_id)]
  );
  const alreadySynced = new Set(existing.map((r) => r.record_id));


  const results = [];
  const client  = await getClient();

  for (const record of records) {
    const { client_id, facility_id, operation_type, table_name, record_id, data } = record;

    // Duplicate — skip, report as conflict
    if (alreadySynced.has(record_id)) {
      results.push({
        client_id,
        record_id,
        status:  "conflict",
        message: "Record already synced — server copy retained",
      });
      continue;
    }

    // Insert into sync_queue as PENDING
    const { rows: [queueRow] } = await query(
      `INSERT INTO sync_queue
        (facility_id, operation_type, table_name, record_id, data, status)
       VALUES ($1, $2, $3, $4::uuid, $5, 'PENDING')
       RETURNING id`,
      [facility_id, operation_type.toUpperCase(), table_name, record_id, JSON.stringify(data)]
    );

    try {
      await client.query("BEGIN");
      await applyRecord(client, record);

      // Mark synced
      await client.query(
        `UPDATE sync_queue SET status='SYNCED', synced_at=NOW() WHERE id=$1`,
        [queueRow.id]
      );
      await client.query("COMMIT");

      results.push({ client_id, record_id, status: "ok" });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});

      // Log failure against the queue row
      await query(
        `UPDATE sync_queue
         SET status='FAILED', error_message=$1, retry_count=retry_count+1
         WHERE id=$2`,
        [err.message, queueRow.id]
      );

      results.push({
        client_id,
        record_id,
        status:  "error",
        message: err.message,
      });
    }
  }

  client.release();

  const summary = {
    total:    results.length,
    ok:       results.filter((r) => r.status === "ok").length,
    conflict: results.filter((r) => r.status === "conflict").length,
    error:    results.filter((r) => r.status === "error").length,
  };

  const httpStatus = summary.error === summary.total ? 500
    : summary.error > 0 ? 207   // partial
    : 200;

  return res.status(httpStatus).json({ summary, results });
});


router.get("/queue", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, facility_id, operation_type, table_name, record_id,
              status, retry_count, error_message, created_at, synced_at
       FROM sync_queue
       ORDER BY created_at DESC
       LIMIT 100`
    );
    res.json({ count: rows.length, records: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;