import {
  createFeed, registerServiceWorker, upcoming, compareLines, esc, formatTime, readList, writeList,
  DEFAULT_STATION, currentStation, stationUrl, recentStations, rememberStation,
} from "./core.js";
import { departureRow, noticeText, setTicker } from "./led.js";
import { setupSearch } from "./search.js";

const MAX_ROWS = 40;
const stationId = currentStation();
// The line filter is remembered per station; the Bushof keeps its original key
const LINES_KEY = stationId === DEFAULT_STATION ? "bushof.lines" : `bushof.lines.${stationId}`;

const $ = (id) => document.getElementById(id);

let feed = null;
let latest = null;
let selected = new Set(readList(LINES_KEY));
let renderedChips = "";
let renderedNotices = "";
let shownStation = "";
let remembered = false;

function tickClock() {
  const now = new Date();
  $("clock").textContent = formatTime(now);
  $("clock").dateTime = now.toISOString();
}

// Station name in the header and the tab title

function showStation(name) {
  if (!name || name === shownStation) return;
  shownStation = name;
  $("station-name").textContent = name;
  document.title = `${name} · Abfahrten`;
}

// Status line, only shown when live data is missing

function renderStatus(state) {
  const status = $("status");
  const problem = state.notFound ? null : state.error || (state.stale ? "Live-Daten gerade nicht erreichbar" : null);
  status.hidden = !problem;
  if (problem) {
    status.querySelector(".status-text").textContent = state.fetchedAt ? `${problem} · Stand ${formatTime(state.fetchedAt)}` : problem;
  }
}

// Disruption notices: ticker plus expandable list

function renderNotices(messages) {
  const relevant = selected.size ? messages.filter((m) => m.lines.some((l) => selected.has(l))) : messages;
  const key = relevant.map((m) => m.id).join() + "|" + selected.size;
  if (key === renderedNotices) return;
  renderedNotices = key;

  $("notices").hidden = !relevant.length;
  if (!relevant.length) return;

  setTicker($("ticker"), noticeText(relevant));
  const count = relevant.length === 1 ? "1 Hinweis" : `${relevant.length} Hinweise`;
  $("notice-summary").textContent = `${count} ${selected.size ? "für deine Linien" : "zu Umleitungen und Baustellen"}`;
  $("notice-items").innerHTML = relevant.map((m) => `
    <li>
      <details>
        <summary>${m.lines.length ? `<span class="notice-lines">${esc(m.lines.join(" "))}</span> · ` : ""}${esc(m.title)}</summary>
        <p class="notice-text">${esc(m.text)}</p>
      </details>
    </li>`).join("");
}

// Line filter: a summary button that opens a grid with all lines

function filterSummary() {
  const lines = [...selected].sort(compareLines);
  if (!lines.length) return "Alle Linien";
  if (lines.length === 1) return `Linie ${lines[0]}`;
  if (lines.length <= 4) return `Linien ${lines.join(", ")}`;
  return `${lines.length} Linien`;
}

function renderFilters(departures) {
  $("filter-toggle").textContent = filterSummary();
  $("filter-clear").hidden = !selected.size;

  const lines = [...new Set([...departures.map((d) => d.line), ...selected])].sort(compareLines);
  const key = lines.join() + "|" + [...selected].join();
  if (key === renderedChips) return;
  renderedChips = key;

  $("filters").innerHTML = lines
    .map((l) => `<button type="button" class="chip" data-line="${esc(l)}" aria-pressed="${selected.has(l)}">${esc(l)}</button>`)
    .join("");
}

function setFilterOpen(open) {
  $("filter-toggle").setAttribute("aria-expanded", open);
  $("filter-panel").hidden = !open;
}

function setSelection(lines) {
  selected = new Set(lines);
  writeList(LINES_KEY, [...selected]);
  if (latest) render(latest);
}

function onFilterClick(event) {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  const line = chip.dataset.line;
  const next = new Set(selected);
  if (next.has(line)) next.delete(line);
  else next.add(line);
  setSelection(next);
}

// Departure board

function renderRows(state, departures) {
  const rows = $("rows");
  rows.setAttribute("aria-busy", "false");

  if (state.notFound) {
    rows.innerHTML = `<li class="placeholder">Haltestelle nicht gefunden<br><a href="/">Zum Bushof</a></li>`;
    return;
  }
  if (!state.fetchedAt) {
    rows.innerHTML = `<li class="placeholder">Bitte Aushang beachten<br><button type="button" data-retry>Erneut versuchen</button></li>`;
    return;
  }
  const now = Date.now();
  const shown = departures.filter((d) => !selected.size || selected.has(d.line)).slice(0, MAX_ROWS);
  if (shown.length) {
    rows.innerHTML = shown.map((d) => departureRow(d, now)).join("");
  } else if (selected.size) {
    rows.innerHTML = `<li class="placeholder">Zurzeit keine Abfahrten für ${esc(filterSummary())}<br><button type="button" data-reset>Alle Linien zeigen</button></li>`;
  } else {
    rows.innerHTML = `<li class="placeholder">Zurzeit keine Abfahrten</li>`;
  }
}

function render(state) {
  latest = state;
  renderStatus(state);
  if (state.loading) return;

  if (state.station?.name) {
    if (!remembered) rememberStation(state.station);
    remembered = true;
    showStation(state.station.name);
  }

  const departures = upcoming(state.departures);
  renderFilters(departures);
  renderNotices(state.messages || []);
  renderRows(state, departures);
}

// Show a known name right away instead of the Bushof placeholder
showStation(recentStations().find((s) => s.id === stationId)?.name || (stationId === DEFAULT_STATION ? "Aachen, Bushof" : "Haltestelle"));
$("display-link").href = stationUrl("/anzeige", stationId);
setupSearch({
  input: $("search-input"),
  list: $("search-results"),
  currentId: stationId,
  onSelect: (station) => {
    if (station.id !== stationId) location.href = stationUrl("/", station.id);
  },
});

tickClock();
setInterval(tickClock, 1_000);
$("filters").addEventListener("click", onFilterClick);
$("filter-toggle").addEventListener("click", () => setFilterOpen($("filter-panel").hidden));
$("filter-clear").addEventListener("click", () => setSelection([]));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("filter-panel").hidden) {
    setFilterOpen(false);
    $("filter-toggle").focus();
  }
});
$("rows").addEventListener("click", (event) => {
  if (event.target.closest("[data-retry]")) feed.reload();
  if (event.target.closest("[data-reset]")) setSelection([]);
});
feed = createFeed(render, stationId);
registerServiceWorker();
