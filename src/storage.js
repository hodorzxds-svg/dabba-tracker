// Drop-in replacement for the window.storage API that Claude artifacts get
// for free. Same async shape, backed by the browser's localStorage instead —
// so data lives on this one device/browser only (no cross-device sync).

export const storage = {
  async get(key) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return null;
      return { key, value };
    } catch (e) {
      console.error("storage.get failed", key, e);
      return null;
    }
  },

  async set(key, value) {
    try {
      localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      console.error("storage.set failed", key, e);
      return null;
    }
  },

  async delete(key) {
    try {
      localStorage.removeItem(key);
      return { key, deleted: true };
    } catch (e) {
      console.error("storage.delete failed", key, e);
      return null;
    }
  },

  async list(prefix = "") {
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
      return { keys, prefix };
    } catch (e) {
      console.error("storage.list failed", prefix, e);
      return null;
    }
  },
};
