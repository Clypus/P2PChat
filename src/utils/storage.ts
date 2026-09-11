// localStorage helper that survives QuotaExceededError.
//
// Chat history moved to IndexedDB (see utils/db.ts), which removed the main
// source of quota pressure. What is left here is small settings-shaped data,
// but a full origin quota still makes setItem throw, and a throw in a state
// setter takes the app down. Every write goes through this.

export function safeSetItem(key: string, value: string): boolean {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.warn(`[Storage] Write failed for ${key}:`, e);
        return false;
    }
}
