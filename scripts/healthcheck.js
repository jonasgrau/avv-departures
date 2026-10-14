// Checks the deployed site like a visitor would and exits non-zero on problems.
// If the site fails, it also queries the AVV HAFAS endpoint directly to tell
// whether the deployment or the data source is broken.
//
//   node scripts/healthcheck.js [base-url]

const { setTimeout: sleep } = require("node:timers/promises");
const { fetchStationBoard, searchStations } = require("../lib/hafas");

const BASE_URL = (process.argv[2] || process.env.HEALTHCHECK_URL || "https://bushof-monitor.vercel.app").replace(/\/$/, "");
const TIMEOUT_MS = 20_000;
// A failed check is tried once more, so a short AVV hiccup is no alarm
const RETRY_DELAY_MS = 30_000;

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
    name: "Anzeige-Modus lädt",
    async run() {
      const res = await fetch(`${BASE_URL}/anzeige`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const html = await res.text();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      if (!html.includes("/js/anzeige.js")) throw new Error("Seite enthält nicht die erwartete Anzeige");
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

// Departures and search use different HAFAS methods, so both are asked
async function diagnoseHafas() {
  const probes = [
    ["Abfahrten", async () => `${(await fetchStationBoard()).departures.length} Abfahrten`],
    ["Suche", async () => `${(await searchStations("Elisenbrunnen")).length} Treffer`],
  ];
  const lines = [];
  let broken = 0;
  for (const [name, probe] of probes) {
    try {
      lines.push(`  ✓ ${name} (${await probe()})`);
    } catch (err) {
      broken++;
      lines.push(`  ✗ ${name}: ${err.message}`);
    }
  }
  const verdict = broken
    ? "Vermutlich hat der AVV etwas geändert oder ist gestört."
    : "Das Problem liegt eher beim Deployment.";
  return `AVV-Schnittstelle direkt abgefragt:\n${lines.join("\n")}\n${verdict}`;
}

async function runCheck(check) {
  try {
    return { ok: true, detail: await check.run() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  console.log(`Prüfe ${BASE_URL}\n`);
  let failed = 0;

  for (const check of checks) {
    let result = await runCheck(check);
    if (!result.ok) {
      console.log(`… ${check.name}: ${result.error}, neuer Versuch in ${RETRY_DELAY_MS / 1000} s`);
      await sleep(RETRY_DELAY_MS);
      result = await runCheck(check);
    }
    if (result.ok) {
      console.log(`✓ ${check.name}${result.detail ? ` (${result.detail})` : ""}`);
    } else {
      failed++;
      console.log(`✗ ${check.name}: ${result.error}`);
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
