"use strict";

// Fake data for DEMO=1, covering cancellations, delays and platform changes

const STATIONS = [
  { id: "1001", name: "Aachen, Bushof" },
  { id: "1008", name: "Aachen, Hbf" },
  { id: "1029", name: "Elisenbrunnen, Aachen" },
  { id: "1055", name: "Ponttor, Aachen" },
  { id: "1743", name: "Uniklinik, Aachen" },
  { id: "2286", name: "Düren, Bf" },
];

const TRIPS = [
  ["11", "Siegel", "H.10"],
  ["2", "Eilendorf Schubertstraße", "H.12"],
  ["44", "Driescher Hof - Brand", "H.12"],
  ["45", "Uniklinik", "H.11"],
  ["25", "Vaals Busstation", "H.14"],
  ["51", "Aachen Schanz", "H.13"],
  ["73", "Alsdorf Markt", "H.13"],
  ["5", "Uniklinik", "H.11"],
  ["35", "Driescher Hof", "H.2"],
  ["12", "Technologiepark", "H.10"],
  ["33", "Fuchserde", "H.3"],
  ["7", "Eilendorf Karlstraße", "H.13"],
  ["SB63", "Monschau Parkplatz Burgau", "H.14"],
  ["14", "Hörn", "H.10"],
  ["47", "Hoengen", "H.4"],
  ["N3", "Burtscheid Kurpark", "H.6"],
  ["1", "Schevenhütte Helenasruh", "H.1"],
];

function demoSearch(query) {
  const q = query.toLocaleLowerCase("de");
  return STATIONS.filter((s) => s.name.toLocaleLowerCase("de").includes(q));
}

function demoBoard(id = "1001") {
  const now = Date.now();
  const minute = Math.floor(now / 60_000) * 60_000;

  const departures = TRIPS.map(([line, destination, platform], i) => {
    const scheduledTimeMs = minute + (i * 2 + 1) * 60_000;
    const delay = i === 2 ? 4 : i === 6 ? 2 : 0;
    const changed = i === 9;
    return {
      id: `demo-${i}`,
      line,
      destination,
      platform: changed ? "H.11" : platform,
      platformChanged: changed,
      scheduledTimeMs,
      departureTimeMs: scheduledTimeMs + delay * 60_000,
      isRealtime: i % 4 !== 3,
      isCancelled: i === 4,
      isTrain: false,
    };
  }).sort((a, b) => a.departureTimeMs - b.departureTimeMs);

  const messages = [
    {
      id: "demo-msg-1",
      title: "Aachen: Sperrung der Peterstraße",
      text: "Linien 25 und 35:\n\nWegen Bauarbeiten wird die Peterstraße gesperrt. Die Haltestelle Kaiserplatz entfällt ersatzlos.",
      lines: ["25", "35"],
      validFrom: now - 86_400_000,
      validUntil: now + 7 * 86_400_000,
    },
    {
      id: "demo-msg-2",
      title: "Herzogenrath: Haltestelle Alte Post verlegt",
      text: "Linie 47:\n\nDie Haltestelle Alte Post wird um ca. 50 Meter vorverlegt.",
      lines: ["47"],
      validFrom: now - 3 * 86_400_000,
      validUntil: now + 30 * 86_400_000,
    },
  ];

  const station = STATIONS.find((s) => s.id === id) || { id, name: `Haltestelle ${id}` };
  return { station, departures, messages, fetchedAt: now, stale: false };
}

module.exports = { demoBoard, demoSearch };
