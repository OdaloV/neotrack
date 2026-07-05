import {
  getPendingVitals,
  deletePendingVital,
  getPendingAdmissions,
  deletePendingAdmission,
  getPendingCount,
} from "./indexedDB.js";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

function getToken() {
  return localStorage.getItem("nicu_token") ?? "";
}

function getFacilityId() {
  return localStorage.getItem("nicu_facility_id") ?? "";
}

let syncing = false;


export async function syncAll(onProgress) {
  if (syncing)          return { skipped: true };
  if (!navigator.onLine) return { skipped: true };

  syncing = true;

  try {
    const [vitals, admissions] = await Promise.all([
      getPendingVitals(),
      getPendingAdmissions(),
    ]);

    if (vitals.length === 0 && admissions.length === 0) {
      return { vitals: 0, admissions: 0 };
    }

    // Build records array, keeping idbKey + type for cleanup after
    const records = [
      ...vitals.map((v) => ({
        client_id:      String(v.id),
        facility_id:    getFacilityId(),
        operation_type: "INSERT",
        table_name:     "vital_signs",
        record_id:      v.payload.record_id ?? crypto.randomUUID(),
        data:           v.payload,
        _idbKey:        v.id,
        _type:          "vital",
      })),
      ...admissions.map((a) => ({
        client_id:      String(a.id),
        facility_id:    getFacilityId(),
        operation_type: "INSERT",
        table_name:     "neonates",
        record_id:      a.payload.record_id ?? crypto.randomUUID(),
        data:           a.payload,
        _idbKey:        a.id,
        _type:          "admission",
      })),
    ];

    // Strip internal fields before sending
    const payload = records.map(({ _idbKey, _type, ...r }) => r);

    const res = await fetch(`${API_BASE}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: JSON.stringify({ records: payload }),
    });

    if (!res.ok && res.status !== 207) {
      throw new Error(`Sync server error: ${res.status}`);
    }

    const data = await res.json();

    // Clean up IndexedDB for ok + conflict (server wins, no need to retry)
    for (let i = 0; i < records.length; i++) {
      const result = data.results?.[i];
      if (result?.status === "ok" || result?.status === "conflict") {
        if (records[i]._type === "vital") {
          await deletePendingVital(records[i]._idbKey);
        } else {
          await deletePendingAdmission(records[i]._idbKey);
        }
      }
    }

    onProgress?.(data.summary);
    return data.summary;

  } catch (err) {
    console.error("[sync] failed:", err.message);
    return { error: err.message };
  } finally {
    syncing = false;
  }
}


export function registerSyncListener(onSyncComplete) {
  window.addEventListener("online", async () => {
    console.log("[sync] back online — draining queue…");
    const result = await syncAll();
    console.log("[sync] done:", result);
    onSyncComplete?.(result);
  });
}

export { getPendingCount };