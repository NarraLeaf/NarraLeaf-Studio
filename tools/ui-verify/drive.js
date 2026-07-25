#!/usr/bin/env node

/*
 * Mechanical CDP driver for UI verification runs.
 *
 * Connect to a window of the running dev app, click, press keys, evaluate an expression, take a
 * screenshot. Nothing in this file decides whether a run passed: scenarios and assertions live
 * with whoever is doing the verifying.
 *
 * Transport reuses project/app/cdp.js (target lookup + Runtime.evaluate); this layer adds the
 * input and screenshot primitives that a UI pass needs.
 */

const fs = require('fs');
const path = require('path');

const { connectToTarget, listTargets, DEFAULT_CDP_HOST, DEFAULT_CDP_PORT } = require('../../project/app/cdp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT_DIR = path.join(__dirname, 'out');
const DEFAULT_TARGET = 'workspace';

/** Alt / Ctrl / Meta / Shift, as CDP's `modifiers` bit mask. */
const MODIFIER_BITS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

/** windowsVirtualKeyCode + DOM `code` for the non-printable keys a UI pass actually presses. */
const NAMED_KEYS = {
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    Escape: { code: 'Escape', keyCode: 27 },
    Tab: { code: 'Tab', keyCode: 9 },
    Backspace: { code: 'Backspace', keyCode: 8 },
    Delete: { code: 'Delete', keyCode: 46 },
    Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    Home: { code: 'Home', keyCode: 36 },
    End: { code: 'End', keyCode: 35 },
    PageUp: { code: 'PageUp', keyCode: 33 },
    PageDown: { code: 'PageDown', keyCode: 34 },
};

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "Control+ArrowRight" -> { modifiers, key, code, keyCode, text }. */
function parseKeySpec(spec) {
    const parts = String(spec).split('+').filter(Boolean);
    const name = parts.pop();
    let modifiers = 0;
    for (const part of parts) {
        const bit = MODIFIER_BITS[part.toLowerCase()];
        if (!bit) {
            throw new Error(`Unknown modifier "${part}" in key spec "${spec}"`);
        }
        modifiers |= bit;
    }

    const named = NAMED_KEYS[name];
    if (named) {
        return { modifiers, key: named.key ?? name, code: named.code, keyCode: named.keyCode, text: named.text };
    }
    if (name.length === 1) {
        const upper = name.toUpperCase();
        return {
            modifiers,
            key: name,
            code: /[a-z]/i.test(name) ? `Key${upper}` : `Digit${name}`,
            keyCode: upper.charCodeAt(0),
            // A modified chord (Ctrl+S) is not text input.
            text: modifiers & ~MODIFIER_BITS.shift ? undefined : name,
        };
    }
    throw new Error(`Unknown key "${name}" in key spec "${spec}"`);
}

class UiDriver {
    constructor(client, options = {}) {
        this.client = client;
        this.target = client.target;
        this.outDir = options.outDir ?? DEFAULT_OUT_DIR;
        this.prefix = options.prefix ?? '';
    }

    /** Evaluate an expression in the page (promises awaited, result returned by value). */
    evaluate(expression) {
        return this.client.evaluate(expression);
    }

    /**
     * Left-click at CSS pixel coordinates. Screenshot pixels are CSS px * devicePixelRatio, so
     * divide by `dpr()` before passing coordinates read off an image.
     */
    async click(x, y, options = {}) {
        const { button = 'left', clickCount = 1, modifiers = 0, settleMs = 120 } = options;
        const base = { x: Math.round(x), y: Math.round(y), button, modifiers };
        await this.client.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 });
        await this.client.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', clickCount, buttons: 1 });
        await this.client.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', clickCount, buttons: 0 });
        if (settleMs > 0) await delay(settleMs);
    }

    /** Move the pointer without pressing (hover states, menu reveal). */
    async hover(x, y, options = {}) {
        const { settleMs = 80 } = options;
        await this.client.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: Math.round(x), y: Math.round(y), buttons: 0, modifiers: 0,
        });
        if (settleMs > 0) await delay(settleMs);
    }

    /** Press key specs in order, e.g. keys('Escape') or keys('Control+ArrowRight', 'Enter'). */
    async keys(...specs) {
        for (const spec of specs.flat()) {
            const { modifiers, key, code, keyCode, text } = parseKeySpec(spec);
            const shared = { modifiers, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
            await this.client.send('Input.dispatchKeyEvent', {
                ...shared,
                type: text ? 'keyDown' : 'rawKeyDown',
                text,
                unmodifiedText: text,
            });
            await this.client.send('Input.dispatchKeyEvent', { ...shared, type: 'keyUp' });
            await delay(30);
        }
    }

    /** Insert text at the caret (reliable where synthesized keystrokes are not). */
    async type(text) {
        await this.client.send('Input.insertText', { text: String(text) });
        await delay(30);
    }

    /** The page's devicePixelRatio — the screenshot-px : CSS-px ratio. */
    dpr() {
        return this.client.evaluate('window.devicePixelRatio');
    }

    /** Capture the window to `<outDir>/<prefix><name>.png` and return the absolute path. */
    async screenshot(name) {
        await this.client.enable('Page');
        const result = await this.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const file = path.join(this.outDir, `${this.prefix}${String(name).replace(/[^\w.-]+/g, '-')}.png`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
        return file;
    }

    close() {
        this.client.close();
    }
}

/** Connect to the first target whose title/url/type/id contains `options.target`. */
async function connect(options = {}) {
    const client = await connectToTarget(options);
    return new UiDriver(client, options);
}

async function withDriver(options, fn) {
    const resolvedOptions = typeof options === 'function' ? {} : options;
    const task = typeof options === 'function' ? options : fn;
    if (typeof task !== 'function') {
        throw new TypeError('withDriver requires a callback');
    }
    const driver = await connect(resolvedOptions);
    try {
        return await task(driver);
    } finally {
        driver.close();
    }
}

// --- CLI ----------------------------------------------------------------------------------------

function parseArgs(argv) {
    const options = { host: DEFAULT_CDP_HOST, port: DEFAULT_CDP_PORT, target: DEFAULT_TARGET, outDir: DEFAULT_OUT_DIR };
    const positional = [];
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const take = (name) => {
            const value = argv[i + 1];
            if (value == null) throw new Error(`${name} requires a value`);
            i += 1;
            return value;
        };
        if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg === '--host') options.host = take(arg);
        else if (arg === '--port') options.port = Number(take(arg));
        else if (arg === '--target') options.target = take(arg);
        else if (arg === '--out') options.outDir = path.resolve(REPO_ROOT, take(arg));
        else if (arg === '--prefix') options.prefix = take(arg);
        else positional.push(arg);
    }
    return { command: positional.shift() ?? 'targets', args: positional, options };
}

function printHelp() {
    console.log(`Usage:
  node tools/ui-verify/drive.js targets
  node tools/ui-verify/drive.js shot <name>       [--target <q>] [--out <dir>] [--prefix <p>]
  node tools/ui-verify/drive.js click <x> <y>     [--target <q>]
  node tools/ui-verify/drive.js hover <x> <y>     [--target <q>]
  node tools/ui-verify/drive.js keys <spec>...    [--target <q>]
  node tools/ui-verify/drive.js type <text>       [--target <q>]
  node tools/ui-verify/drive.js eval <expression> [--target <q>]

Options:
  --host <host>   CDP host. Default: ${DEFAULT_CDP_HOST}
  --port <port>   CDP port. Default: ${DEFAULT_CDP_PORT}
  --target <q>    Substring of the target title/url/type/id. Default: ${DEFAULT_TARGET}
  --out <dir>     Screenshot directory, relative to the repo root. Default: tools/ui-verify/out
  --prefix <p>    Screenshot filename prefix.

Coordinates are CSS pixels. Screenshot pixels are CSS px * devicePixelRatio.`);
}

function print(value) {
    if (typeof value === 'string') console.log(value);
    else console.log(JSON.stringify(value, null, 2));
}

async function runCli(argv = process.argv.slice(2)) {
    const { command, args, options } = parseArgs(argv);
    if (options.help) {
        printHelp();
        return;
    }

    if (command === 'targets') {
        for (const [index, target] of (await listTargets(options)).entries()) {
            console.log(`${index}: [${target.type}] ${target.title}`);
            if (target.url) console.log(`   ${target.url}`);
        }
        return;
    }

    await withDriver(options, async (driver) => {
        if (command === 'shot') {
            print(await driver.screenshot(args[0] ?? 'shot'));
        } else if (command === 'click') {
            await driver.click(Number(args[0]), Number(args[1]));
        } else if (command === 'hover') {
            await driver.hover(Number(args[0]), Number(args[1]));
        } else if (command === 'keys') {
            await driver.keys(...args);
        } else if (command === 'type') {
            await driver.type(args.join(' '));
        } else if (command === 'eval') {
            print(await driver.evaluate(args.join(' ')));
        } else {
            throw new Error(`Unknown command: ${command}`);
        }
    });
}

if (require.main === module) {
    runCli().catch((error) => {
        console.error(`[ui-verify] ${error.message}`);
        process.exit(1);
    });
}

module.exports = { UiDriver, connect, withDriver, listTargets, parseKeySpec, runCli, DEFAULT_OUT_DIR };
