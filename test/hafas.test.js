const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseStationBoard, parseMessages, parseLocMatch, resolvePlatform, stationName, isStationId, hafasTimeToMs, htmlToText, unwrap,
} = require("../lib/hafas");

const stationBoard = unwrap(require("./fixtures/stationboard.json"));
const himSearch = unwrap(require("./fixtures/himsearch.json"));

test("hafasTimeToMs converts Berlin summer time", () => {
  assert.equal(hafasTimeToMs("20260711", "093000"), Date.parse("2026-07-11T07:30:00Z"));
});

test("hafasTimeToMs converts Berlin winter time", () => {
  assert.equal(hafasTimeToMs("20260111", "093000"), Date.parse("2026-01-11T08:30:00Z"));
});

test("hafasTimeToMs rolls hours past midnight into the next day", () => {
  assert.equal(hafasTimeToMs("20260111", "250500"), Date.parse("2026-01-12T00:05:00Z"));
});

test("hafasTimeToMs handles the DST switch night", () => {
  // 25 Oct 2026, clocks go back at 03:00 CEST; 04:00 is CET
  assert.equal(hafasTimeToMs("20261025", "040000"), Date.parse("2026-10-25T03:00:00Z"));
});

test("hafasTimeToMs handles the hour before the clocks change", () => {
  // 01:30 is still CEST in October and still CET in March
  assert.equal(hafasTimeToMs("20261025", "013000"), Date.parse("2026-10-24T23:30:00Z"));
  assert.equal(hafasTimeToMs("20260329", "013000"), Date.parse("2026-03-29T00:30:00Z"));
});

test("hafasTimeToMs returns null for missing values", () => {
  assert.equal(hafasTimeToMs("20260111", undefined), null);
});

test("parseStationBoard returns sorted departures with all fields", () => {
  const { departures } = parseStationBoard(stationBoard);
  assert.ok(departures.length > 20);
  for (let i = 1; i < departures.length; i++) {
    assert.ok(departures[i - 1].departureTimeMs <= departures[i].departureTimeMs);
  }
  const d = departures[0];
  assert.equal(typeof d.id, "string");
  assert.match(d.line, /^\w+$/);
  assert.ok(d.destination.length > 0);
  assert.match(d.platform, /^H\.\d+$/);
  assert.equal(typeof d.isRealtime, "boolean");
  assert.equal(typeof d.isCancelled, "boolean");
});

test("parseStationBoard reads realtime, cancellation and platform changes", () => {
  const res = {
    sD: "20261011",
    common: { prodL: [{ nameS: "12", himIdL: ["HIM_1"] }, { nameS: "33", himIdL: ["HIM_1", "HIM_2"] }] },
    jnyL: [
      {
        jid: "a",
        dirTxt: "Hörn",
        stbStop: { dProdX: 0, dTimeS: "093000", dTimeR: "093300", dPltfS: { txt: "H.11" }, dPltfR: { txt: "H.12" } },
      },
      { jid: "b", dirTxt: "Fuchserde", stbStop: { dProdX: 1, dTimeS: "092000", dCncl: true, dPltfS: { txt: "H.3" } } },
    ],
  };
  const { departures, linesByMessage } = parseStationBoard(res);

  assert.deepEqual(departures.map((d) => d.id), ["b", "a"]);
  const [cancelled, late] = departures;
  assert.equal(cancelled.isCancelled, true);
  assert.equal(cancelled.isRealtime, false);
  assert.equal(cancelled.departureTimeMs, cancelled.scheduledTimeMs);
  assert.equal(late.departureTimeMs - late.scheduledTimeMs, 3 * 60_000);
  assert.equal(late.platform, "H.12");
  assert.equal(late.platformChanged, true);
  assert.equal(late.isTrain, false);

  assert.deepEqual([...linesByMessage.get("HIM_1")], ["12", "33"]);
  assert.deepEqual([...linesByMessage.get("HIM_2")], ["33"]);
});

test("parseMessages keeps only currently valid messages and maps lines", () => {
  const { linesByMessage } = parseStationBoard(stationBoard);
  const now = Date.parse("2026-10-11T08:00:00Z");
  const messages = parseMessages(himSearch, linesByMessage, now);

  assert.ok(messages.length > 0);
  for (const m of messages) {
    assert.ok(m.title.length > 0);
    assert.doesNotMatch(m.text, /<[a-z]/i);
    assert.ok(!m.validFrom || m.validFrom <= now);
    assert.ok(!m.validUntil || m.validUntil >= now);
  }
  // Starts 12 Oct 2026, so not yet valid
  assert.ok(!messages.some((m) => m.id === "HIM_FREETEXT_78712"));
  assert.ok(messages.some((m) => m.lines.length > 0));
});

test("htmlToText turns markup into plain text", () => {
  assert.equal(htmlToText("Linie 1:<br><br>Haltestelle <b>verlegt</b> &amp; gesperrt"), "Linie 1:\n\nHaltestelle verlegt & gesperrt");
});

test("unwrap throws on HAFAS errors", () => {
  assert.throws(() => unwrap({ err: "PARSE", errTxt: "Parse fail" }), /Parse fail/);
  assert.throws(() => unwrap({ err: "OK", svcResL: [{ err: "LOCATION" }] }), { code: "LOCATION" });
});

test("parseStationBoard returns the station itself", () => {
  const { station } = parseStationBoard(stationBoard);
  assert.deepEqual(station, { id: "1001", name: "Aachen, Bushof" });
});

test("parseLocMatch keeps only stations in the AVV area", () => {
  const loc = (extId, name, lat, lon, type = "S") => ({ extId, name, type, crd: { x: lon * 1e6, y: lat * 1e6 } });
  const res = {
    match: {
      locL: [
        loc("3061480", "Markt Berolzheim, Friedhof", 49.01, 10.85),
        loc("1037", "Markt (Judengasse), AC", 50.78, 6.08),
        loc("4405", "Köln Hbf", 50.94, 6.96),
        loc("3055", "Eupen, Bushof", 50.63, 6.03),
        loc("1037", "Markt (Judengasse), AC", 50.78, 6.08),
        loc("990001", "Ein Ort", 50.78, 6.08, "P"),
      ],
    },
  };
  assert.deepEqual(parseLocMatch(res), [
    { id: "1037", name: "Markt (Judengasse), Aachen" },
    { id: "3055", name: "Eupen, Bushof" },
  ]);
});

test("stationName spells out the AC abbreviation", () => {
  assert.equal(stationName("Ponttor, AC"), "Ponttor, Aachen");
  assert.equal(stationName("Aachen, Bushof"), "Aachen, Bushof");
});

test("isStationId only accepts numeric ids", () => {
  assert.ok(isStationId("1001"));
  assert.ok(!isStationId("A=1@L=1001@"));
  assert.ok(!isStationId("1001; drop"));
  assert.ok(!isStationId(""));
});

test("resolvePlatform ignores realtime platform texts that HAFAS cut off", () => {
  // Seen at Aachen Normaluhr: the realtime text is truncated to 8 bytes
  assert.deepEqual(resolvePlatform("H.3 (Dunantstr.)", "H.3 (Dun"), { code: "H.3", note: "Dunantstr.", changed: false });
  assert.deepEqual(resolvePlatform("H.2 (Römerstr.)", ".2 (Rö"), { code: "H.2", note: "Römerstr.", changed: false });
});

test("resolvePlatform still detects real platform changes", () => {
  assert.deepEqual(resolvePlatform("H.10", "H.12"), { code: "H.12", note: "", changed: true });
  assert.deepEqual(resolvePlatform("H.3 (Dunantstr.)", "H.4 (The"), { code: "H.4", note: "", changed: true });
  assert.deepEqual(resolvePlatform("H.10", "H.1"), { code: "H.1", note: "", changed: true });
  assert.deepEqual(resolvePlatform("H.12", "H.1"), { code: "H.1", note: "", changed: true });
});

test("resolvePlatform handles missing scheduled or realtime platforms", () => {
  assert.deepEqual(resolvePlatform("6", undefined), { code: "6", note: "", changed: false });
  assert.deepEqual(resolvePlatform(undefined, "H.7"), { code: "H.7", note: "", changed: false });
  assert.deepEqual(resolvePlatform(undefined, undefined), { code: "", note: "", changed: false });
});
