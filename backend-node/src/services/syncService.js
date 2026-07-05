const { query } = require("../db/postgres");


async function retryFailed(maxRetries = 3) {
  const { rows } = await query(
    `SELECT * FROM sync_queue
     WHERE status = 'FAILED' AND retry_count < $1
     ORDER BY created_at ASC
     LIMIT 50`,
    [maxRetries]
  );

  const results = [];

  for (const row of rows) {
    try {
      // Re-apply depending on table
      if (row.table_name === "vital_signs") {
        const d = row.data;
        await query(
          `INSERT INTO vital_signs
            (neonate_id, temperature, heart_rate, respiratory_rate,
             spo2, weight, feeding_status, risk_score, risk_level,
             ai_recommendation, recorded_at, is_offline, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::risk_level_enum,$10,$11,true,NOW())
           ON CONFLICT DO NOTHING`,
          [
            d.neonate_id, d.temperature, d.heart_rate,
            d.respiratory_rate, d.spo2, d.weight ?? null,
            d.feeding_status ?? null, d.risk_score ?? null,
            d.risk_level ?? null, d.ai_recommendation ?? null,
            d.recorded_at ?? new Date(),
          ]
        );
      }

      await query(
        `UPDATE sync_queue SET status='SYNCED', synced_at=NOW() WHERE id=$1`,
        [row.id]
      );
      results.push({ id: row.id, status: "ok" });
    } catch (err) {
      await query(
        `UPDATE sync_queue
         SET retry_count=retry_count+1, error_message=$1,
             status = CASE WHEN retry_count+1 >= $2 THEN 'DEAD' ELSE 'FAILED' END
         WHERE id=$3`,
        [err.message, maxRetries, row.id]
      );
      results.push({ id: row.id, status: "error", message: err.message });
    }
  }

  return results;
}


async function getQueueStats() {
  const { rows } = await query(
    `SELECT status, COUNT(*) as count
     FROM sync_queue
     GROUP BY status`
  );
  return Object.fromEntries(rows.map((r) => [r.status, parseInt(r.count)]));
}


function startSyncWorker(intervalMs = 60_000) {
  console.log(`[syncWorker] starting — retrying failed records every ${intervalMs / 1000}s`);
  setInterval(async () => {
    try {
      const stats = await getQueueStats();
      if ((stats.FAILED ?? 0) === 0) return;
      console.log(`[syncWorker] retrying ${stats.FAILED} failed records…`);
      const results = await retryFailed();
      const ok  = results.filter((r) => r.status === "ok").length;
      const err = results.filter((r) => r.status === "error").length;
      console.log(`[syncWorker] done — ok:${ok} error:${err}`);
    } catch (err) {
      console.error("[syncWorker] error:", err.message);
    }
  }, intervalMs);
}

module.exports = { retryFailed, getQueueStats, startSyncWorker };