// Armazenamento local: IndexedDB (com reserva em localStorage). Tudo fica só neste navegador.
const DB = "motion-studio", ST = "kv";

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function kvGet(key) {
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const q = db.transaction(ST).objectStore(ST).get(key);
      q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error);
    });
  } catch {
    try { return JSON.parse(localStorage.getItem("ms:" + key)); } catch { return null; }
  }
}

export async function kvSet(key, value) {
  try {
    const db = await openDb();
    await new Promise((res, rej) => {
      const tx = db.transaction(ST, "readwrite");
      tx.objectStore(ST).put(value, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    return true;
  } catch {
    try { localStorage.setItem("ms:" + key, JSON.stringify(value)); return true; } catch { return false; }
  }
}

/** Pede ao navegador para não apagar os dados do site (presets) quando faltar espaço. */
export async function requestPersistence() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
