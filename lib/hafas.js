"use strict";

// Client for the AVV HAFAS endpoint (mgate.exe) used by auskunft.avv.de

const HAFAS_URL = "https://auskunft.avv.de/bin/mgate.exe";
const DEFAULT_STATION = "1001"; // Aachen Bushof

// Rough bounding box of the AVV area (Aachen, Städteregion, Düren, Heinsberg)
// including stops just across the Belgian and Dutch border
const AVV_AREA = { minLat: 50.45, maxLat: 51.2, minLon: 5.9, maxLon: 6.7 };
const CLIENT = {
  client: { type: "WEB", id: "AVV_AACHEN", name: "webapp" },
  ver: "1.26",
  lang: "deu",
  auth: { type: "AID", aid: "4vV1AcH3N511icH" },
};

async function hafasRequest(svcReq, timeoutMs = 10000) {
  const res = await fetch(HAFAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...CLIENT, svcReqL: [svcReq] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return unwrap(await res.json());
}

function unwrap(data) {
  if (data.err !== "OK") throw new Error(`HAFAS: ${data.errTxt || data.err}`);
  const svc = data.svcResL?.[0];
  if (!svc || svc.err !== "OK") {
    const err = new Error(`HAFAS: ${svc?.errTxt || svc?.err || "empty response"}`);
    err.code = svc?.err; // e.g. "LOCATION" for unknown stations
    throw err;
  }
  return svc.res;
}

// HAFAS returns local Berlin time as YYYYMMDD + HHMMSS; hours may exceed 23
// for trips after midnight that belong to the previous operating day.
function hafasTimeToMs(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const t = timeStr.padStart(6, "0");
  const asUtc = Date.UTC(
    +dateStr.slice(0, 4),
    +dateStr.slice(4, 6) - 1,
    +dateStr.slice(6, 8),
    +t.slice(0, -4),
    +t.slice(-4, -2),
    +t.slice(-2),
  );
  return asUtc - berlinOffsetMs(asUtc);
}

const berlinFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

function berlinOffsetMs(utcMs) {
  const p = Object.fromEntries(berlinFormat.formatToParts(new Date(utcMs)).map((x) => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

const isStationId = (id) => /^\d{1,9}$/.test(String(id));
const stationLid = (id) => `A=1@L=${id}@`;

// HAFAS mixes "Aachen, Bushof" and "Ponttor, AC"; spell out the city
function stationName(name) {
  return String(name || "").replace(/, AC$/, ", Aachen").trim();
}

// "H.3 (Dunantstr.)" -> { code: "H.3", note: "Dunantstr." }. A cut-off
// note like "H.3 (Dun" is dropped instead of shown half.
function splitPlatform(text) {
  const match = String(text || "").trim().match(/^(.*?)\s*\(([^)]*)(\))?\s*$/);
  if (!match) return { code: String(text || "").trim(), note: "" };
  return { code: match[1], note: match[3] ? match[2].trim() : "" };
}

// HAFAS cuts the realtime platform text to 8 bytes ("H.3 (Dun", ".2 (Rö").
// Such a fragment of the scheduled text is not a platform change.
function resolvePlatform(scheduledText, realtimeText) {
  const scheduled = splitPlatform(scheduledText);
  if (!scheduledText) return { ...splitPlatform(realtimeText), changed: false };
  if (!realtimeText || scheduledText.includes(realtimeText)) return { ...scheduled, changed: false };
  const realtime = splitPlatform(realtimeText);
  return { code: realtime.code, note: realtime.note, changed: realtime.code !== scheduled.code };
}

function parseStationBoard(res) {
  const prodL = res.common?.prodL || [];
  const loc = res.common?.locL?.[0];
  const departures = [];

  for (const jny of res.jnyL || []) {
    const stop = jny.stbStop || {};
    const prod = prodL[stop.dProdX ?? jny.prodX] || {};
    const date = jny.date || res.sD;
    const scheduledTimeMs = hafasTimeToMs(date, stop.dTimeS);
    if (scheduledTimeMs === null) continue;

    const realtimeMs = hafasTimeToMs(date, stop.dTimeR);
    const platform = resolvePlatform(stop.dPltfS?.txt, stop.dPltfR?.txt);

    departures.push({
      id: jny.jid,
      line: prod.nameS || prod.number || prod.name || "?",
      destination: jny.dirTxt || "",
      platform: platform.code,
      // Street or side of the stop, e.g. "Dunantstr." at Aachen Normaluhr
      platformNote: platform.note,
      platformChanged: platform.changed,
      scheduledTimeMs,
      departureTimeMs: realtimeMs ?? scheduledTimeMs,
      isRealtime: realtimeMs !== null,
      isCancelled: !!stop.dCncl || !!jny.isCncl,
      // HAFAS product classes 1–16 are trains (ICE … S-Bahn); buses are 128
      isTrain: prod.cls > 0 && prod.cls < 32,
    });
  }

  departures.sort((a, b) => a.departureTimeMs - b.departureTimeMs);

  // Which lines at this station each disruption message refers to
  const linesByMessage = new Map();
  for (const prod of prodL) {
    const line = prod.nameS || prod.number;
    if (!line) continue;
    for (const id of prod.himIdL || []) {
      if (!linesByMessage.has(id)) linesByMessage.set(id, new Set());
      linesByMessage.get(id).add(line);
    }
  }

  const station = loc ? { id: loc.extId, name: stationName(loc.name) } : null;
  return { station, departures, linesByMessage };
}

function inAvvArea(crd) {
  if (!crd) return false;
  const lat = crd.y / 1e6;
  const lon = crd.x / 1e6;
  return lat >= AVV_AREA.minLat && lat <= AVV_AREA.maxLat && lon >= AVV_AREA.minLon && lon <= AVV_AREA.maxLon;
}

function parseLocMatch(res, limit = 8) {
  const seen = new Set();
  const stations = [];
  for (const loc of res.match?.locL || []) {
    if (loc.type !== "S" || !isStationId(loc.extId) || !inAvvArea(loc.crd) || seen.has(loc.extId)) continue;
    seen.add(loc.extId);
    stations.push({ id: loc.extId, name: stationName(loc.name) });
    if (stations.length >= limit) break;
  }
  return stations;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const byLine = (a, b) => a.localeCompare(b, "de", { numeric: true });

function parseMessages(res, linesByMessage, now = Date.now()) {
  const messages = [];
  for (const msg of res.msgL || []) {
    if (msg.act === false) continue;
    const validFrom = hafasTimeToMs(msg.sDate, msg.sTime);
    const validUntil = hafasTimeToMs(msg.eDate, msg.eTime);
    if ((validFrom && validFrom > now) || (validUntil && validUntil < now)) continue;

    const lines = [...(linesByMessage.get(msg.hid) || [])].sort(byLine);
    messages.push({
      id: msg.hid,
      title: htmlToText(msg.head),
      text: htmlToText(msg.text),
      lines,
      validFrom,
      validUntil,
    });
  }
  messages.sort((a, b) => (b.validFrom || 0) - (a.validFrom || 0));
  return messages;
}

async function fetchStationBoard(stationId = DEFAULT_STATION) {
  if (!isStationId(stationId)) throw new Error("Invalid station id");
  const res = await hafasRequest({
    meth: "StationBoard",
    req: { type: "DEP", stbLoc: { lid: stationLid(stationId) }, maxJny: 60 },
  });
  return parseStationBoard(res);
}

async function searchStations(query) {
  const res = await hafasRequest({
    meth: "LocMatch",
    // Many hits lie outside the AVV area, so ask for plenty and filter
    req: { input: { loc: { name: `${query}?`, type: "S" }, maxLoc: 200, field: "S" } },
  });
  return parseLocMatch(res);
}

async function fetchMessages(linesByMessage) {
  const ids = [...linesByMessage.keys()];
  if (!ids.length) return [];
  const res = await hafasRequest({
    meth: "HimSearch",
    req: { himFltrL: ids.map((value) => ({ type: "HIMID", mode: "INC", value })), maxNum: 100 },
  });
  return parseMessages(res, linesByMessage);
}

module.exports = {
  DEFAULT_STATION,
  fetchStationBoard,
  fetchMessages,
  searchStations,
  isStationId,
  stationName,
  parseLocMatch,
  parseStationBoard,
  resolvePlatform,
  parseMessages,
  hafasTimeToMs,
  htmlToText,
  unwrap,
};
