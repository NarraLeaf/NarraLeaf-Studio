#!/usr/bin/env node

/*
 * Small Chrome DevTools Protocol helper for the NarraLeaf Studio dev app.
 *
 * Examples:
 *   node project/app/cdp.js reload
 *   node project/app/cdp.js eval "document.readyState"
 *   node project/app/cdp.js list
 *   node project/app/cdp.js call Page.captureScreenshot '{"format":"png"}'
 */

const { EventEmitter } = require('events');
const WebSocket = require('ws');

const DEFAULT_CDP_HOST = '127.0.0.1';
const DEFAULT_CDP_PORT = 9222;
const DEFAULT_TARGET_QUERY = 'workspace';
const DEFAULT_RELOAD_SETTLE_MS = 250;
const DEFAULT_LOAD_TIMEOUT_MS = 10000;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`GET ${url} failed with ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function includesText(value, query) {
    return String(value ?? '').toLowerCase().includes(query);
}

function findMatchingTarget(targets, query = DEFAULT_TARGET_QUERY) {
    if (!targets.length) {
        throw new Error('No CDP targets are available. Start dev mode with --cdp first.');
    }

    if (!query) {
        return targets[0];
    }

    const normalizedQuery = String(query).toLowerCase();
    return targets.find((target) => (
        includesText(target.title, normalizedQuery)
        || includesText(target.url, normalizedQuery)
        || includesText(target.type, normalizedQuery)
        || includesText(target.id, normalizedQuery)
    )) ?? targets[0];
}

function remoteObjectToValue(remoteObject) {
    if (!remoteObject) return undefined;
    if (Object.prototype.hasOwnProperty.call(remoteObject, 'value')) return remoteObject.value;
    if (Object.prototype.hasOwnProperty.call(remoteObject, 'unserializableValue')) {
        return remoteObject.unserializableValue;
    }
    if (remoteObject.type === 'undefined') return undefined;
    return remoteObject.description;
}

function formatException(exceptionDetails) {
    if (!exceptionDetails) return 'Unknown evaluation error';
    const message = exceptionDetails.exception?.description
        ?? exceptionDetails.text
        ?? 'Evaluation failed';
    const line = exceptionDetails.lineNumber == null ? '' : `:${exceptionDetails.lineNumber + 1}`;
    const column = exceptionDetails.columnNumber == null ? '' : `:${exceptionDetails.columnNumber + 1}`;
    return `${message}${line}${column}`;
}

class CdpClient extends EventEmitter {
    constructor(socket, target) {
        super();
        this.socket = socket;
        this.target = target;
        this.nextId = 0;
        this.pending = new Map();

        this.socket.on('message', (data) => {
            const message = JSON.parse(data.toString());
            if (message.id && this.pending.has(message.id)) {
                const { resolve, reject } = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) {
                    reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ''}`));
                } else {
                    resolve(message.result);
                }
                return;
            }

            if (message.method) {
                this.emit(message.method, message.params);
                this.emit('event', message);
            }
        });

        this.socket.on('close', () => {
            for (const { reject } of this.pending.values()) {
                reject(new Error('CDP socket closed before a response was received'));
            }
            this.pending.clear();
        });
    }

    send(method, params = {}) {
        const id = ++this.nextId;
        this.socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
    }

    async enable(...domains) {
        for (const domain of domains) {
            await this.send(`${domain}.enable`);
        }
    }

    waitForEvent(method, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out waiting for ${method}`));
            }, timeoutMs);

            const handler = (params) => {
                cleanup();
                resolve(params);
            };

            const cleanup = () => {
                clearTimeout(timer);
                this.off(method, handler);
            };

            this.on(method, handler);
        });
    }

    async reload(options = {}) {
        const {
            ignoreCache = true,
            waitForLoad = true,
            timeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
            settleMs = DEFAULT_RELOAD_SETTLE_MS,
        } = options;

        await this.enable('Page');
        const loadPromise = waitForLoad
            ? this.waitForEvent('Page.loadEventFired', timeoutMs).catch(() => null)
            : null;

        await this.send('Page.reload', { ignoreCache });
        if (loadPromise) await loadPromise;
        if (settleMs > 0) await delay(settleMs);
    }

    async evaluate(expression, options = {}) {
        const {
            awaitPromise = true,
            returnByValue = true,
            userGesture = true,
        } = options;

        await this.enable('Runtime');
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise,
            returnByValue,
            userGesture,
        });

        if (result.exceptionDetails) {
            throw new Error(formatException(result.exceptionDetails));
        }

        return returnByValue ? remoteObjectToValue(result.result) : result.result;
    }

    close() {
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
            this.socket.close();
        }
    }
}

async function listTargets(options = {}) {
    const host = options.host ?? DEFAULT_CDP_HOST;
    const port = options.port ?? DEFAULT_CDP_PORT;
    return fetchJson(`http://${host}:${port}/json/list`);
}

async function findTarget(options = {}) {
    const targets = await listTargets(options);
    const target = findMatchingTarget(targets, options.target ?? DEFAULT_TARGET_QUERY);
    return { target, targets };
}

async function connectToTarget(options = {}) {
    const { target } = await findTarget(options);
    if (!target.webSocketDebuggerUrl) {
        throw new Error(`Target "${target.title ?? target.id}" does not expose webSocketDebuggerUrl`);
    }

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });

    return new CdpClient(socket, target);
}

async function withCdp(options, fn) {
    const resolvedOptions = typeof options === 'function' ? {} : options;
    const task = typeof options === 'function' ? options : fn;
    if (typeof task !== 'function') {
        throw new TypeError('withCdp requires a callback');
    }

    const client = await connectToTarget(resolvedOptions);
    try {
        return await task(client);
    } finally {
        client.close();
    }
}

function printValue(value) {
    if (typeof value === 'string') {
        console.log(value);
        return;
    }
    if (value === undefined) {
        console.log('undefined');
        return;
    }
    console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
    console.log(`Usage:
  node project/app/cdp.js reload [options]
  node project/app/cdp.js eval <expression> [options]
  node project/app/cdp.js call <method> [jsonParams] [options]
  node project/app/cdp.js list [options]

Options:
  --host <host>          CDP host. Default: ${DEFAULT_CDP_HOST}
  --port <port>          CDP port. Default: ${DEFAULT_CDP_PORT}
  --target <query>       Match target by title/url/type/id. Default: ${DEFAULT_TARGET_QUERY}
  --settle-ms <ms>       Extra delay after reload load event. Default: ${DEFAULT_RELOAD_SETTLE_MS}
  --timeout-ms <ms>      Load-event timeout for reload. Default: ${DEFAULT_LOAD_TIMEOUT_MS}
  --cache                Allow cached resources during reload.

Module:
  const { withCdp } = require('./project/app/cdp');
  await withCdp(async (cdp) => {
      await cdp.reload();
      console.log(await cdp.evaluate('document.readyState'));
  });`);
}

function readOptionValue(argv, index, name) {
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) {
        throw new Error(`${name} requires a value`);
    }
    return value;
}

function parseCliArgs(argv) {
    const options = {
        host: DEFAULT_CDP_HOST,
        port: DEFAULT_CDP_PORT,
        target: DEFAULT_TARGET_QUERY,
        ignoreCache: true,
        settleMs: DEFAULT_RELOAD_SETTLE_MS,
        timeoutMs: DEFAULT_LOAD_TIMEOUT_MS,
    };
    const positional = [];

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }

        if (arg === '--cache') {
            options.ignoreCache = false;
            continue;
        }

        if (arg === '--host') {
            options.host = readOptionValue(argv, i, arg);
            i += 1;
            continue;
        }
        if (arg.startsWith('--host=')) {
            options.host = arg.slice('--host='.length);
            continue;
        }

        if (arg === '--port') {
            options.port = Number(readOptionValue(argv, i, arg));
            i += 1;
            continue;
        }
        if (arg.startsWith('--port=')) {
            options.port = Number(arg.slice('--port='.length));
            continue;
        }

        if (arg === '--target') {
            options.target = readOptionValue(argv, i, arg);
            i += 1;
            continue;
        }
        if (arg.startsWith('--target=')) {
            options.target = arg.slice('--target='.length);
            continue;
        }

        if (arg === '--settle-ms' || arg === '--wait-ms' || arg === '--wait') {
            options.settleMs = Number(readOptionValue(argv, i, arg));
            i += 1;
            continue;
        }
        if (arg.startsWith('--settle-ms=')) {
            options.settleMs = Number(arg.slice('--settle-ms='.length));
            continue;
        }
        if (arg.startsWith('--wait-ms=')) {
            options.settleMs = Number(arg.slice('--wait-ms='.length));
            continue;
        }
        if (arg.startsWith('--wait=')) {
            options.settleMs = Number(arg.slice('--wait='.length));
            continue;
        }

        if (arg === '--timeout-ms') {
            options.timeoutMs = Number(readOptionValue(argv, i, arg));
            i += 1;
            continue;
        }
        if (arg.startsWith('--timeout-ms=')) {
            options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
            continue;
        }

        positional.push(arg);
    }

    if (!Number.isInteger(options.port) || options.port <= 0) {
        throw new Error(`Invalid --port value: ${options.port}`);
    }
    if (!Number.isFinite(options.settleMs) || options.settleMs < 0) {
        throw new Error(`Invalid --settle-ms value: ${options.settleMs}`);
    }
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
        throw new Error(`Invalid --timeout-ms value: ${options.timeoutMs}`);
    }

    return {
        command: positional.shift() ?? 'reload',
        args: positional,
        options,
    };
}

async function runCli(argv = process.argv.slice(2)) {
    const { command, args, options } = parseCliArgs(argv);

    if (options.help) {
        printHelp();
        return;
    }

    if (command === 'list') {
        const targets = await listTargets(options);
        for (const [index, target] of targets.entries()) {
            console.log(`${index}: [${target.type}] ${target.title}`);
            if (target.url) console.log(`   ${target.url}`);
        }
        return;
    }

    if (command === 'reload') {
        await withCdp(options, async (client) => {
            await client.reload({
                ignoreCache: options.ignoreCache,
                timeoutMs: options.timeoutMs,
                settleMs: options.settleMs,
            });
            const readyState = await client.evaluate('document.readyState');
            console.log(`ready: ${readyState}`);
        });
        return;
    }

    if (command === 'eval') {
        const expression = args.join(' ');
        if (!expression) throw new Error('eval requires an expression');
        await withCdp(options, async (client) => {
            printValue(await client.evaluate(expression));
        });
        return;
    }

    if (command === 'call') {
        const [method, rawParams] = args;
        if (!method) throw new Error('call requires a CDP method, for example Page.reload');
        const params = rawParams ? JSON.parse(rawParams) : {};
        await withCdp(options, async (client) => {
            printValue(await client.send(method, params));
        });
        return;
    }

    throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
    runCli().catch((error) => {
        console.error(`[cdp] ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    CdpClient,
    DEFAULT_CDP_HOST,
    DEFAULT_CDP_PORT,
    DEFAULT_TARGET_QUERY,
    connectToTarget,
    findTarget,
    listTargets,
    runCli,
    withCdp,
};
