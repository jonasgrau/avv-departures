"use strict";

const { fetchStationBoard, fetchMessages } = require("./hafas");
const { demoBoard } = require("./demo");

const BOARD_TTL_MS = 15_000;
const MESSAGES_TTL_MS = 5 * 60_000;

let board = null; // { departures, fetchedAt }
let messages = { list: [], fetchedAt: 0 };
let inflight = null;

async function refresh() {
  const { departures, linesByMessage } = await fetchStationBoard();
  board = { departures, fetchedAt: Date.now() };

  if (Date.now() - messages.fetchedAt > MESSAGES_TTL_MS) {
    try {
      messages = { list: await fetchMessages(linesByMessage), fetchedAt: Date.now() };
    } catch (err) {
      // Disruption messages are optional, departures still go out
      console.error("Messages fetch failed:", err.message);
    }
  }
}

async function getBoard() {
  if (process.env.DEMO === "1") return demoBoard();

  if (!board || Date.now() - board.fetchedAt > BOARD_TTL_MS) {
    inflight ??= refresh().finally(() => (inflight = null));
    try {
      await inflight;
    } catch (err) {
      console.error("Departures fetch failed:", err.message);
      if (!board) throw err;
      return { ...board, messages: messages.list, stale: true };
    }
  }
  return { ...board, messages: messages.list, stale: false };
}

// Shared by the local server and the Vercel function
async function handleDeparturesRequest(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const data = await getBoard();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=15, stale-while-revalidate=30");
    res.statusCode = 200;
    res.end(JSON.stringify(data));
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: "Fahrplandaten nicht erreichbar" }));
  }
}

module.exports = { getBoard, handleDeparturesRequest };
