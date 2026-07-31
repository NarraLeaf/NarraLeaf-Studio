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

        const hit = await ws.evaluate(`(() => {
            const row = document.querySelector('[data-story-row-block-id="${BLOCK}"]');
            if (!row) return 'row missing';
            row.scrollIntoView({ block: 'center' });
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
        for (let i = 0; i < 40; i += 1) {
            await sleep(1000);
            if (await dev.evaluate('typeof window.__audioProbe !== "undefined"')) { armed = true; break; }
        }
        if (!armed) throw new Error('probe never reappeared after the reload');
        log('probe live on the reloaded document');

        // A real mouse press: a CDP keyboard event alone leaves the AudioContext suspended.
        await dev.click(700, 450);
        await sleep(2500);

        log('--- first read ---');
        console.log(JSON.stringify(JSON.parse(await dev.evaluate(READ)), null, 1));

        await sleep(9000);
        log('--- second read (out point was 5.987s) ---');
        console.log(JSON.stringify(JSON.parse(await dev.evaluate(READ)), null, 1));
    } finally {
        dev.close();
        ws.close();
    }
})().catch(e => { console.error('\nSCRIPT FAIL:', e.message); process.exit(1); });
