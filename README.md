# Aachen Bushof – Abfahrten

Live departure board for Aachen Bushof, the central bus station in Aachen, and every other stop in the AVV area (Aachen, Städteregion, Düren, Heinsberg and the border region). No dependencies, no build step.

Both views look like the amber LED matrix displays at Aachen bus stops: line, destination, platform and minutes until departure, with clock times for departures without live data and "Fahrt fällt aus" for cancellations.

- **Main view** (`/`): starts at the Bushof. A search field switches to any other stop (`/?station=1029`) and remembers recently viewed ones. Next departures, a line filter (remembered per stop) and the current disruption notices as a scrolling line and an expandable list. At train stations the platform column shows tracks (`Gl6`).
- **Display mode** (`/anzeige`): full-screen board for a TV or wall screen. Click to toggle fullscreen; the screen is kept awake where the browser supports it.

## Display mode options

| URL | Shows |
| --- | --- |
| `/anzeige` | all departures at the Bushof |
| `/anzeige?station=1029` | another stop (id from the main view's URL) |
| `/anzeige?steig=10,11` | only platforms H.10 and H.11 |
| `/anzeige?linien=33,47` | only lines 33 and 47 |

Parameters can be combined, e.g. `/anzeige?station=1029&steig=1`.

## Running locally

Requires Node.js 20 or newer.

```bash
npm start      # http://localhost:3000
npm run demo   # fake data incl. delays, cancellations and notices
npm test       # parser tests against recorded HAFAS responses
```

## Deployment

Deploys to Vercel as is: `public/` is served statically and `api/departures.js` becomes a serverless function.

```bash
vercel
```

## How it works

```
public/
  index.html, css/app.css, js/app.js         main view
  anzeige.html, css/anzeige.css, js/anzeige.js   display mode
  css/led.css, js/led.js                      shared LED look and row rendering
  js/core.js                                  polling, formatting, station helpers
  js/search.js                                station search field
  fonts/                                      Jersey 10 (SIL OFL), self-hosted instead of Google Fonts
  sw.js                                       offline fallback for the app shell
lib/
  hafas.js    AVV HAFAS client and response parsing
  board.js    caching and the /api/departures handler
  demo.js     fake data for DEMO=1
api/departures.js   Vercel function: GET /api/departures?station=<id>
api/stations.js     Vercel function: GET /api/stations?q=<query>
server.js           local server (static files + API)
test/               node:test suite with recorded fixtures
```

1. `/api/departures?station=<id>` queries the AVV HAFAS endpoint (`auskunft.avv.de/bin/mgate.exe`) for that stop; without a station it uses `1001` (Aachen Bushof). Results are cached per stop for 15 seconds.
2. `/api/stations?q=` uses HAFAS `LocMatch` and keeps only stops inside a bounding box around the AVV area. Searches are cached for a day.
3. Disruption notices are fetched with a `HimSearch` request for the message IDs attached to the lines at the station, and refreshed every 5 minutes.
4. HAFAS times are local Berlin time (hours can exceed 24 after midnight) and are converted to UTC timestamps.
5. If HAFAS is unreachable, the last good response is returned with `stale: true` and the UI shows its timestamp.
6. The frontend polls every 30 seconds, pauses in background tabs and updates minute counters every few seconds.

## License

MIT
