/**
 * Local IndexedDB storage for the most recent OPI session microphone recording.
 * Only a single key ("latest") is stored so disk usage stays bounded to the last session.
 * Audio stays strictly on-device and is never uploaded to a server.
 */

const DB_NAME = 'linguaforge_opi_audio_v1';
const STORE_NAME = 'session_audio';
const LATEST_KEY = 'latest';

export interface StoredOpiAudio {
  sessionId: string;
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  createdAt: string;
}

function openAudioDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveLastOpiAudio(sessionId: string, blob: Blob, durationSeconds: number): Promise<boolean> {
  if (!sessionId || !blob || blob.size === 0) return false;
  const db = await openAudioDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredOpiAudio = {
        sessionId,
        blob,
        mimeType: blob.type || 'audio/webm',
        durationSeconds: Math.max(1, Math.round(durationSeconds)),
        createdAt: new Date().toISOString(),
      };
      store.put(record, LATEST_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function loadOpiAudioForSession(sessionId: string): Promise<StoredOpiAudio | null> {
  if (!sessionId) return null;
  const db = await openAudioDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(LATEST_KEY);
      req.onsuccess = () => {
        db.close();
        const record = req.result as StoredOpiAudio | undefined;
        if (record && record.sessionId === sessionId && record.blob instanceof Blob) {
          resolve(record);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function clearLastOpiAudio(): Promise<void> {
  const db = await openAudioDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(LATEST_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
