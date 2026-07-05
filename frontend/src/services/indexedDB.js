const DB_NAME = "nicu_offline";
const DB_VERSION = 1;

const STORES = {
  PENDING_VITALS:      "pending_vitals",
  PENDING_ADMISSIONS:  "pending_admissions",
  CACHED_NEONATES:     "cached_neonates",
};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORES.PENDING_VITALS)) {
        const vs = db.createObjectStore(STORES.PENDING_VITALS, {
          keyPath: "id",
          autoIncrement: true,
        });
        vs.createIndex("neonateId", "neonateId", { unique: false });
        vs.createIndex("queuedAt",  "queuedAt",  { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.PENDING_ADMISSIONS)) {
        const as = db.createObjectStore(STORES.PENDING_ADMISSIONS, {
          keyPath: "id",
          autoIncrement: true,
        });
        as.createIndex("queuedAt", "queuedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.CACHED_NEONATES)) {
        const ns = db.createObjectStore(STORES.CACHED_NEONATES, {
          keyPath: "id",
        });
        ns.createIndex("risk_level", "risk_level", { unique: false });
        ns.createIndex("cachedAt",   "cachedAt",   { unique: false });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}


async function addToStore(storeName, record) {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).add({
      ...record,
      queuedAt: Date.now(),
    });
    req.onsuccess = (e) => resolve(e.target.result); // returns generated id
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function getAllFromStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function deleteFromStore(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
      .delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function clearStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(storeName, "readwrite")
      .objectStore(storeName)
      .clear();
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function countStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .count();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}


export async function queueVital(neonateId, payload) {
  return addToStore(STORES.PENDING_VITALS, { neonateId, payload });
}

export async function getPendingVitals() {
  return getAllFromStore(STORES.PENDING_VITALS);
}

export async function deletePendingVital(id) {
  return deleteFromStore(STORES.PENDING_VITALS, id);
}


export async function queueAdmission(payload) {
  return addToStore(STORES.PENDING_ADMISSIONS, { payload });
}

export async function getPendingAdmissions() {
  return getAllFromStore(STORES.PENDING_ADMISSIONS);
}

export async function deletePendingAdmission(id) {
  return deleteFromStore(STORES.PENDING_ADMISSIONS, id);
}


export async function cacheNeonates(neonates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORES.CACHED_NEONATES, "readwrite");
    const store = tx.objectStore(STORES.CACHED_NEONATES);
    store.clear();
    neonates.forEach((n) =>
      store.put({ ...n, cachedAt: Date.now() })
    );
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

export async function getCachedNeonates() {
  return getAllFromStore(STORES.CACHED_NEONATES);
}

export async function clearCachedNeonates() {
  return clearStore(STORES.CACHED_NEONATES);
}


export async function getPendingCount() {
  const [vitals, admissions] = await Promise.all([
    countStore(STORES.PENDING_VITALS),
    countStore(STORES.PENDING_ADMISSIONS),
  ]);
  return vitals + admissions;
}