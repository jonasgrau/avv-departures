import {
  createFeed, registerServiceWorker, upcoming, lineColor, compareLines, esc,
  minutesUntil, delayMinutes, formatTime, platformLabel, readList, writeList,
} from "./core.js";

const MAX_ROWS = 40;
const LINES_KEY = "bushof.lines";
const THEME_KEY = "bushof.theme";

const $ = (id) => document.getElementById(id);

let feed = null;
let latest = null;
let selected = new Set(readList(LINES_KEY));
let renderedChips = "";
let renderedMessages = "";

const badge = (line, cls = "") =>
  `<span class="badge ${cls}" style="background:${lineColor(line)}">${esc(line)}</span>`;

// Clock

function tickClock() {
  const clock = $("clock");
  clock.textContent = formatTime(Date.now());
  clock.dateTime = new Date().toISOString();
}

// Theme: system → light → dark

const THEMES = ["system", "light", "dark"];
const THEME_LABELS = { system: "System", light: "Hell", dark: "Dunkel" };

function setupTheme() {
  const button = $("theme");
  let theme = document.documentElement.dataset.theme || "system";
  const show = () => (button.textContent = `Darstellung: ${THEME_LABELS[theme]}`);
  show();
  button.addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {}
    show();
  });
}

// Status line and connection alerts

function renderStatus(state) {
  const status = $("status");
  status.classList.toggle("is-error", !!state.error && !state.fetchedAt);
  status.classList.toggle("is-stale", state.stale || (!!state.error && !!state.fetchedAt));

  let text = "Verbinde …";
  if (state.fetchedAt) text = state.stale || state.error ? `Stand ${formatTime(state.fetchedAt)}` : "Live";
  else if (state.error) text = "Offline";
  status.querySelector(".status-text").textContent = text;

  const problem = state.error || (state.stale ? "Live-Daten gerade nicht erreichbar" : null);
  $("alert").innerHTML = problem
    ? `<div class="alert"><strong>${esc(problem)}.</strong> ${
        state.fetchedAt ? `Angezeigt wird der Stand von ${formatTime(state.fetchedAt)} Uhr.` : "Wir versuchen es gleich erneut."
      }</div>`
    : "";
}

// Disruption messages

function renderMessages(messages) {
  const relevant = selected.size ? messages.filter((m) => m.lines.some((l) => selected.has(l))) : messages;
  const key = relevant.map((m) => m.id).join() + "|" + selected.size;
  if (key === renderedMessages) return;
  renderedMessages = key;

  if (!relevant.length) {
    $("messages").innerHTML = "";
    return;
  }
  const count = relevant.length === 1 ? "1 Hinweis" : `${relevant.length} Hinweise`;
  const scope = selected.size ? "für deine Linien" : "zu Umleitungen und Baustellen";
  $("messages").innerHTML = `
    <details class="messages">
      <summary><span class="messages-icon" aria-hidden="true">⚠</span>${count} ${scope}</summary>
      <ul class="messages-list">
        ${relevant.map((m) => `
          <li class="message">
            <details>
              <summary>
                <span class="message-lines">${m.lines.slice(0, 8).map((l) => badge(l)).join("")}</span>
                <span>${esc(m.title)}</span>
              </summary>
              <p class="message-text">${esc(m.text)}</p>
            </details>
          </li>`).join("")}
      </ul>
    </details>`;
}

// Line filter

function renderFilters(departures) {
  const lines = [...new Set([...departures.map((d) => d.line), ...selected])].sort(compareLines);
  const key = lines.join() + "|" + [...selected].join();
  if (key === renderedChips) return;
  const firstRender = !renderedChips;
  renderedChips = key;

  const filters = $("filters");
  filters.innerHTML =
    `<button type="button" class="chip" data-line="" aria-pressed="${selected.size === 0}">Alle Linien</button>` +
    lines.map((l) => `
      <button type="button" class="chip" data-line="${esc(l)}" aria-pressed="${selected.has(l)}">
        <span class="chip-swatch" style="background:${lineColor(l)}" aria-hidden="true"></span>${esc(l)}
      </button>`).join("");

  // Saved lines may sit far right in the scrollable bar, so bring them into view once
  const firstSelected = filters.querySelector('.chip[aria-pressed="true"]:not([data-line=""])');
  if (firstRender && firstSelected) filters.scrollLeft = firstSelected.offsetLeft - filters.offsetLeft - 60;
}

function onFilterClick(event) {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  const line = chip.dataset.line;
  if (!line) selected.clear();
  else if (selected.has(line)) selected.delete(line);
  else selected.add(line);
  writeList(LINES_KEY, [...selected]);
  if (latest) render(latest);
}

// Departure rows

function rowHtml(d, now) {
  const mins = minutesUntil(d.departureTimeMs, now);
  const delay = delayMinutes(d);

  const when = !d.isCancelled && mins === 0
    ? `<span class="mins is-now">jetzt</span>`
    : `<span class="mins">${mins}<small>min</small></span>`;

  const meta = [];
  if (d.isCancelled) meta.push(`<span class="cancel">Fällt aus</span>`);
  meta.push(`<span>${formatTime(d.scheduledTimeMs)}</span>`);
  if (!d.isCancelled && delay > 0) meta.push(`<span class="late">+${delay} min</span>`);
  if (!d.isCancelled && delay < 0) meta.push(`<span class="late">${delay} min früher</span>`);
  if (!d.isRealtime && !d.isCancelled) meta.push(`<span class="plan">Fahrplan</span>`);

  const label = [
    `Linie ${d.line} nach ${d.destination}`,
    d.isCancelled ? "fällt aus" : mins === 0 ? "fährt jetzt" : `in ${mins} Minuten`,
    `Steig ${platformLabel(d.platform)}${d.platformChanged ? ", Steig geändert" : ""}`,
    delay > 0 && !d.isCancelled ? `${delay} Minuten Verspätung` : "",
  ].filter(Boolean).join(", ");

  return `
    <li class="row${d.isCancelled ? " is-cancelled" : ""}">
      <span class="sr-only">${esc(label)}</span>
      <span aria-hidden="true">${when}</span>
      <span class="badge-cell" aria-hidden="true">${badge(d.line)}</span>
      <div aria-hidden="true">
        <div class="dest">${badge(d.line, "badge-inline")}<span>${esc(d.destination)}</span></div>
        <div class="meta">${meta.join("")}</div>
      </div>
      <div class="plat${d.platformChanged ? " is-changed" : ""}" aria-hidden="true">
        <span class="plat-label">Steig</span>${esc(platformLabel(d.platform))}${d.platformChanged ? `<span class="plat-note">geändert</span>` : ""}
      </div>
    </li>`;
}

function renderRows(departures) {
  const rows = $("rows");
  rows.setAttribute("aria-busy", "false");
  const now = Date.now();
  const shown = departures.filter((d) => !selected.size || selected.has(d.line)).slice(0, MAX_ROWS);

  if (shown.length) {
    rows.innerHTML = shown.map((d) => rowHtml(d, now)).join("");
  } else if (selected.size) {
    rows.innerHTML = `<li class="empty">Für die gewählten Linien fährt gerade nichts.<br><button type="button" class="link-button" data-reset>Alle Linien zeigen</button></li>`;
  } else {
    rows.innerHTML = `<li class="empty">Gerade keine Abfahrten.</li>`;
  }
}

function render(state) {
  latest = state;
  tickClock();
  renderStatus(state);
  if (state.loading) return;

  const departures = upcoming(state.departures);
  renderFilters(departures);
  renderMessages(state.messages || []);
  if (!state.fetchedAt) {
    $("rows").innerHTML = `<li class="empty">Abfahrten können gerade nicht geladen werden.<br><button type="button" class="link-button" data-retry>Erneut versuchen</button></li>`;
    return;
  }
  renderRows(departures);
}

setupTheme();
tickClock();
setInterval(tickClock, 1_000);
$("filters").addEventListener("click", onFilterClick);
$("rows").addEventListener("click", (event) => {
  if (event.target.closest("[data-retry]")) feed.reload();
  if (event.target.closest("[data-reset]")) {
    selected.clear();
    writeList(LINES_KEY, []);
    render(latest);
  }
});
feed = createFeed(render);
registerServiceWorker();
