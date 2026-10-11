# Aachen Bushof – Abfahrten

Live departure board for Aachen Bushof, the central bus station in Aachen. No dependencies, no build step.

Both views look like the amber LED matrix displays at Aachen bus stops: line, destination, platform and minutes until departure, with clock times for departures without live data and "Fahrt fällt aus" for cancellations.

- **Main view** (`/`): next departures plus a line filter (remembered per browser) and the current disruption notices as a scrolling line and an expandable list.
- **Display mode** (`/anzeige`): full-screen board for a TV or wall screen. Click to toggle fullscreen; the screen is kept awake where the browser supports it.

## Display mode options

| URL | Shows |
| --- | --- |
| `/anzeige` | all departures |
| `/anzeige?steig=10,11` | only platforms H.10 and H.11 |
| `/anzeige?linien=33,47` | only lines 33 and 47 |

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
  js/core.js                                  polling and formatting
  sw.js                                       offline fallback for the app shell
lib/
  hafas.js    AVV HAFAS client and response parsing
  board.js    caching and the /api/departures handler
  demo.js     fake data for DEMO=1
api/departures.js   Vercel function (uses lib/board.js)
server.js           local server (static files + API)
test/               node:test suite with recorded fixtures
```

1. `/api/departures` queries the AVV HAFAS endpoint (`auskunft.avv.de/bin/mgate.exe`) for station `A=1@L=1001@` (Aachen Bushof). Results are cached for 15 seconds.
2. Disruption notices are fetched with a `HimSearch` request for the message IDs attached to the lines at the station, and refreshed every 5 minutes.
3. HAFAS times are local Berlin time (hours can exceed 24 after midnight) and are converted to UTC timestamps.
4. If HAFAS is unreachable, the last good response is returned with `stale: true` and the UI shows its timestamp.
5. The frontend polls every 30 seconds, pauses in background tabs and updates minute counters every few seconds.

## License

MIT
