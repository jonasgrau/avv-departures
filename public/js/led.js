// LED board rendering shared by the main view and the display mode
import { esc, minutesUntil, formatTime, platformLabel } from "./core.js";

const MAX_MINUTES = 59; // later departures show the clock time instead

// Like the real displays: minutes for live departures, clock time for
// timetable-only or later departures
export function whenText(d, now = Date.now()) {
  if (d.isCancelled) return "";
  const mins = minutesUntil(d.departureTimeMs, now);
  if (mins === 0) return "sofort";
  if (!d.isRealtime || mins > MAX_MINUTES) return formatTime(d.departureTimeMs);
  return `${mins} min`;
}

// "H.10" at bus stops becomes "H10", train platforms become "Gl6"
export function platformText(d) {
  if (!d.platform) return "";
  if (d.isTrain) return `Gl${d.platform}`;
  return d.platform.replace(/^H\./, "H");
}

function spokenLabel(d, now) {
  const mins = minutesUntil(d.departureTimeMs, now);
  const when = d.isCancelled ? "fällt aus" : mins === 0 ? "fährt jetzt ab" : `in ${mins} Minuten`;
  const changed = d.platformChanged ? " (geändert)" : "";
  const where = d.platform ? `, ${d.isTrain ? "Gleis" : "Steig"} ${platformLabel(d.platform)}${changed}` : "";
  return `Linie ${d.line} nach ${d.destination}${where}, ${when}`;
}

export function departureRow(d, now = Date.now(), tag = "li") {
  return `
    <${tag} class="dep">
      <span class="sr-only">${esc(spokenLabel(d, now))}</span>
      <span class="dep-line" aria-hidden="true">${esc(d.line)}</span>
      <span class="dep-dest" aria-hidden="true">${d.isCancelled ? "Fahrt fällt aus" : esc(d.destination)}</span>
      <span class="dep-plat${d.platformChanged ? " is-changed" : ""}" aria-hidden="true">${esc(platformText(d))}</span>
      <span class="dep-when" aria-hidden="true">${whenText(d, now)}</span>
    </${tag}>`;
}

export function noticeText(messages) {
  return messages.map((m) => `${m.lines.length ? `Linie ${m.lines.join(", ")}: ` : ""}${m.title}`).join("  +++  ");
}

// Scrolling text at a constant speed in font sizes per second
export function setTicker(el, text, speed = 2.2) {
  el.innerHTML = `<span class="ticker-track">${esc(text)}</span>`;
  const track = el.firstElementChild;
  const fontSize = parseFloat(getComputedStyle(track).fontSize);
  track.style.animationDuration = `${Math.max(4, Math.round(track.offsetWidth / (fontSize * speed)))}s`;
}

// Hide rows that would be cut off at the bottom of a fixed-height board
export function fitRows(list) {
  const bottom = list.getBoundingClientRect().bottom;
  for (const row of list.children) {
    row.style.visibility = row.getBoundingClientRect().bottom > bottom + 1 ? "hidden" : "";
  }
}
