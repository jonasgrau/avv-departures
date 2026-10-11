// Station search: combobox with suggestions and recently used stations
import { esc, recentStations } from "./core.js";

const DEBOUNCE_MS = 200;

export function setupSearch({ input, list, currentId, onSelect }) {
  let items = [];
  let active = -1;
  let timer = null;
  let controller = null;

  function open(newItems, heading) {
    items = newItems;
    active = -1;
    input.removeAttribute("aria-activedescendant");
    if (!items.length && !heading) return close();

    list.innerHTML =
      (heading ? `<li class="search-heading" role="presentation">${esc(heading)}</li>` : "") +
      items.map((s, i) => `
        <li class="search-option${s.id === currentId ? " is-current" : ""}" role="option" id="station-option-${i}"
          data-index="${i}" aria-selected="false">${esc(s.name)}</li>`).join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function showRecent() {
    const recent = recentStations();
    if (recent.length) open(recent, "Zuletzt angesehen");
    else close();
  }

  function highlight(index) {
    const options = list.querySelectorAll(".search-option");
    if (!options.length) return;
    active = (index + options.length) % options.length;
    options.forEach((el, i) => el.setAttribute("aria-selected", i === active));
    input.setAttribute("aria-activedescendant", options[active].id);
    options[active].scrollIntoView({ block: "nearest" });
  }

  async function search(query) {
    controller?.abort();
    controller = new AbortController();
    try {
      const res = await fetch(`/api/stations?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (input.value.trim() !== query) return;
      open(data.stations, data.stations.length ? null : "Keine Haltestelle im AVV gefunden");
    } catch (err) {
      if (err.name !== "AbortError") open([], "Suche gerade nicht möglich");
    }
  }

  function choose(index) {
    const station = items[index];
    if (!station) return;
    close();
    input.blur();
    onSelect(station);
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) return showRecent();
    timer = setTimeout(() => search(query), DEBOUNCE_MS);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim().length < 2) showRecent();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (list.hidden) input.value.trim().length < 2 ? showRecent() : search(input.value.trim());
      else highlight(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight(active - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active >= 0 ? active : 0);
    } else if (event.key === "Escape") {
      if (!list.hidden) close();
      else input.value = "";
    }
  });

  // mousedown keeps focus in the input until the choice is made
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const option = event.target.closest(".search-option");
    if (option) choose(Number(option.dataset.index));
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search")) close();
  });
}
