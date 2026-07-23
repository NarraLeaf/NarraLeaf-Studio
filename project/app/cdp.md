# CDP Helper

Use `project/app/cdp.js` to talk to the Electron dev app through Chrome DevTools
Protocol without rewriting the WebSocket setup each time.

> Just need the logs? Reach for [`debug.js`](./debug.md) first — it dumps the
> app Console panel and any window's DevTools console over HTTP without a CDP
> session. Use this CDP helper for page control: reload, evaluate JS, screenshots.

The dev command already enables CDP on port `9222`:

```sh
yarn dev
```

## Defaults

- Host: `127.0.0.1`
- Port: `9222`
- Target query: `workspace`
- Reload ignores cache by default
- Reload waits for `Page.loadEventFired`, then waits another `250ms`

The target query matches target `title`, `url`, `type`, or `id`. If no match is
found, the helper falls back to the first CDP target.

## CLI

List available targets:

```sh
node project/app/cdp.js list
```

Reload the workspace window and print `document.readyState`:

```sh
node project/app/cdp.js reload
```

Evaluate JavaScript in the workspace window:

```sh
node project/app/cdp.js eval "document.readyState"
node project/app/cdp.js eval "location.href"
```

Call any CDP method directly:

```sh
node project/app/cdp.js call Runtime.enable
node project/app/cdp.js call Page.captureScreenshot '{"format":"png"}'
```

Useful options:

```sh
node project/app/cdp.js reload --target workspace --port 9222
node project/app/cdp.js reload --settle-ms 1000
node project/app/cdp.js reload --cache
node project/app/cdp.js eval "document.title" --target launcher
```

Run `node project/app/cdp.js --help` for the full option list.

## Module Use

Prefer `withCdp` for short scripts. It connects to the target and always closes
the socket afterward.

```js
const { withCdp } = require('./project/app/cdp');

await withCdp(async (cdp) => {
    await cdp.reload();
    console.log(await cdp.evaluate('document.readyState'));
});
```

Pass options when the target is not the default workspace window:

```js
await withCdp({ target: 'launcher', port: 9222 }, async (cdp) => {
    console.log(await cdp.evaluate('document.title'));
});
```

For lower-level work:

```js
await withCdp(async (cdp) => {
    await cdp.enable('Runtime', 'Page');
    await cdp.send('Page.reload', { ignoreCache: true });
    const href = await cdp.evaluate('location.href');
    console.log(href);
});
```

## Exports

- `withCdp(options?, fn)`: connect, run callback, close socket
- `connectToTarget(options?)`: connect and return a `CdpClient`
- `listTargets(options?)`: fetch `/json/list`
- `findTarget(options?)`: return the selected target and all targets
- `CdpClient`: wrapper with `send`, `enable`, `reload`, `evaluate`, and `close`

## When To Open `cdp.js`

Read this file first for normal debugging and test automation. Open `cdp.js`
only when changing helper behavior, adding commands, or debugging the helper
itself.
