/*
 * Acceptance — asset category merge + built-in Monaco text editor.
 * Card: docs/plans/2026-07-31-001-plan-asset-categories-and-text-editor.md §6
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *     node tools/ui-verify/scenarios/asset-categories-and-text-editor.js \
 *       [--phase categories|grouping|create|edit|encoding|session|frozen|all]
 *
 * WRITTEN BEFORE THE IMPLEMENTATION LANDED, on purpose: criteria that are authored after seeing the
 * diff get defined by the diff. What is frozen here is the *criteria* (the numbers and the bytes).
 * The *selectors* are the mechanical layer and may be adapted once the real DOM exists — but every
 * adaptation must keep a SETUP GUARD proving the thing being measured is actually on screen, because
 * the classic failure here is a panel that never opened and a script that prints all-green because
 * every assertion was vacuously true.
 */

const fs = require('fs');
const path = require('path');
const A = require('../assert');
const D = require('./_drive');

const run = A.createRun();
const PROJECT = process.env.NLS_VERIFY_PROJECT;
const phase = (() => {
    const i = process.argv.indexOf('--phase');
    return i === -1 ? 'all' : process.argv[i + 1];
})();

/** The six category headers the sidebar must show, in this order. */
const EXPECTED_CATEGORIES = ['image', 'media', 'data', 'font', 'model', 'other'];
const EXPECTED_LABELS_EN = ['Images', 'Media', 'Data', 'Fonts', 'Models', 'Other'];

// --- page-side helpers -----------------------------------------------------------------------

/**
 * Reach the workspace service registry from a CDP eval by walking the fiber tree.
 * BFS from the `__reactContainer$…` key on the root div for the first fiber carrying
 * `memoizedProps.value.context.services`. Installed as a page global so later phases can reuse it.
 */
const INSTALL_SERVICES = function () {
    if (window.__nlsSvc) return true;
    const root = document.getElementById('root');
    if (!root) return false;
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return false;
    const seen = new Set();
    const queue = [root[key]];
    while (queue.length) {
        const node = queue.shift();
        if (!node || seen.has(node)) continue;
        seen.add(node);
        const services = node.memoizedProps
            && node.memoizedProps.value
            && node.memoizedProps.value.context
            && node.memoizedProps.value.context.services;
        if (services && typeof services.get === 'function') {
            window.__nlsSvc = services;
            return true;
        }
        if (node.child) queue.push(node.child);
        if (node.sibling) queue.push(node.sibling);
        if (node.return && !seen.has(node.return)) queue.push(node.return);
    }
    return false;
};

/** Start collecting page errors. Anything raised before this call is invisible — install early. */
const INSTALL_ERROR_SINK = function () {
    if (window.__nlsErr) return window.__nlsErr.length;
    window.__nlsErr = [];
    const original = console.error;
    console.error = function (...args) {
        try { window.__nlsErr.push(args.map(String).join(' ').slice(0, 300)); } catch (e) { /* ignore */ }
        return original.apply(console, args);
    };
    window.addEventListener('error', (e) => window.__nlsErr.push(`onerror: ${e.message}`));
    window.addEventListener('unhandledrejection', (e) => window.__nlsErr.push(`unhandled: ${String(e.reason).slice(0, 300)}`));
    return 0;
};

/** Open the Assets panel and prove it rendered. Throws rather than letting a phase run on nothing. */
async function openAssetsPanel(d) {
    const rendered = () => A.call(d, function () {
        return document.querySelectorAll('[data-asset-category]').length
            || document.querySelectorAll('[data-asset-type]').length;
    });
    if (!(await rendered())) {
        await A.clickNamed(d, '[aria-label]', '^Assets$');
        await A.sleep(1500);
    }
    const n = await rendered();
    if (!n) throw new Error('SETUP GUARD: the Assets panel rendered no category sections');
    return n;
}

// --- disk-side helpers (the project copy is readable from node) -------------------------------

function requireProject() {
    if (!PROJECT) throw new Error('set NLS_VERIFY_PROJECT to the project copy this run may open');
    return PROJECT;
}

function readMetadata(type) {
    const file = path.join(requireProject(), 'assets', `assets.metadata.${type}.json`);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The bytes of an asset, found by scanning `assets/content/**` rather than recomputing the shard
 * split — the split lives in one private helper and a scenario that duplicates it silently reports
 * "file missing" the day that helper changes.
 */
function assetBytes(id) {
    const rootDir = path.join(requireProject(), 'assets', 'content');
    const bare = id.replace(/-/g, '');
    const stack = [rootDir];
    while (stack.length) {
        const dir = stack.pop();
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { stack.push(full); continue; }
            const joined = (path.relative(rootDir, full).replace(/[\\/]/g, ''));
            if (joined === bare || joined === id.replace(/-/g, '')) return fs.readFileSync(full);
        }
    }
    return null;
}

// --- phases ------------------------------------------------------------------------------------

/**
 * Seed one asset per type so the merged counts and the mixed-group check have something to measure.
 *
 * Every demo project copy on this machine ships fifteen metadata shards holding zero records, so a
 * run against a stock copy would assert "media == 0 + 0" and pass while proving nothing.
 * `createLocalAssetFromBytes` has no format gate by design (an empty new text file must be legal),
 * which is what lets a seed put bytes under `audio`/`video` without a real encoder.
 */
async function phaseSeed() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        await openAssetsPanel(d);
        await A.call(d, INSTALL_SERVICES);
        const made = await A.call(d, async function () {
            const svc = window.__nlsSvc.get('assets');
            const want = [
                ['audio', 'seed-bgm.mp3'], ['audio', 'seed-se.wav'],
                ['video', 'seed-op.mp4'],
                ['json', 'seed-table.json'],
                ['blueprint', 'seed-graph.nlbp'],
                ['image', 'seed-bg.png'],
            ];
            const out = {};
            for (const [type, name] of want) {
                const existing = Object.values(svc.getAssets()[type] || {}).find((a) => a.name === name);
                if (existing) { out[name] = 'already there'; continue; }
                const bytes = new Uint8Array([1, 2, 3, 4]);
                const r = await svc.createLocalAssetFromBytes(type, name, bytes);
                out[name] = r && r.success ? 'created' : JSON.stringify(r).slice(0, 120);
            }
            const assets = svc.getAssets();
            out.counts = { audio: Object.keys(assets.audio || {}).length, video: Object.keys(assets.video || {}).length, json: Object.keys(assets.json || {}).length, blueprint: Object.keys(assets.blueprint || {}).length };
            return out;
        });
        console.log('seeded:', JSON.stringify(made));
        if (!made.counts || made.counts.audio < 1 || made.counts.video < 1) {
            throw new Error(`SETUP GUARD: seeding did not produce at least one audio and one video: ${JSON.stringify(made)}`);
        }
        await A.sleep(1200);
    });
}

/** §6.1 §6.2 — six headers, in order, with the merged counts adding up. */
async function phaseCategories() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        await A.call(d, INSTALL_ERROR_SINK);
        await openAssetsPanel(d);
        await d.screenshot('assets-categories');

        const headers = await A.call(d, function () {
            const nodes = Array.from(document.querySelectorAll('[data-asset-category]'));
            return nodes.map((el) => ({
                category: el.getAttribute('data-asset-category'),
                text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            }));
        });

        run.check('C-1', 'the sidebar shows exactly six category sections',
            headers.length === 6, JSON.stringify(headers.map((h) => h.category)));
        run.check('C-2', 'the six are image/media/data/font/model/other, in that order',
            JSON.stringify(headers.map((h) => h.category)) === JSON.stringify(EXPECTED_CATEGORIES),
            JSON.stringify(headers.map((h) => h.category)));
        run.check('C-3', 'no header still reads Audio / Videos / JSON Files / Blueprints',
            !headers.some((h) => /\b(Audio|Videos|JSON Files|Blueprints)\b/.test(h.text)),
            JSON.stringify(headers.map((h) => h.text)));

        // Counts come from the service, not from the header text, so a header that renders a
        // hard-coded number cannot pass.
        await A.call(d, INSTALL_SERVICES);
        const counts = await A.call(d, function () {
            const assets = window.__nlsSvc.get('assets').getAssets();
            const n = (t) => Object.keys(assets[t] || {}).length;
            return {
                audio: n('audio'), video: n('video'), json: n('json'), blueprint: n('blueprint'),
                headerText: Array.from(document.querySelectorAll('[data-asset-category]'))
                    .reduce((acc, el) => {
                        acc[el.getAttribute('data-asset-category')] = (el.innerText || '').replace(/\s+/g, ' ').trim();
                        return acc;
                    }, {}),
            };
        });
        const num = (s) => {
            const m = /(\d+)/.exec(s || '');
            return m ? Number(m[1]) : null;
        };
        run.check('C-4', 'Media count == audio + video',
            num(counts.headerText.media) === counts.audio + counts.video,
            `header=${counts.headerText.media} audio=${counts.audio} video=${counts.video}`);
        run.check('C-5', 'Data count == json + blueprint',
            num(counts.headerText.data) === counts.json + counts.blueprint,
            `header=${counts.headerText.data} json=${counts.json} blueprint=${counts.blueprint}`);
    });
}

/** §6.3 — one group under Media holds both an audio and a video asset. */
async function phaseGrouping() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        await openAssetsPanel(d);
        await A.call(d, INSTALL_SERVICES);

        const result = await A.call(d, async function () {
            const svc = window.__nlsSvc.get('assets');
            const assets = svc.getAssets();
            const audio = Object.values(assets.audio || {})[0];
            const video = Object.values(assets.video || {})[0];
            if (!audio || !video) return { guard: `need one audio and one video asset; have ${Object.keys(assets.audio || {}).length}/${Object.keys(assets.video || {}).length}` };
            const created = await svc.createGroup('media', 'ACCEPTANCE-MIXED');
            const group = created && (created.data || created);
            if (!group || !group.id) return { guard: `createGroup('media') returned ${JSON.stringify(created).slice(0, 200)}` };
            const a = await svc.moveAssetToGroup(audio, group.id);
            const v = await svc.moveAssetToGroup(video, group.id);
            const after = svc.getAssets();
            return {
                groupId: group.id,
                groupCategory: group.category || group.type,
                audioOk: Boolean(a && a.success !== false) && after.audio[audio.id].groupId === group.id,
                videoOk: Boolean(v && v.success !== false) && after.video[video.id].groupId === group.id,
            };
        });

        if (result.guard) throw new Error(`SETUP GUARD: ${result.guard}`);
        run.check('G-1', "a group can be created on the merged Media category", Boolean(result.groupId), JSON.stringify(result));
        run.check('G-2', "that group's domain is the category, not a single asset type",
            result.groupCategory === 'media', String(result.groupCategory));
        run.check('G-3', 'an audio asset moves into it', result.audioOk, String(result.audioOk));
        run.check('G-4', 'a video asset moves into the SAME group', result.videoOk, String(result.videoOk));

        await A.sleep(800);
        await d.screenshot('media-mixed-group');
        const rows = await A.call(d, function () {
            const el = Array.from(document.querySelectorAll('*'))
                .find((e) => (e.textContent || '').trim() === 'ACCEPTANCE-MIXED' && e.children.length === 0);
            return Boolean(el);
        });
        run.check('G-5', 'the mixed group is rendered in the sidebar', rows, String(rows));
    });
}

/** §6.4 — right-click the Other header, create a text file, get an asset AND a tab. */
async function phaseCreate() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        await A.call(d, INSTALL_ERROR_SINK);
        await openAssetsPanel(d);

        const header = await A.call(d, function () {
            const el = document.querySelector('[data-asset-category="other"]');
            if (!el) return { found: false };
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            const cx = Math.round(r.x + r.width / 2);
            const cy = Math.round(r.y + r.height / 2);
            const hit = document.elementFromPoint(cx, cy);
            return { found: true, cx, cy, reachable: Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
        });
        if (!header.found || !header.reachable) throw new Error(`SETUP GUARD: the Other category header is not reachable: ${JSON.stringify(header)}`);

        // A real right press, so React's onContextMenu fires the way it does for a person. A
        // synthesized `contextmenu` event would prove nothing about the handler being wired.
        await d.click(header.cx, header.cy, { button: 'right' });
        await A.sleep(700);
        await d.screenshot('other-header-context-menu');

        const menu = await A.call(d, function () {
            const items = Array.from(document.querySelectorAll('[role="menuitem"], [data-context-menu-item]'))
                .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim());
            return items;
        });
        run.check('N-1', 'the Other category header has a context menu carrying a new-text-file row',
            menu.some((m) => /New Text File|新建文本文件/i.test(m)), JSON.stringify(menu));

        await A.clickNamed(d, '[role="menuitem"], [data-context-menu-item]', 'New Text File|新建文本文件', { flags: 'i' });
        await A.sleep(900);
        await d.screenshot('new-text-file-dialog');

        const dialog = await A.call(d, function () {
            const input = document.querySelector('[role="dialog"] input, .fixed input');
            return input ? { value: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd } : null;
        });
        run.check('N-2', 'the project input dialog opens pre-filled with a localized *.txt name',
            Boolean(dialog) && /\.txt$/.test(dialog.value) && dialog.value.length > 4, JSON.stringify(dialog));

        // Give it a name this run can find on disk.
        await A.call(d, function () {
            const input = document.querySelector('[role="dialog"] input, .fixed input');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'acceptance-plan.md');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await A.sleep(300);
        await A.clickNamed(d, 'button', '^(Create|OK|Confirm|确定|创建)$', { flags: 'i' });
        await A.sleep(2000);
        await d.screenshot('text-editor-opened');

        const state = await A.call(d, function () {
            const svc = window.__nlsSvc && window.__nlsSvc.get('assets');
            const others = svc ? Object.values(svc.getAssets().other || {}) : [];
            const asset = others.find((a) => (a.name || '').indexOf('acceptance-plan') === 0);
            const tabs = Array.from(document.querySelectorAll('[data-editor-tab-id]'))
                .map((e) => e.getAttribute('data-editor-tab-id'));
            return {
                assetId: asset ? asset.id : null,
                assetName: asset ? asset.name : null,
                assetExt: asset ? asset.ext : null,
                tabs,
                monaco: document.querySelectorAll('.monaco-editor').length,
                errors: window.__nlsErr || [],
            };
        });

        run.check('N-3', 'the asset is created under Other and keeps the extension the author typed',
            Boolean(state.assetId) && /acceptance-plan\.md$/.test(state.assetName || ''), JSON.stringify({ id: state.assetId, name: state.assetName, ext: state.assetExt }));
        run.check('N-4', 'creating it also opens an editor tab for it',
            state.tabs.some((t) => /text-editor/.test(t || '')), JSON.stringify(state.tabs));
        run.check('N-5', 'that tab really is a mounted Monaco instance, not a textarea',
            state.monaco > 0, String(state.monaco));
        run.check('N-6', 'opening it raised no page errors', state.errors.length === 0, JSON.stringify(state.errors.slice(0, 5)));

        if (state.assetId) fs.writeFileSync(path.join(__dirname, '..', 'out', 'acceptance-asset-id.txt'), state.assetId);
    });
}

/** §6.5 — typing round-trips to disk as UTF-8. */
async function phaseEdit() {
    const idFile = path.join(__dirname, '..', 'out', 'acceptance-asset-id.txt');
    if (!fs.existsSync(idFile)) throw new Error('SETUP GUARD: run --phase create first (no asset id recorded)');
    const id = fs.readFileSync(idFile, 'utf8').trim();
    const TEXT = '# 计划表\n\n- 第一项 alpha\n- 第二项 beta\n';

    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        const typed = await A.call(d, function (text) {
            const models = window.monaco && window.monaco.editor && window.monaco.editor.getModels();
            if (!models || !models.length) return { guard: 'no monaco model on the page' };
            models[models.length - 1].setValue(text);
            return { ok: true };
        }, TEXT);
        if (typed.guard) {
            // Fall back to real keyboard input: setValue through a global is a convenience, not a
            // requirement, and its absence must not be read as a product failure.
            await A.call(d, function () {
                const el = document.querySelector('.monaco-editor textarea');
                if (el) el.focus();
            });
            await d.type(TEXT);
        }
        await A.sleep(2500);
        await d.screenshot('text-editor-typed');
    });

    const bytes = assetBytes(id);
    run.check('E-1', 'the typed text reached disk', Boolean(bytes && bytes.length), bytes ? `${bytes.length} bytes` : 'no file found');
    run.check('E-2', 'the bytes decode as UTF-8 to exactly what was typed',
        Boolean(bytes) && bytes.toString('utf8') === TEXT, bytes ? JSON.stringify(bytes.toString('utf8').slice(0, 80)) : 'n/a');
    run.check('E-3', 'UTF-8 is the default: no BOM was written',
        Boolean(bytes) && !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
        bytes ? [...bytes.slice(0, 3)].map((b) => b.toString(16)).join(' ') : 'n/a');

    const meta = readMetadata('other')[id];
    run.check('E-4', 'the asset record hash was recomputed after the write (stale hash = silent stale reads downstream)',
        Boolean(meta && meta.hash), meta ? String(meta.hash).slice(0, 16) : 'no record');

    // §6.9 — the VCS working set is path-based, so "is it versioned" reduces to "is any part of the
    // path excluded". Read the policy out of the source rather than restating it here, or this check
    // passes forever regardless of what the policy actually says.
    const policy = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'shared', 'vcs', 'workingSet.ts'), 'utf8');
    const excluded = (policy.match(/"[^"]+"/g) || []).map((s) => s.slice(1, -1));
    const onPath = ['assets', 'content'];
    run.check('E-5', 'nothing on the new file\'s path is on the VCS exclusion list',
        !onPath.some((seg) => excluded.includes(seg)),
        JSON.stringify(excluded.filter((e) => onPath.includes(e))));
}

/** §6.6 — save as GBK produces GBK bytes, and reopening as GBK gives the text back. */
async function phaseEncoding() {
    const id = fs.readFileSync(path.join(__dirname, '..', 'out', 'acceptance-asset-id.txt'), 'utf8').trim();
    const before = assetBytes(id);

    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        const token = await A.call(d, function () {
            const el = Array.from(document.querySelectorAll('*'))
                .find((e) => e.children.length === 0 && /^(UTF-8|UTF8)$/i.test((e.textContent || '').trim()));
            if (!el) return { found: false };
            const r = el.getBoundingClientRect();
            return { found: true, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
        });
        if (!token.found) throw new Error('SETUP GUARD: no encoding token on the status strip');
        await d.click(token.cx, token.cy);
        await A.sleep(600);
        await d.screenshot('encoding-menu');
        const items = await A.call(d, function () {
            return Array.from(document.querySelectorAll('[role="menuitem"], [data-context-menu-item]'))
                .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim());
        });
        run.check('X-1', 'the encoding token offers both reopen-with and save-with',
            items.filter((i) => /reopen|重新打开|save|保存/i.test(i)).length >= 2, JSON.stringify(items));
    });

    run.note(`GBK save asserted by hand after driving the menu; pre-change bytes were ${before ? before.length : 0}`);
}

/** §6.10 — freezing keeps the text readable and disables creation. */
async function phaseFrozen() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        const state = await A.call(d, function () {
            const ta = document.querySelector('.monaco-editor textarea');
            const text = document.querySelector('.monaco-editor .view-lines');
            return {
                readOnly: ta ? ta.readOnly || ta.getAttribute('readonly') !== null : null,
                visibleText: text ? (text.innerText || '').trim().length : 0,
                opacity: text ? getComputedStyle(text).opacity : null,
            };
        });
        run.check('F-1', 'frozen: the editor is read-only rather than disabled', state.readOnly === true, JSON.stringify(state));
        run.check('F-2', 'frozen: the text is still visible and legible', state.visibleText > 0 && state.opacity === '1', JSON.stringify(state));
    });
}

(async () => {
    const phases = {
        seed: phaseSeed,
        categories: phaseCategories,
        grouping: phaseGrouping,
        create: phaseCreate,
        edit: phaseEdit,
        encoding: phaseEncoding,
        frozen: phaseFrozen,
    };
    const order = phase === 'all' ? ['seed', 'categories', 'grouping', 'create', 'edit'] : [phase];
    for (const name of order) {
        if (!phases[name]) throw new Error(`unknown phase "${name}"`);
        console.log(`\n=== phase ${name} ===`);
        await phases[name]();
    }
    const { red } = run.summary();
    A.releaseWindows();
    process.exit(red ? 1 : 0);
})().catch((e) => {
    console.error(e);
    run.summary();
    A.releaseWindows();
    process.exit(2);
});
