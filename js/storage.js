// Small localStorage wrapper. Every access is guarded: private windows or
// blocked storage fall back to in-memory state so the game still works.
const mem = {};
const PREFIX = 'splice.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw != null) return JSON.parse(raw);
  } catch { /* ignore */ }
  return key in mem ? mem[key] : fallback;
}

export function save(key, value) {
  mem[key] = value;
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* ignore */ }
}
