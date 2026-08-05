/*
 * Acceptance - translation exchange formats (CSV / XLIFF / PO / JSON).
 * Card: docs/plans/2026-08-05-002-feat-localization-exchange-formats.md
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *   NLS_VERIFY_OUT=<empty dir> node tools/ui-verify/scenarios/localization-exchange-formats.js
 *       [--phase menu|dialog|roundtrip|all] [--format po|xliff|json|csv]
 *
 * The round-trip phase writes a real file through the native save dialog and reads it back through
 * the native open dialog, driven by ../file-dialog.ps1 - the only way to prove an export the author
 * can actually hand to a translator, since CDP cannot reach either dialog.
 *
 * Every phase carries a SETUP GUARD: a panel that never opened, or a language that was never added,
 * must fail rather than print green against an empty DOM.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('../assert');
const D = require('./_drive');

const run = A.createRun();
const PROJECT = process.env.NLS_VERIFY_PROJECT;
const OUT_DIR = process.env.NLS_VERIFY_OUT || path.join(require('os').tmpdir(), 'nls-locex-out');
const PID = process.env.NLS_VERIFY_PID;
const arg = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : process.argv[index + 1];
};
const phase = arg('phase', 'all');
const format = arg('format', 'po');

/** The locale this run works in. Added by the scenario when the project does not have it. */
const LOCALE = { code: 'ja', display: '日本語' };

const FORMAT_ROW = { csv: 'CSV', xliff: 'XLIFF 1.2', po: 'gettext PO', json: 'JSON' };
const EXTENSION = { csv: 'csv', xliff: 'xlf', po: 'po', json: 'json' };

// --- page-side helpers ---------------------------------------------------------------------------

const OPEN_PANEL = function () {
    if (document.querySelector('[data-panel-id*="localization"]')) return 'already';
    const collapsed = Array.from(document.querySelectorAll('button'))
        .find((b) => b.getAttribute('aria-label') === 'Collapsed panels');
    if (!collapsed) return 'no collapsed-panels button';
    collapsed.click();
    return 'menu';
};

const CLICK_MENU_ITEM = function (text) {
    const rows = Array.from(document.querySelectorAll('[data-context-menu="true"] *'))
        .filter((e) => e.children.length === 0 && e.textContent.includes(text));
    if (!rows.length) return false;
    rows[0].click();
    return true;
};

/** Open the "more" menu of one locale row. Scoped to the row: a document-wide probe finds another. */
const OPEN_LOCALE_MENU = function (display) {
    const row = Array.from(document.querySelectorAll('[data-panel-id] .group'))
        .find((r) => r.textContent.includes(display));
    if (!row) return false;
    const more = Array.from(row.querySelectorAll('button')).find((b) => b.getAttribute('title') === 'More');
    if (!more) return false;
    more.click();
    return true;
};

const MENU_ITEMS = function () {
    return Array.from(document.querySelectorAll('[data-context-menu="true"] *'))
        .filter((e) => e.children.length === 0 && e.textContent.trim())
        .map((e) => e.textContent.trim());
};

/** The portaled Select menu currently open, as its option labels. */
const SELECT_OPTIONS = function () {
    const menu = Array.from(document.querySelectorAll('body > div'))
        .filter((d) => (d.className || '').includes('rounded-md') && (d.className || '').includes('bg-surface-raised'))
        .pop();
    if (!menu) return [];
    return Array.from(menu.querySelectorAll('*'))
        .filter((e) => e.querySelectorAll('*').length <= 3 && e.textContent.trim())
        .map((e) => e.textContent.trim());
};

const CLICK_BUTTON = function (pattern) {
    const button = Array.from(document.querySelectorAll('button')).find((b) => new RegExp(pattern).test(b.textContent.trim()));
    if (!button) return false;
    button.click();
    return true;
};

const CLICK_SELECT_ROW = function (pattern) {
    const menu = Array.from(document.querySelectorAll('body > div'))
        .filter((d) => (d.className || '').includes('rounded-md') && (d.className || '').includes('bg-surface-raised'))
        .pop();
    if (!menu) return false;
    const row = Array.from(menu.querySelectorAll('*'))
        .find((e) => new RegExp(pattern).test(e.textContent.trim()) && e.querySelectorAll('*').length <= 3);
    if (!row) return false;
    row.click();
    return true;
};

const LOCALE_ROWS = function () {
    return Array.from(document.querySelectorAll('[data-panel-id] .group')).map((r) => r.textContent.trim());
};

// --- the native dialog ---------------------------------------------------------------------------

function driveFileDialog(text) {
    const script = path.join(__dirname, '..', 'file-dialog.ps1');
    return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-ProcId', String(PID), '-Text', text], { encoding: 'utf8' });
}

// --- phases --------------------------------------------------------------------------------------

async function ensurePanelAndLocale(d) {
    await A.call(d, OPEN_PANEL);
    await A.sleep(600);
    await d.evaluate(`(${CLICK_MENU_ITEM.toString()})("Localization")`);
    await A.sleep(600);
    const rows = await A.call(d, LOCALE_ROWS);
    // SETUP GUARD: no panel means every later probe reads an empty DOM.
    if (!rows) throw new Error('the localization panel never opened');
    if (!rows.some((row) => row.includes(LOCALE.display))) {
        await d.evaluate(`(${CLICK_BUTTON.toString()})("Add language")`);
        await A.sleep(300);
        await d.type(LOCALE.code);
        await d.keys('Enter');
        await A.sleep(800);
    }
    const after = await A.call(d, LOCALE_ROWS);
    if (!after.some((row) => row.includes(LOCALE.display))) {
        throw new Error(`language ${LOCALE.code} could not be added; saw ${JSON.stringify(after)}`);
    }
    return after;
}

async function phaseMenu(d) {
    await ensurePanelAndLocale(d);
    const opened = await d.evaluate(`(${OPEN_LOCALE_MENU.toString()})(${JSON.stringify(LOCALE.display)})`);
    if (!opened) throw new Error('the locale row menu never opened');
    await A.sleep(400);
    const items = await A.call(d, MENU_ITEMS);
    run.check('X1', 'the locale menu offers one export and one import, format-agnostic',
        items.some((i) => /^Export translations/.test(i)) && items.some((i) => /^Import translations/.test(i)), items);
    run.check('X2', 'no format is named in the menu itself',
        !items.some((i) => /CSV|XLIFF|PO|JSON/.test(i)), items);
    await d.keys('Escape');
}

async function phaseDialog(d) {
    await ensurePanelAndLocale(d);
    await d.evaluate(`(${OPEN_LOCALE_MENU.toString()})(${JSON.stringify(LOCALE.display)})`);
    await A.sleep(400);
    await d.evaluate(`(${CLICK_MENU_ITEM.toString()})("Export translations")`);
    await A.sleep(600);

    const title = await d.evaluate('document.body.innerText.includes("Export ' + LOCALE.display + ' translations")');
    run.check('X3', 'the export dialog names the language it is exporting', title, title);

    await d.evaluate(`(${CLICK_BUTTON.toString()})("^(CSV|XLIFF|gettext PO|JSON)")`);
    await A.sleep(400);
    const formats = await A.call(d, SELECT_OPTIONS);
    run.check('X4', 'all four formats are offered, each naming the tools that open it',
        ['CSV', 'XLIFF 1.2', 'gettext PO', 'JSON'].every((name) => formats.some((f) => f.startsWith(name)))
        && formats.some((f) => /Poedit/.test(f)), formats);
    // Re-pick the value that is already selected to close the menu. Escape would close the DIALOG,
    // which reads later as "the scope select has no options".
    await d.evaluate(`(${CLICK_SELECT_ROW.toString()})("^CSV")`);
    await A.sleep(300);

    await d.evaluate(`(${CLICK_BUTTON.toString()})("^(Everything|Untranslated)")`);
    await A.sleep(400);
    const scopes = (await A.call(d, SELECT_OPTIONS)).filter((s) => /^(Everything|Untranslated)/.test(s));
    run.check('X5', 'both scopes carry their own counts',
        scopes.length >= 2 && scopes.every((s) => /\(\d+\)$/.test(s)), scopes);
    await d.evaluate(`(${CLICK_SELECT_ROW.toString()})("^(Everything|Untranslated)")`);
    await A.sleep(300);
    await d.evaluate(`(${CLICK_BUTTON.toString()})("^Cancel$")`);
}

async function phaseRoundTrip(d) {
    if (!PID) throw new Error('NLS_VERIFY_PID is required: the native dialogs are driven by pid');
    if (!PROJECT) throw new Error('NLS_VERIFY_PROJECT is required to read the written translations back');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    // A name that already exists raises the overwrite confirmation, which blocks everything behind it.
    const file = path.join(OUT_DIR, `${LOCALE.code}-${Date.now()}.${EXTENSION[format]}`);

    await ensurePanelAndLocale(d);
    await d.evaluate(`(${OPEN_LOCALE_MENU.toString()})(${JSON.stringify(LOCALE.display)})`);
    await A.sleep(400);
    await d.evaluate(`(${CLICK_MENU_ITEM.toString()})("Export translations")`);
    await A.sleep(600);
    await d.evaluate(`(${CLICK_BUTTON.toString()})("^(CSV|XLIFF|gettext PO|JSON)")`);
    await A.sleep(400);
    await d.evaluate(`(${CLICK_SELECT_ROW.toString()})(${JSON.stringify('^' + FORMAT_ROW[format])})`);
    await A.sleep(400);
    await d.evaluate(`(${CLICK_BUTTON.toString()})("^Export$")`);
    await A.sleep(1200);
    const saved = driveFileDialog(file);
    await A.sleep(1200);

    run.check('X6', `the ${format} export lands on disk`, fs.existsSync(file), `${file} :: ${saved.trim()}`);
    if (!fs.existsSync(file)) return;

    // Shape checks only: the codecs have their own unit tests, and this file cannot import them
    // (they are TypeScript). What a scenario can see that a unit test cannot is that the bytes the
    // app wrote through a native dialog are the format the author picked, in their language.
    const text = fs.readFileSync(file, 'utf8');
    const SHAPE = {
        csv: [/^﻿?unit_id,context,source,target,status,note/, null],
        xliff: [/<xliff[^>]+version="1\.2"/, new RegExp(`target-language="${LOCALE.code}"`)],
        po: [/^msgid ""\r?\nmsgstr ""/m, new RegExp(`"Language: ${LOCALE.code}`)],
        json: [/"format": "narraleaf-translation"/, new RegExp(`"targetLocale": "${LOCALE.code}"`)],
    }[format];
    run.check('X7', `the bytes are ${format}`, SHAPE[0].test(text), text.slice(0, 80));
    if (SHAPE[1]) {
        run.check('X8', 'the file declares the language it is for', SHAPE[1].test(text), LOCALE.code);
    }
    // Translate one unit and hand it back through the import path. Each format needs its own edit;
    // the CSV one deliberately only matches a fully unquoted row, so it cannot corrupt an escaped
    // cell and then blame the importer.
    const marker = `ROUNDTRIP-${Date.now()}`;
    const patched = {
        csv: () => text.replace(/^([^",\r\n]+),([^",\r\n]*),([^",\r\n]*),,,\r?$/m, `$1,$2,$3,${marker},translated,`),
        xliff: () => text.replace('<target state="new"/>', `<target state="translated">${marker}</target>`),
        // Anchored to a msgctxt: the FIRST `msgstr ""` in any PO file is the header entry,
        // and rewriting that one corrupts the header while translating nothing.
        po: () => text.replace(/(msgctxt "[^"]*"\r?\nmsgid "[^"]*"\r?\n)msgstr ""/, `$1msgstr "${marker}"`),
        json: () => text.replace('"target": ""', `"target": "${marker}"`),
    }[format]();
    if (patched === text) {
        run.note('no untranslated unit to hand back; import leg skipped');
        return;
    }
    fs.writeFileSync(file, patched, 'utf8');

    await d.evaluate(`(${OPEN_LOCALE_MENU.toString()})(${JSON.stringify(LOCALE.display)})`);
    await A.sleep(400);
    await d.evaluate(`(${CLICK_MENU_ITEM.toString()})("Import translations")`);
    await A.sleep(1200);
    driveFileDialog(file);
    await A.sleep(2500);

    const stored = JSON.parse(fs.readFileSync(path.join(PROJECT, 'editor', 'localization', `${LOCALE.code}.json`), 'utf8'));
    const landed = Object.values(stored.units).some((unit) => unit.target === marker);
    run.check('X9', 'the translation handed back is in the project', landed, marker);
}

(async () => {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        if (phase === 'menu' || phase === 'all') await phaseMenu(d);
        if (phase === 'dialog' || phase === 'all') await phaseDialog(d);
        if (phase === 'roundtrip' || phase === 'all') await phaseRoundTrip(d);
    });
    const { red } = run.summary();
    process.exit(red === 0 ? 0 : 1);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
