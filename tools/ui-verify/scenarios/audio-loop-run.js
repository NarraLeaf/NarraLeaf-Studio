/*
 * Card 2026-07-31-001 — the three audio measurements, in one connection.
 *
 * The dev-mode window RELOADS on every "play from this row", so a probe installed with
 * Runtime.evaluate is wiped before the clip plays. Page.addScriptToEvaluateOnNewDocument is the
 * only injection that survives, and it only lives as long as the CDP session — hence one process
 * that registers, triggers, and reads without ever disconnecting.
 *
 * Fixture segments.wav: 0-2s 220Hz / 2-6s 440Hz / 6-10s 880Hz, marked in=1.003 loop=1.997 out=5.987.
 *
 *   C5  in point reaches Dev Mode          -> loopStart/offset reflect the marked region at all
 *   C6  looping clip survives its out point -> no "ended" by out + 1.5s
 *   C7  intro->loop                        -> loop=true, loopStart=1.997, loopEnd=5.987
 */

const { connect } = require('../drive');

const PORT = Number(process.env.NLS_VERIFY_PORT || 9333);
const BLOCK = process.env.NLS_VERIFY_BLOCK || '085f7bb6-2525-41ec-8ebe-f61094d3fdcf';

const PROBE = `(() => {
    window.__audioProbe = [];
    const proto = (window.AudioContext || window.webkitAudioContext).prototype;
    const orig = proto.createBufferSource;
    proto.createBufferSource = function (...a) {
        const n = orig.apply(this, a);
        // Record "ended" rather than sampling isPlaying: a clip killed by the backend's duration
        // timer ends silently, and that is exactly the defect under test.
        n.addEventListener('ended', () => { n.__endedAtCtx = n.context.currentTime; });
        n.__createdAtCtx = n.context.currentTime;
        window.__audioProbe.push(n);
        return n;
    };
    return true;
})()`;

// Read post-hoc. NEVER inside a start() hook: SoundToken assigns `loop` AFTER construction, so a
// start-time snapshot always reads loop:false/loopStart:0 and looks like a broken out point.
const READ = `JSON.stringify({
    count: (window.__audioProbe || []).length,
    nodes: (window.__audioProbe || []).map(n => ({
        loop: n.loop,
        loopStart: n.loopStart,
        loopEnd: n.loopEnd,
        createdAtCtx: n.__createdAtCtx,
        endedAtCtx: n.__endedAtCtx === undefined ? null : n.__endedAtCtx,
        ctxNow: n.context ? n.context.currentTime : null,
        ctxState: n.context ? n.context.state : null,
        bufferDur: n.buffer ? n.buffer.duration : null,
    })),
})`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * A connection held across the dev-mode reload stops answering `Runtime.evaluate` — it does not
 * error, it just never replies, so the run hangs with no output. Every read therefore gets a fresh
 * connection, and every await gets a deadline: a probe that can hang silently is worse than one
 * that fails, because a hang looks identical to "still measuring".
 */
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms)),
    ]);
}

async function readFresh(expression, label) {
    const d = await withTimeout(connect({ target: 'dev-mode', port: PORT }), 15000, `connect (${label})`);
    try {
        const path = await withTimeout(d.evaluate('location.pathname'), 15000, `path (${label})`);
        if (!String(path).includes('dev-mode')) throw new Error(`read hit the wrong window: ${path}`);
        return await withTimeout(d.evaluate(expression), 15000, label);
    } finally {
        d.close();
    }
}

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => { console.log(stamp(), ...a); };

(async () => {
    const dev = await connect({ target: 'dev-mode', port: PORT });
    const ws = await connect({ target: 'workspace', port: PORT });
    try {
        // `--target` silently falls back to targets[0] when it matches nothing, so a run started
        // after the app restarted would measure the LAUNCHER and report everything as absent.
        // Both windows get asserted, not just the one being read.
        const path = await dev.evaluate('location.pathname');
        if (!String(path).includes('dev-mode')) throw new Error(`dev target is not dev-mode: ${path}`);
        const wsPath = await ws.evaluate('location.pathname');
        if (!String(wsPath).includes('workspace')) throw new Error(`ws target is not workspace: ${wsPath}`);
        if (await dev.evaluate('document.hidden')) throw new Error('dev-mode window reports hidden');

        await dev.client.send('Page.enable', {});
        await dev.client.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
        log('probe armed for next navigation');

        // The row's action buttons are hover-revealed: without a real pointer over the row they are
        // not in the DOM at all, and the lookup reports "button missing" on a row that is right there.
        const box = await ws.evaluate(`(() => {
            const row = document.querySelector('[data-story-row-block-id="${BLOCK}"]');
            if (!row) return null;
            row.scrollIntoView({ block: 'center' });
            const r = row.getBoundingClientRect();
            return JSON.stringify({ x: r.x + r.width - 60, y: r.y + r.height / 2 });
        })()`);
        if (!box) throw new Error('story row not in the DOM — is its editor tab active?');
        const { x, y } = JSON.parse(box);
        await ws.hover(x, y);
        await sleep(600);

        const hit = await ws.evaluate(`(() => {
            const row = document.querySelector('[data-story-row-block-id="${BLOCK}"]');
            if (!row) return 'row missing';
            const b = [...row.querySelectorAll('button')].find(x => /play from this row/i.test(x.getAttribute('aria-label') || ''));
            if (!b) return 'button missing';
            b.click();
            return 'clicked';
        })()`);
        log('trigger:', hit);
        if (hit !== 'clicked') throw new Error(`could not trigger playback: ${hit}`);

        // Poll for the probe to reappear rather than guessing a reload duration — a fixed sleep
        // either races the reload or wastes time, and both look like "no audio" from here.
        let armed = false;
        for (let i = 0; i < 30; i += 1) {
            await sleep(2000);
            const seen = await readFresh('typeof window.__audioProbe !== "undefined"', 'arm-poll')
                .catch(() => false);
            if (seen === true) { armed = true; break; }
            log(`  waiting for reload (${i + 1})`);
        }
        if (!armed) throw new Error('probe never reappeared after the reload');
        log('probe live on the reloaded document');

        // A real mouse press: a CDP keyboard event alone leaves the AudioContext suspended, the
        // playhead sits frozen, and it reads as a broken feature.
        const clicker = await withTimeout(connect({ target: 'dev-mode', port: PORT }), 15000, 'connect (click)');
        try { await withTimeout(clicker.click(700, 450), 15000, 'stage click'); } finally { clicker.close(); }
        await sleep(2500);

        log('--- first read ---');
        console.log(JSON.stringify(JSON.parse(await readFresh(READ, 'first read')), null, 1));

        await sleep(9000);
        log('--- second read (out point was 5.987s) ---');
        console.log(JSON.stringify(JSON.parse(await readFresh(READ, 'second read')), null, 1));
    } finally {
        dev.close();
        ws.close();
    }
})().catch(e => { console.error('\nSCRIPT FAIL:', e.message); process.exit(1); });
