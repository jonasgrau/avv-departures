// Shared data loading and formatting for the main view and the display mode

const REFRESH_MS = 30_000;
const STALE_AFTER_MS = 2 * 60_000;

const LINE_COLORS = {
  1: "#e53935", 2: "#1e88e5", 4: "#43a047", 5: "#8e24aa", 7: "#00897b",
  11: "#f4511e", 12: "#1e88e5", 14: "#6d4c41", 15: "#ad1457", 16: "#283593",
  17: "#00838f", 21: "#c62828", 22: "#6d4c41", 23: "#558b2f", 24: "#00897b",
  25: "#3949ab", 27: "#9e9d24", 31: "#ef6c00", 33: "#c62828", 34: "#ad1457",
  35: "#6a1b9a", 36: "#1565c0", 37: "#4e342e", 41: "#00838f", 43: "#558b2f",
  44: "#00838f", 45: "#2e7d32", 46: "#283593", 47: "#9e9d24", 51: "#ef6c00",
  52: "#4e342e", 53: "#1565c0", 54: "#ad1457", 55: "#283593", 65: "#6a1b9a",
  66: "#c62828", 73: "#558b2f", 74: "#9e9d24", 75: "#00897b",
};

export function lineColor(line) {
  if (/^N\d/.test(line)) return "#37474f";
  if (/^SB/.test(line)) return "#e65100";
  if (/^X/.test(line)) return "#b71c1c";
  return LINE_COLORS[line.replace(/[EV]$/, "")] || "#3a5fcd";
}

export const compareLines = (a, b) => a.localeCompare(b, "de", { numeric: true });

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export const minutesUntil = (ms, now = Date.now()) => Math.max(0, Math.floor((ms - now) / 60_000));
export const delayMinutes = (d) => Math.round((d.departureTimeMs - d.scheduledTimeMs) / 60_000);
export const platformLabel = (p) => String(p || "").replace(/^H\./, "") || "–";

const timeFormat = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
export const formatTime = (ms) => timeFormat.format(ms);

// Departures that have not left yet (with a short grace period)
export function upcoming(departures, now = Date.now()) {
  return departures.filter((d) => d.departureTimeMs >= now - 30_000);
}

export function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

/**
 * Polls /api/departures and calls onChange with
 * { departures, messages, fetchedAt, loading, error, stale }.
 */
export function createFeed(onChange) {
  const state = { departures: [], messages: [], fetchedAt: null, loading: true, error: null, stale: false };
  let timer = null;

  const emit = () => {
    state.stale = !!state.fetchedAt && (state.stale || Date.now() - state.fetchedAt > STALE_AFTER_MS);
    onChange({ ...state });
  };

  async function load() {
    clearTimeout(timer);
    // Background tabs skip polling; visibilitychange reloads on return
    if (document.visibilityState === "hidden" && state.fetchedAt) {
      timer = setTimeout(load, REFRESH_MS);
      return;
    }
    try {
      const res = await fetch("/api/departures", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      Object.assign(state, data, { loading: false, error: null });
    } catch (err) {
      state.loading = false;
      state.error = navigator.onLine === false ? "Keine Internetverbindung" : "Live-Daten gerade nicht erreichbar";
    }
    emit();
    timer = setTimeout(load, REFRESH_MS);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });
  window.addEventListener("online", load);
  setInterval(emit, 5_000);
  load();

  return { reload: load };
}

export function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
