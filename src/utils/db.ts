// IndexedDB-backed message history.
//
// History used to live in localStorage, which caps out around 5-10 MB for the
// whole origin. Because attachments are stored inline as base64, a handful of
// shared files filled the quota and the app had to start dropping attachments
// and halving histories just to keep writing. IndexedDB has no such ceiling,
// stores structured data without a JSON round-trip, and keeps large writes off
// the critical path.
//
// Everything here is best-effort: if IndexedDB is unavailable the callers fall
// back to an in-memory cache for the session rather than failing outright.

import type { UserMessage } from '../context/PeerContext';

const DB_NAME = 'p2pchat';
const DB_VERSION = 1;
const STORE_MESSAGES = 'messages';
const STORE_META = 'meta';
const INDEX_CHANNEL_TS = 'by-channel-ts';

export const MAX_STORED_PER_CHANNEL = 5000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null);
            return;
        }
        let req: IDBOpenDBRequest;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
                const store = db.createObjectStore(STORE_MESSAGES, { keyPath: ['channel', 'id'] });
                store.createIndex(INDEX_CHANNEL_TS, ['channel', 'timestamp']);
            }
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            console.warn('[DB] Could not open IndexedDB:', req.error);
            resolve(null);
        };
        req.onblocked = () => resolve(null);
    });
    return dbPromise;
};

const tx = async <T>(
    store: string,
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> => {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
        let transaction: IDBTransaction;
        try {
            transaction = db.transaction(store, mode);
        } catch {
            resolve(null);
            return;
        }
        const request = run(transaction.objectStore(store));
        if (!request) {
            transaction.oncomplete = () => resolve(null);
            transaction.onerror = () => resolve(null);
            return;
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            console.warn('[DB] Request failed:', request.error);
            resolve(null);
        };
    });
};

/** Stored shape: the message plus the channel it belongs to. */
type StoredMessage = UserMessage & { channel: string };

const stripChannel = (rows: StoredMessage[]): UserMessage[] =>
    rows.map(({ channel: _channel, ...msg }) => msg as UserMessage);

// ---------------------------------------------------------------- reads

/** The newest `limit` messages for a channel, returned oldest-first. */
export async function loadRecent(channel: string, limit: number): Promise<UserMessage[]> {
    const db = await openDb();
    if (!db) return [];
    return new Promise((resolve) => {
        const out: StoredMessage[] = [];
        let transaction: IDBTransaction;
        try {
            transaction = db.transaction(STORE_MESSAGES, 'readonly');
        } catch {
            resolve([]);
            return;
        }
        const index = transaction.objectStore(STORE_MESSAGES).index(INDEX_CHANNEL_TS);
        const range = IDBKeyRange.bound([channel], [channel, []]);
        const cursorReq = index.openCursor(range, 'prev');
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor || out.length >= limit) {
                out.reverse();
                resolve(stripChannel(out));
                return;
            }
            out.push(cursor.value as StoredMessage);
            cursor.continue();
        };
        cursorReq.onerror = () => resolve([]);
    });
}

/** Older messages for the "load earlier" control, returned oldest-first. */
export async function loadBefore(channel: string, beforeTs: number, limit: number): Promise<UserMessage[]> {
    const db = await openDb();
    if (!db) return [];
    return new Promise((resolve) => {
        const out: StoredMessage[] = [];
        let transaction: IDBTransaction;
        try {
            transaction = db.transaction(STORE_MESSAGES, 'readonly');
        } catch {
            resolve([]);
            return;
        }
        const index = transaction.objectStore(STORE_MESSAGES).index(INDEX_CHANNEL_TS);
        const range = IDBKeyRange.bound([channel], [channel, beforeTs], false, true);
        const cursorReq = index.openCursor(range, 'prev');
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor || out.length >= limit) {
                out.reverse();
                resolve(stripChannel(out));
                return;
            }
            out.push(cursor.value as StoredMessage);
            cursor.continue();
        };
        cursorReq.onerror = () => resolve([]);
    });
}

export async function countMessages(channel: string): Promise<number> {
    const range = IDBKeyRange.bound([channel], [channel, []]);
    const db = await openDb();
    if (!db) return 0;
    return new Promise((resolve) => {
        try {
            const req = db.transaction(STORE_MESSAGES, 'readonly').objectStore(STORE_MESSAGES).index(INDEX_CHANNEL_TS).count(range);
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => resolve(0);
        } catch {
            resolve(0);
        }
    });
}

// ---------------------------------------------------------------- writes

export async function putMessages(channel: string, messages: UserMessage[]): Promise<boolean> {
    if (messages.length === 0) return true;
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
        let transaction: IDBTransaction;
        try {
            transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        } catch {
            resolve(false);
            return;
        }
        const store = transaction.objectStore(STORE_MESSAGES);
        messages.forEach(msg => {
            if (msg && typeof msg.id === 'string') {
                store.put({ ...msg, channel });
            }
        });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => {
            console.warn('[DB] Write failed:', transaction.error);
            resolve(false);
        };
        transaction.onabort = () => resolve(false);
    });
}

export async function deleteMessage(channel: string, id: string): Promise<void> {
    await tx(STORE_MESSAGES, 'readwrite', s => s.delete([channel, id]) as IDBRequest<any>);
}

export async function deleteChannel(channel: string): Promise<void> {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        let transaction: IDBTransaction;
        try {
            transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        } catch {
            resolve();
            return;
        }
        const index = transaction.objectStore(STORE_MESSAGES).index(INDEX_CHANNEL_TS);
        const range = IDBKeyRange.bound([channel], [channel, []]);
        const cursorReq = index.openCursor(range);
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            cursor.delete();
            cursor.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
    });
}

export async function clearAllMessages(): Promise<void> {
    await tx(STORE_MESSAGES, 'readwrite', s => s.clear() as IDBRequest<any>);
}

/** Drop the oldest messages once a channel exceeds the cap. */
export async function trimChannel(channel: string, max = MAX_STORED_PER_CHANNEL): Promise<void> {
    const total = await countMessages(channel);
    if (total <= max) return;
    const excess = total - max;
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        let removed = 0;
        let transaction: IDBTransaction;
        try {
            transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        } catch {
            resolve();
            return;
        }
        const index = transaction.objectStore(STORE_MESSAGES).index(INDEX_CHANNEL_TS);
        const range = IDBKeyRange.bound([channel], [channel, []]);
        const cursorReq = index.openCursor(range);
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor || removed >= excess) return;
            cursor.delete();
            removed++;
            cursor.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
    });
}

// ---------------------------------------------------------------- meta store

// Used for values that are awkward in localStorage, notably CryptoKey objects,
// which IndexedDB can store directly via structured clone.
export async function metaGet<T = unknown>(key: string): Promise<T | null> {
    const row = await tx<{ key: string; value: T }>(STORE_META, 'readonly', s => s.get(key) as IDBRequest<any>);
    return row ? row.value : null;
}

export async function metaSet(key: string, value: unknown): Promise<boolean> {
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const transaction = db.transaction(STORE_META, 'readwrite');
            transaction.objectStore(STORE_META).put({ key, value });
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => resolve(false);
        } catch {
            resolve(false);
        }
    });
}

// ---------------------------------------------------------------- migration

const MIGRATION_FLAG = 'p2p_chat_idb_migrated';

/**
 * Move any legacy localStorage histories into IndexedDB, once. The old keys are
 * removed afterwards, which is what frees the quota that was breaking writes.
 */
export async function migrateLegacyHistory(): Promise<number> {
    if (localStorage.getItem(MIGRATION_FLAG) === '1') return 0;
    const db = await openDb();
    if (!db) return 0;

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('p2p_chat_history_')) keys.push(k);
    }

    let moved = 0;
    for (const key of keys) {
        const channel = key.slice('p2p_chat_history_'.length);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        let parsed: UserMessage[] = [];
        try {
            const v = JSON.parse(raw);
            if (Array.isArray(v)) parsed = v.filter(m => m && typeof m.id === 'string' && typeof m.timestamp === 'number');
        } catch {
            // A corrupt slice is not worth failing the whole migration over.
        }
        if (parsed.length > 0) {
            const ok = await putMessages(channel, parsed);
            if (!ok) return moved; // leave the rest in place to retry next launch
            moved += parsed.length;
        }
        localStorage.removeItem(key);
    }

    localStorage.setItem(MIGRATION_FLAG, '1');
    if (moved > 0) console.log(`[DB] Migrated ${moved} messages out of localStorage`);
    return moved;
}
