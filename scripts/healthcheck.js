// Checks the deployed site like a visitor would and exits non-zero on problems.
// If the site fails, it also queries the AVV HAFAS endpoint directly to tell
// whether the deployment or the data source is broken.
//
//   node scripts/healthcheck.js [base-url]

const { fetchStationBoard } = require("../lib/hafas");

const BASE_URL = (process.argv[2] || process.env.HEALTHCHECK_URL || "https://bushof-monitor.vercel.app").replace(/\/$/, "");
const TIMEOUT_MS = 20_000;

// Unique query parameter so the CDN cache does not hide a broken function
const bust = () => `_=${Date.now()}`;

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.text();
  let data = null;
  try {
    data = JSON.parse(body);
  } catch {}
  return { status: res.status, data, body };
}

const checks = [
  {
    name: "Startseite lädt",
    async run() {
      const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const html = await res.text();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      if (!html.includes('id="station-name"')) throw new Error("Seite enthält nicht die erwartete Hauptansicht");
    },
  },
  {
    name: "Abfahrten am Bushof",
    async run() {
      const { status, data, body } = await getJson(`/api/departures?${bust()}`);
      if (status !== 200) throw new Error(`HTTP ${status}: ${data?.error || body.slice(0, 120)}`);
      if (data.station?.id !== "1001") throw new Error(`unerwartete Haltestelle ${JSON.stringify(data.station)}`);
      if (data.stale) throw new Error("nur veraltete Daten, AVV-Abfrage schlägt fehl");
      if (!data.departures?.length) throw new Error("keine Abfahrten geliefert");
      return `${data.departures.length} Abfahrten, ${data.messages?.length ?? 0} Hinweise`;
    },
  },
  {
    name: "Haltestellensuche",
    async run() {
      const { status, data, body } = await getJson(`/api/stations?q=Elisenbrunnen&${bust()}`);
      if (status !== 200) throw new Error(`HTTP ${status}: ${data?.error || body.slice(0, 120)}`);
      if (!data.stations?.some((s) => s.id === "1029")) throw new Error("Elisenbrunnen (1029) nicht gefunden");
      return `${data.stations.length} Treffer`;
    },
  },
];

async function diagnoseHafas() {
  try {
    const { departures } = await fetchStationBoard();
    return `AVV-Schnittstelle direkt abgefragt: funktioniert (${departures.length} Abfahrten). Das Problem liegt eher beim Deployment.`;
  } catch (err) {
    return `AVV-Schnittstelle direkt abgefragt: Fehler (${err.message}). Vermutlich hat der AVV etwas geändert oder ist gestört.`;
  }
}

async function main() {
  console.log(`Prüfe ${BASE_URL}\n`);
  let failed = 0;

  for (const check of checks) {
    try {
      const detail = await check.run();
      console.log(`✓ ${check.name}${detail ? ` (${detail})` : ""}`);
    } catch (err) {
      failed++;
      console.log(`✗ ${check.name}: ${err.message}`);
    }
  }

  if (failed) {
    console.log(`\n${await diagnoseHafas()}`);
    console.log(`\n${failed} von ${checks.length} Prüfungen fehlgeschlagen.`);
    process.exit(1);
  }
  console.log("\nAlles in Ordnung.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
