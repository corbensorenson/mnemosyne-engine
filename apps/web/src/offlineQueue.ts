import type { OfflineQueueItem } from "@mnemosyne/offline-core";

const DB_NAME = "mnemosyne-offline-v1";
const DB_VERSION = 1;
const STORE_NAME = "offline_actions";

export async function listOfflineQueueItems(): Promise<OfflineQueueItem[]> {
  const db = await openOfflineQueueDb();
  return transaction<OfflineQueueItem[]>(db, "readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as OfflineQueueItem[]);
    request.onerror = () => reject(request.error ?? new Error("Unable to list offline queue items."));
  });
}

export async function putOfflineQueueItem(item: OfflineQueueItem): Promise<void> {
  const db = await openOfflineQueueDb();
  await transaction<void>(db, "readwrite", (store, resolve, reject) => {
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Unable to store offline queue item."));
  });
}

export async function clearSyncedOfflineQueueItems(): Promise<void> {
  const db = await openOfflineQueueDb();
  const items = await listOfflineQueueItems();
  await Promise.all(
    items
      .filter((item) => item.status === "synced" || item.status === "discarded")
      .map(
        (item) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const request = tx.objectStore(STORE_NAME).delete(item.id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error ?? new Error("Unable to clear synced item."));
          })
      )
  );
}

function openOfflineQueueDb(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(new Error("IndexedDB is unavailable."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("user_id", "user_id", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("action_type", "action_type", { unique: false });
        store.createIndex("updated_at", "updated_at", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open offline queue database."));
  });
}

function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    tx.onerror = () => reject(tx.error ?? new Error("Offline queue transaction failed."));
    run(tx.objectStore(STORE_NAME), resolve, reject);
  });
}
