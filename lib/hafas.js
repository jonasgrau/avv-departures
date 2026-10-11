"use strict";

// Client for the AVV HAFAS endpoint (mgate.exe) used by auskunft.avv.de

const HAFAS_URL = "https://auskunft.avv.de/bin/mgate.exe";
const STATION_LID = "A=1@L=1001@"; // Aachen Bushof
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
  if (!svc || svc.err !== "OK") throw new Error(`HAFAS: ${svc?.errTxt || svc?.err || "empty response"}`);
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

function parseStationBoard(res) {
  const prodL = res.common?.prodL || [];
  const departures = [];

  for (const jny of res.jnyL || []) {
    const stop = jny.stbStop || {};
    const prod = prodL[stop.dProdX ?? jny.prodX] || {};
    const date = jny.date || res.sD;
    const scheduledTimeMs = hafasTimeToMs(date, stop.dTimeS);
    if (scheduledTimeMs === null) continue;

    const realtimeMs = hafasTimeToMs(date, stop.dTimeR);
    const scheduledPlatform = stop.dPltfS?.txt || "";
    const platform = stop.dPltfR?.txt || scheduledPlatform;

    departures.push({
      id: jny.jid,
      line: prod.nameS || prod.number || prod.name || "?",
      destination: jny.dirTxt || "",
      platform,
      platformChanged: !!scheduledPlatform && platform !== scheduledPlatform,
      scheduledTimeMs,
      departureTimeMs: realtimeMs ?? scheduledTimeMs,
      isRealtime: realtimeMs !== null,
      isCancelled: !!stop.dCncl || !!jny.isCncl,
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

  return { departures, linesByMessage };
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

async function fetchStationBoard() {
  const res = await hafasRequest({
    meth: "StationBoard",
    req: { type: "DEP", stbLoc: { lid: STATION_LID }, maxJny: 60 },
  });
  return parseStationBoard(res);
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
  fetchStationBoard,
  fetchMessages,
  parseStationBoard,
  parseMessages,
  hafasTimeToMs,
  htmlToText,
  unwrap,
};
