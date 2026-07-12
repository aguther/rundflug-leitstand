import { type OperationBoard, operationBoardSchema } from "@rundflug/contracts";

const DATABASE_NAME = "rundflug-leitstand-offline";
const STORE_NAME = "operation-boards";

interface StoredOperationBoard {
  key: string;
  savedAt: string;
  board: OperationBoard;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function snapshotKey(eventId: string, deviceId: string): string {
  return `${eventId}:${deviceId}`;
}

export async function saveOperationBoard(
  eventId: string,
  deviceId: string,
  board: OperationBoard,
  savedAt = new Date().toISOString(),
): Promise<void> {
  if (!("indexedDB" in globalThis)) return;
  let database: IDBDatabase;
  try {
    database = await openDatabase();
  } catch {
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        key: snapshotKey(eventId, deviceId),
        savedAt,
        board,
      } satisfies StoredOperationBoard);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function loadOperationBoard(
  eventId: string,
  deviceId: string,
): Promise<{ board: OperationBoard; savedAt: string } | null> {
  if (!("indexedDB" in globalThis)) return null;
  let database: IDBDatabase;
  try {
    database = await openDatabase();
  } catch {
    return null;
  }
  try {
    const stored = await new Promise<StoredOperationBoard | undefined>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(snapshotKey(eventId, deviceId));
      request.onsuccess = () => resolve(request.result as StoredOperationBoard | undefined);
      request.onerror = () => reject(request.error);
    });
    if (!stored || !Number.isFinite(Date.parse(stored.savedAt))) return null;
    return { board: operationBoardSchema.parse(stored.board), savedAt: stored.savedAt };
  } catch {
    return null;
  } finally {
    database.close();
  }
}

export function confirmedStateLabel(savedAt: string, now = Date.now()): string {
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(savedAt)) / 1000));
  if (ageSeconds < 60) return `letzte Bestätigung vor ${ageSeconds} s`;
  return `letzte Bestätigung vor ${Math.floor(ageSeconds / 60)} min`;
}
