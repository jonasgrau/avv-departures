// Shared data loading and formatting for the main view and the display mode

const REFRESH_MS = 30_000;
const STALE_AFTER_MS = 2 * 60_000;

export const compareLines = (a, b) => a.localeCompare(b, "de", { numeric: true });

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export const minutesUntil = (ms, now = Date.now()) => Math.max(0, Math.floor((ms - now) / 60_000));
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
