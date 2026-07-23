#!/usr/bin/env node

/*
 * Convenience client for the NarraLeaf Studio dev debug server.
 *
 * The dev app (`yarn dev`) starts a 127.0.0.1 HTTP server that exposes Studio's
 * two log sources so you don't have to hand-roll a CDP session and scrape
 * screenshots:
 *
 *   - the application Console service (the in-app bottom panel: build,
 *     blueprint, story… channels), read from the workspace window;
 *   - the raw Chrome DevTools console feed of any window, captured in the main
 *     process from window creation onward.
 *
 * Examples:
 *   node project/app/debug.js health
 *   node project/app/debug.js windows
 *   node project/app/debug.js console --level warning
 *   node project/app/debug.js devtools --window workspace --level error
 *   node project/app/debug.js logs --limit 50
 */

const DEFAULT_DEBUG_HOST = '127.0.0.1';
const DEFAULT_DEBUG_PORT = Number(process.env.NLS_DEBUG_PORT) || 9223;

function baseUrl(options) {
    return `http://${options.host}:${options.port}`;
}

async function debugRequest(pathname, params = {}, options = {}) {
    const host = options.host ?? DEFAULT_DEBUG_HOST;
    const port = options.port ?? DEFAULT_DEBUG_PORT;
    const url = new URL(pathname, `http://${host}:${port}`);
    for (const [key, value] of Object.entries(params)) {
        if (value != null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }

    let response;
    try {
        response = await fetch(url);
    } catch (error) {
        throw new Error(
            `Could not reach the debug server at ${baseUrl({ host, port })}. `
            + `Is \`yarn dev\` running? (${error.message})`,
        );
    }
    const text = await response.text();
    let body;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    if (!response.ok) {
        const message = body && body.error ? body.error : `${response.status} ${response.statusText}`;
        throw new Error(message);
    }
    return body;
}

const getHealth = (options) => debugRequest('/health', {}, options);
const getWindows = (options) => debugRequest('/windows', {}, options);
const getConsole = (params, options) => debugRequest('/console', params, options);
const getDevtools = (params, options) => debugRequest('/devtools', params, options);
const getLogs = (params, options) => debugRequest('/logs', params, options);

function pad(value, width) {
    const text = String(value ?? '');
    return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function printConsoleSnapshot(snapshot) {
    if (!snapshot || snapshot.available === false) {
        console.log(`[console] unavailable: ${snapshot ? snapshot.reason : 'no response'}`);
        return;
    }
    const data = snapshot.data ?? snapshot;
    const entries = data.entries ?? [];
    if (!entries.length) {
        console.log('[console] no matching entries');
        return;
    }
    for (const entry of entries) {
        const time = entry.time ? entry.time.slice(11, 19) : '';
        const where = entry.source ? `${entry.channel}/${entry.source}` : entry.channel;
        console.log(`${time}  ${pad(entry.level, 7)} ${pad(where, 18)}  ${entry.text}`);
    }
    if (data.matched > entries.length) {
        console.log(`… ${data.matched - entries.length} older entries omitted (raise --limit)`);
    }
}

function printDevtools(result) {
    const entries = result.entries ?? [];
    if (!entries.length) {
        console.log('[devtools] no matching entries');
        return;
    }
    for (const entry of entries) {
        const time = new Date(entry.timestamp).toISOString().slice(11, 19);
        const origin = entry.source ? ` (${entry.source}${entry.line ? ':' + entry.line : ''})` : '';
        console.log(`${time}  ${pad(entry.level, 7)} ${pad(entry.windowType, 10)}  ${entry.message}${origin}`);
    }
}

function printWindows(payload) {
    for (const window of payload.windows ?? []) {
        console.log(`[${window.windowType}] id=${window.windowId} "${window.title}"`);
        if (window.url) console.log(`   ${window.url}`);
    }
    const buffered = (payload.buffered ?? []).filter(w => w.closed);
    if (buffered.length) {
        console.log('closed (logs still buffered):');
        for (const window of buffered) {
            console.log(`  [${window.windowType}] id=${window.windowId} (${window.entryCount} lines)`);
        }
    }
}

function printHelp() {
    console.log(`Usage:
  node project/app/debug.js health
  node project/app/debug.js windows
  node project/app/debug.js console  [options]
  node project/app/debug.js devtools [options]
  node project/app/debug.js logs     [options]   # console + devtools together

Filters:
  --channel <id>     Console only: restrict to a channel (build, blueprint, story, …)
  --window <query>   DevTools only: match window by type/title substring or id. Default: workspace
  --level <level>    Minimum severity. Console: verbose|info|success|warning|error.
                     DevTools: debug|info|warning|error
  --source <text>    Console only: substring match on the entry source
  --since <ms>       Only entries newer than this epoch-ms timestamp
  --after-seq <n>    DevTools only: only entries after this seq cursor (for tailing)
  --limit <n>        Max entries (most recent). Default: 200

Connection:
  --host <host>      Debug host. Default: ${DEFAULT_DEBUG_HOST}
  --port <port>      Debug port. Default: ${DEFAULT_DEBUG_PORT} (env NLS_DEBUG_PORT)
  --json             Print the raw JSON response instead of formatted lines

Module:
  const { getConsole, getDevtools } = require('./project/app/debug');
  console.log(await getConsole({ level: 'error' }));`);
}

function parseArgs(argv) {
    const options = { host: DEFAULT_DEBUG_HOST, port: DEFAULT_DEBUG_PORT, json: false };
    const params = {};
    const positional = [];

    const takeValue = (i, name) => {
        const value = argv[i + 1];
        if (value == null || value.startsWith('--')) {
            throw new Error(`${name} requires a value`);
        }
        return value;
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        switch (arg) {
            case '--help':
            case '-h':
                options.help = true;
                break;
            case '--json':
                options.json = true;
                break;
            case '--host':
                options.host = takeValue(i, arg); i += 1; break;
            case '--port':
                options.port = Number(takeValue(i, arg)); i += 1; break;
            case '--channel':
                params.channel = takeValue(i, arg); i += 1; break;
            case '--window':
                params.window = takeValue(i, arg); i += 1; break;
            case '--level':
                params.level = takeValue(i, arg); i += 1; break;
            case '--source':
                params.source = takeValue(i, arg); i += 1; break;
            case '--since':
                params.since = Number(takeValue(i, arg)); i += 1; break;
            case '--after-seq':
                params.afterSeq = Number(takeValue(i, arg)); i += 1; break;
            case '--limit':
                params.limit = Number(takeValue(i, arg)); i += 1; break;
            default:
                if (arg.startsWith('--')) {
                    throw new Error(`Unknown option: ${arg}`);
                }
                positional.push(arg);
        }
    }

    return { command: positional.shift() ?? 'health', options, params };
}

async function runCli(argv = process.argv.slice(2)) {
    const { command, options, params } = parseArgs(argv);
    if (options.help) {
        printHelp();
        return;
    }

    const emit = (value, formatter) => {
        if (options.json) {
            console.log(JSON.stringify(value, null, 2));
        } else {
            formatter(value);
        }
    };

    switch (command) {
        case 'health': {
            const health = await getHealth(options);
            emit(health, h => {
                console.log(`ok=${h.ok} version=${h.version} dev=${h.dev} port=${h.port}`);
                printWindows({ windows: h.windows });
            });
            return;
        }
        case 'windows':
            emit(await getWindows(options), printWindows);
            return;
        case 'console':
            emit(await getConsole(params, options), printConsoleSnapshot);
            return;
        case 'devtools':
            emit(await getDevtools({ window: 'workspace', ...params }, options), printDevtools);
            return;
        case 'logs': {
            const logs = await getLogs({ window: 'workspace', ...params }, options);
            emit(logs, value => {
                console.log('== Console service ==');
                printConsoleSnapshot(value.console);
                console.log('\n== DevTools console ==');
                printDevtools(value.devtools);
            });
            return;
        }
        default:
            throw new Error(`Unknown command: ${command}`);
    }
}

if (require.main === module) {
    runCli().catch((error) => {
        console.error(`[debug] ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    DEFAULT_DEBUG_HOST,
    DEFAULT_DEBUG_PORT,
    debugRequest,
    getHealth,
    getWindows,
    getConsole,
    getDevtools,
    getLogs,
    runCli,
};
