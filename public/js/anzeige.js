import { createFeed, registerServiceWorker, upcoming, formatTime, platformLabel } from "./core.js";
import { departureRow, noticeText, setTicker, fitRows } from "./led.js";

// Optional URL filters, e.g. /anzeige?steig=10,11 or /anzeige?linien=33,47
const params = new URLSearchParams(location.search);
const listParam = (name) => (params.get(name) || "").split(",").map((s) => s.trim()).filter(Boolean);
const onlyLines = new Set(listParam("linien"));
const onlyPlatforms = new Set(listParam("steig").map((p) => `H.${p.replace(/^H\./i, "")}`));

const $ = (id) => document.getElementById(id);
let tickerKey = "";

const stationName = onlyPlatforms.size
  ? `Bushof Steig ${[...onlyPlatforms].map(platformLabel).join(", ")}`
  : "Aachen Bushof";
$("title").textContent = `Abfahrten ${stationName}`;
document.title = `${stationName} · Anzeige`;
// A board for a single platform does not need the platform column
document.querySelector(".panel").classList.toggle("no-plat", onlyPlatforms.size === 1);

function tickClock() {
  const now = new Date();
  $("clock").textContent = formatTime(now);
  $("clock").dateTime = now.toISOString();
}

function renderTicker(state, lines) {
  let text = "";
  if (state.error || state.stale) {
    text = `Keine Verbindung${state.fetchedAt ? ` · Stand ${formatTime(state.fetchedAt)}` : ""}`;
  } else {
    text = noticeText((state.messages || []).filter((m) => m.lines.some((l) => lines.has(l))));
  }
  if (text === tickerKey) return;
  tickerKey = text;

  const ticker = $("ticker");
  if (!text || state.error || state.stale) {
    ticker.textContent = text || stationName;
    return;
  }
  setTicker(ticker, text);
}

function render(state) {
  if (state.loading) return;

  const now = Date.now();
  const departures = upcoming(state.departures, now).filter(
    (d) => (!onlyLines.size || onlyLines.has(d.line)) && (!onlyPlatforms.size || onlyPlatforms.has(d.platform)),
  );

  renderTicker(state, new Set(departures.map((d) => d.line)));

  const list = $("rows");
  if (!state.fetchedAt) {
    list.innerHTML = `<li class="message">Bitte Aushang beachten</li>`;
  } else if (!departures.length) {
    list.innerHTML = `<li class="message">Zurzeit keine Abfahrten</li>`;
  } else {
    list.innerHTML = departures.slice(0, 40).map((d) => departureRow(d, now)).join("");
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
window.addEventListener("resize", () => {
  tickerKey = "";
  if (lastState) render(lastState);
});
registerServiceWorker();
