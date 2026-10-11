import { createFeed, registerServiceWorker, upcoming, esc, minutesUntil, delayMinutes, formatTime, platformLabel } from "./core.js";

// Optional URL filters, e.g. /anzeige?steig=10,11 or /anzeige?linien=33,47
const params = new URLSearchParams(location.search);
const listParam = (name) => (params.get(name) || "").split(",").map((s) => s.trim()).filter(Boolean);
const onlyLines = new Set(listParam("linien"));
const onlyPlatforms = new Set(listParam("steig").map((p) => `H.${p.replace(/^H\./i, "")}`));

const TICKER_SPEED = 90; // px per second

const $ = (id) => document.getElementById(id);
let tickerKey = "";

if (onlyPlatforms.size) {
  const list = [...onlyPlatforms].map(platformLabel).join(", ");
  $("title").textContent = `Bushof · Steig ${list}`;
  document.title = `Bushof · Steig ${list}`;
}

function tickClock() {
  const now = new Date();
  const [hm, sec] = [formatTime(now), String(now.getSeconds()).padStart(2, "0")];
  $("clock").innerHTML = `${hm}<span class="sec">:${sec}</span>`;
  $("clock").dateTime = now.toISOString();
}

function rowHtml(d, now) {
  const mins = minutesUntil(d.departureTimeMs, now);
  const delay = delayMinutes(d);
  const state = d.isCancelled ? " is-cancelled" : mins === 0 ? " is-now" : "";
  const when = d.isCancelled ? "fällt aus" : mins === 0 ? "sofort" : `${mins}<span class="u">min</span>`;
  return `
    <li class="row${state}">
      <span class="line">${esc(d.line)}</span>
      <span class="dest">${esc(d.destination)}${!d.isCancelled && delay > 0 ? `<span class="late">+${delay}</span>` : ""}</span>
      <span class="c plat${d.platformChanged ? " is-changed" : ""}">${esc(platformLabel(d.platform))}</span>
      <span class="r min">${when}</span>
    </li>`;
}

// Hide rows that would be cut off at the bottom of the screen
function fitRows(list) {
  const bottom = list.getBoundingClientRect().bottom;
  for (const row of list.children) {
    row.classList.toggle("is-hidden", row.getBoundingClientRect().bottom > bottom + 1);
  }
}

function renderTicker(messages, lines) {
  const relevant = messages.filter((m) => m.lines.some((l) => lines.has(l)));
  const key = relevant.map((m) => m.id).join();
  if (key === tickerKey) return;
  tickerKey = key;

  if (!relevant.length) {
    $("ticker").innerHTML = "";
    return;
  }
  const text = relevant.map((m) => `${m.lines.length ? `Linie ${m.lines.join(", ")}: ` : ""}${m.title}`).join("   +++   ");
  $("ticker").innerHTML = `<div class="ticker"><span class="ticker-track">+++ ${esc(text)} +++</span></div>`;
  const track = $("ticker").querySelector(".ticker-track");
  track.style.animationDuration = `${Math.round(track.offsetWidth / TICKER_SPEED)}s`;
}

function render(state) {
  const status = $("status");
  status.classList.toggle("is-stale", !!state.error || state.stale);
  status.textContent = state.error
    ? `${state.error}${state.fetchedAt ? ` · Stand ${formatTime(state.fetchedAt)}` : ""}`
    : state.fetchedAt ? `Stand ${formatTime(state.fetchedAt)}` : "Verbinde …";
  if (state.loading) return;

  const now = Date.now();
  const departures = upcoming(state.departures, now).filter(
    (d) => (!onlyLines.size || onlyLines.has(d.line)) && (!onlyPlatforms.size || onlyPlatforms.has(d.platform)),
  );

  // Ticker first: it changes the space left for rows
  renderTicker(state.messages || [], new Set(departures.map((d) => d.line)));

  const list = $("rows");
  if (!state.fetchedAt) {
    list.innerHTML = `<li class="message">Abfahrten werden geladen, sobald eine Verbindung besteht.</li>`;
  } else if (!departures.length) {
    list.innerHTML = `<li class="message">Zurzeit keine Abfahrten.</li>`;
  } else {
    list.innerHTML = departures.slice(0, 40).map((d) => rowHtml(d, now)).join("");
    fitRows(list);
  }
}

// Display helpers: fullscreen on click, hide idle cursor, keep screen awake

document.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
});

let cursorTimer = null;
document.addEventListener("mousemove", () => {
  document.body.classList.remove("hide-cursor");
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add("hide-cursor"), 3_000);
});

async function keepAwake() {
  try {
    if (document.visibilityState === "visible") await navigator.wakeLock?.request("screen");
  } catch {}
}
document.addEventListener("visibilitychange", keepAwake);
keepAwake();

tickClock();
setInterval(tickClock, 1_000);
let lastState = null;
createFeed((state) => {
  lastState = state;
  render(state);
});
window.addEventListener("resize", () => lastState && render(lastState));
registerServiceWorker();
