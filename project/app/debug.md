# Debug Server

`project/app/debug.js` pulls Studio's logs over HTTP so you don't have to attach
a CDP session and read screenshots to find out what the app is doing.

The dev app starts a debug HTTP server automatically. It exposes **two** log
sources and one record that is not a log:

- **Console service** (`/console`) — the application-level log panel at the
  bottom of the workspace (channels: `build`, `blueprint`, `story`, …). This is
  Studio's own structured log, not the browser console.
- **DevTools console** (`/devtools`) — the raw Chrome DevTools console feed of a
  window (`console.log`/`warn`/`error`, uncaught exceptions). Captured in the
  main process from the moment each window is created, so you get history, not
  just what happened after you connected.
- **Anomalies** (`/anomalies`) — every failure the workspace survived rather
  than reported. Not a log: it is what the recovery panel is built on, one row
  per distinct failure, kept whether or not anyone was watching when it
  happened.

## Availability

- Dev builds only. The server is started from the main process when Studio runs
  in development mode (`yarn dev`, i.e. unpackaged `--dev`). It never runs in a
  packaged app.
- Bound to `127.0.0.1` only.
- No `--cdp` required — unlike the CDP helper, this works whether or not remote
  debugging is enabled, and does not conflict with an open DevTools window.

## Defaults

- Host: `127.0.0.1`
- Port: `9223` (override with the `NLS_DEBUG_PORT` env var)
- DevTools target: `workspace` (match by window type/title substring or id)
- Default limit: `200` most-recent entries
- Buffer: `2000` DevTools lines per window, `12` windows including recently-closed
  ones. A window that has been talking for an hour has lost its oldest lines, and
  the thirteenth window drops the least recently seen one entirely.

## CLI

Check the server and list open windows (`health` is also what runs when no
command is given):

```sh
node project/app/debug.js health
node project/app/debug.js windows
```

Read the application Console service (workspace window):

```sh
node project/app/debug.js console
node project/app/debug.js console --channel build
node project/app/debug.js console --level warning --limit 50
```

Read a window's Chrome DevTools console:

```sh
node project/app/debug.js devtools                       # workspace by default
node project/app/debug.js devtools --window dev-mode
node project/app/debug.js devtools --level error
```

Both at once:

```sh
node project/app/debug.js logs --limit 50
```

Ask what the workspace survived rather than reported:

```sh
node project/app/debug.js anomalies
```

This is the one to reach for when a project opens and is simply *wrong* — the
assets are gone, a scene is empty, a plugin is missing — with nothing in either
log to say why. Those load paths mostly do not throw: a corrupt asset shard is
set aside and replaced with `{}`, a story that will not parse is left unloaded,
a plugin that throws is skipped. Each decision is locally reasonable and none of
them is visible. They are all recorded here, with the raw error and the file.

Raw JSON (for scripting):

```sh
node project/app/debug.js devtools --level error --json
```

Run `node project/app/debug.js --help` for the full option list.

### Options

| Option           | Applies to | Meaning                                                              |
| ---------------- | ---------- | -------------------------------------------------------------------- |
| `--channel <id>` | console    | Restrict to one Console channel (`build`, `blueprint`, `story`, …)   |
| `--window <q>`   | devtools   | Match window by type/title substring or webContents id              |
| `--level <lvl>`  | both       | Minimum severity. Console: `verbose\|info\|success\|warning\|error`. DevTools: `debug\|info\|warning\|error`. A word belonging to the other source (`verbose` on devtools, `debug` on console) is refused rather than quietly meaning no filter, which is what both ends do with a level they cannot grade. `success` ranks with `info`, so filtering to it returns both |
| `--source <s>`   | console    | Substring match on the entry source                                  |
| `--since <ms>`   | both       | Only entries newer than this epoch-ms timestamp                      |
| `--after-seq <n>`| devtools   | Only entries after this `seq` cursor — use `latestSeq` to tail       |
| `--limit <n>`    | both       | Max entries (most recent). Default `200`                             |
| `--host/--port`  | —          | Connection target                                                    |
| `--json`         | —          | Print the raw JSON response                                          |

## HTTP endpoints

All return JSON. `GET` only.

- `GET /health` — server status, version, the endpoint list, and the live windows.
- `GET /windows` — live windows plus buffered (including recently-closed) windows.
  Each live window carries `visible`, which is not the same as existing: a window that
  has not finished its first render, and a launcher held back for a project being opened,
  are both listed and neither is on screen.
- `GET /console?channel=&level=&source=&since=&limit=` — Console service snapshot
  from the workspace window. Returns `{ available, data: { channels, entries, matched } }`,
  or `{ available: false, reason }` when no workspace window is open yet.
- `GET /devtools?window=&level=&since=&afterSeq=&limit=` — DevTools console
  buffer. Returns `{ entries, latestSeq, windows }`. Poll with
  `afterSeq=<latestSeq>` to stream new lines.
- `GET /anomalies` — everything the workspace survived. Returns
  `{ available, data: { anomalies } }`, each with `source`, `operationKey`,
  `path`, `severity` (`fatal` stopped startup, `degraded` did not), `raw` and
  `at`. Same `{ available: false, reason }` as `/console` when there is no
  workspace window, no bridge, or the call threw.
- `GET /logs?...` — `{ console, devtools }` in one response.

## Module use

```js
const { getConsole, getDevtools } = require('./project/app/debug');

const errors = await getDevtools({ window: 'workspace', level: 'error' });
console.log(errors.entries);

const build = await getConsole({ channel: 'build', limit: 20 });
console.log(build.data.entries);
```

The anomaly log is a module-level array with no service in front of it — see
`src/renderer/lib/workspace/recovery/anomalyLog.ts` for why — so the bridge is
the only way to read it from outside the window, and `getAnomalies()` is the
only way to read the bridge without a CDP session:

```js
const { getAnomalies } = require('./project/app/debug');
const { available, data } = await getAnomalies();
console.log(available ? data.anomalies : 'no workspace window');
```

## How it works

- The **DevTools console** is captured in the main process via each window's
  `console-message` event — not via `webContents.debugger`, so it never fights
  the `--cdp` remote-debugging port or a hand-opened DevTools window.
- The **Console service** and the **anomalies** are read from the workspace
  renderer through a dev-only bridge (`window.__NLS_STUDIO_DEBUG__`) that the
  main process evaluates with `executeJavaScript`. The bridge is compiled in
  only for dev builds, and it exists only in the workspace window — the Console
  service and the anomaly log exist nowhere else. Both endpoints answer
  `{ available: false, reason }` rather than an error status while no workspace
  window is open, which is the ordinary state during startup.

For lower-level page control (reload, evaluate arbitrary JS, screenshots), use
the CDP helper — see [cdp.md](./cdp.md).
