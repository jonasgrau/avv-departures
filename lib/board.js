"use strict";

const { DEFAULT_STATION, fetchStationBoard, fetchMessages, searchStations, isStationId } = require("./hafas");
const { demoBoard, demoSearch } = require("./demo");

const BOARD_TTL_MS = 15_000;
const MESSAGES_TTL_MS = 5 * 60_000;
const SEARCH_TTL_MS = 24 * 60 * 60_000;
const MAX_STATIONS = 200;
const MAX_SEARCHES = 500;

// Small LRU: Map keeps insertion order, so re-inserting marks an entry as fresh
function lruGet(map, key) {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key);
    map.set(key, value);
  }
  return value;
}

function lruSet(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
}

// Per station: { board, messages, inflight }
const stations = new Map();

function entryFor(id) {
  let entry = lruGet(stations, id);
  if (!entry) {
    entry = { board: null, messages: { list: [], fetchedAt: 0 }, inflight: null };
    lruSet(stations, id, entry, MAX_STATIONS);
  }
  return entry;
}

async function refresh(id, entry) {
  const { station, departures, linesByMessage } = await fetchStationBoard(id);
  entry.board = { station: station || { id, name: "" }, departures, fetchedAt: Date.now() };

  if (Date.now() - entry.messages.fetchedAt > MESSAGES_TTL_MS) {
    try {
      entry.messages = { list: await fetchMessages(linesByMessage), fetchedAt: Date.now() };
    } catch (err) {
      // Disruption messages are optional, departures still go out
      console.error("Messages fetch failed:", err.message);
    }
  }
}

async function getBoard(id = DEFAULT_STATION) {
  if (process.env.DEMO === "1") return demoBoard(id);

  const entry = entryFor(id);
  if (!entry.board || Date.now() - entry.board.fetchedAt > BOARD_TTL_MS) {
    entry.inflight ??= refresh(id, entry).finally(() => (entry.inflight = null));
    try {
      await entry.inflight;
    } catch (err) {
      console.error(`Departures fetch failed for ${id}:`, err.message);
      if (!entry.board) throw err;
      return { ...entry.board, messages: entry.messages.list, stale: true };
    }
  }
  return { ...entry.board, messages: entry.messages.list, stale: false };
}

const searches = new Map(); // normalized query -> { stations, fetchedAt }

async function findStations(query) {
  if (process.env.DEMO === "1") return demoSearch(query);

  const key = query.toLocaleLowerCase("de");
  const cached = lruGet(searches, key);
  if (cached && Date.now() - cached.fetchedAt < SEARCH_TTL_MS) return cached.stations;

  const stations = await searchStations(query);
  lruSet(searches, key, { stations, fetchedAt: Date.now() }, MAX_SEARCHES);
  return stations;
}

function sendJson(res, status, data, cacheControl) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(data));
}

const queryOf = (req) => new URL(req.url, "http://localhost").searchParams;

// GET /api/departures?station=1001 (shared by the local server and Vercel)
async function handleDeparturesRequest(req, res) {
  const id = queryOf(req).get("station") || DEFAULT_STATION;
  if (!isStationId(id)) return sendJson(res, 400, { error: "Ungültige Haltestelle" }, "no-store");

  try {
    const data = await getBoard(id);
    sendJson(res, 200, data, "public, max-age=0, s-maxage=15, stale-while-revalidate=30");
  } catch (err) {
    if (err.code === "LOCATION") return sendJson(res, 404, { error: "Haltestelle nicht gefunden" }, "no-store");
    sendJson(res, 502, { error: "Fahrplandaten nicht erreichbar" }, "no-store");
  }
}

// GET /api/stations?q=Ponttor
async function handleStationsRequest(req, res) {
  const query = (queryOf(req).get("q") || "").trim().slice(0, 60);
  if (query.length < 2) return sendJson(res, 200, { stations: [] }, "no-store");

  try {
    const stations = await findStations(query);
    sendJson(res, 200, { stations }, "public, max-age=3600, s-maxage=86400");
  } catch (err) {
    console.error("Station search failed:", err.message);
    sendJson(res, 502, { error: "Suche gerade nicht möglich" }, "no-store");
  }
}

module.exports = { getBoard, findStations, handleDeparturesRequest, handleStationsRequest };
