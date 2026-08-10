/*
 * Measure what the engine is ACTUALLY doing to a looping clip.
 *
 * Audio cannot be screenshotted, so this wraps the Web Audio constructor in the Dev Mode window and
 * reads the nodes back afterwards. It is the only evidence that these three ever worked:
 *
 *   C5  in/out points reach Dev Mode at all      -> node.__probe.seekAtRead vs the marked in point
 *   C6  a looping clip does not die after one pass -> still playing at out + 1.5s
 *   C7  intro->loop                              -> loop/loopStart/loopEnd on the node
 *
 * ⚠ Read the node AFTERWARDS, never inside a start() hook. SoundToken calls start() in its
 * constructor and assigns `loop` *after* — a snapshot taken at start() always reads
 * `loop:false, loopStart:0`, which looks exactly like "the out point never worked". That
 * misdiagnosis already cost one round.
 *
 * ⚠ The first play() can no-op until the page has a real MOUSE user-activation. A CDP keyboard
 * event alone leaves the AudioContext suspended, the playhead sits frozen, and it reads as a broken
 * feature. Click the stage before believing anything below.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<pid> node tools/ui-verify/scenarios/audio-loop-probe.js
 */

const D = require('./_drive');
const A = require('../assert');

const INSTALL = `(() => {
    if (window.__audioProbe) return "already";
    window.__audioProbe = [];
    const ctxProto = (window.AudioContext || window.webkitAudioContext).prototype;
    const orig = ctxProto.createBufferSource;
    ctxProto.createBufferSource = function (...a) {
        const node = orig.apply(this, a);
        window.__audioProbe.push(node);
        return node;
    };
    return "installed";
})()`;

// Read the LIVE values off every node the run created. Everything here is read post-hoc.
const READ = `(() => {
    const nodes = window.__audioProbe || [];
    return JSON.stringify({
        count: nodes.length,
        nodes: nodes.map(n => ({
            loop: n.loop,
            loopStart: n.loopStart,
            loopEnd: n.loopEnd,
            duration: n.buffer ? n.buffer.duration : null,
            sampleRate: n.buffer ? n.buffer.sampleRate : null,
            ctxState: n.context ? n.context.state : null,
            ctxTime: n.context ? n.context.currentTime : null,
        })),
    });
})()`;

async function install(d) {
    const r = await d.evaluate(INSTALL);
    console.log('probe:', r);
}

async function read(d) {
    const raw = await d.evaluate(READ);
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
}

/** A real mouse press on the stage — keyboard activation does not resume an AudioContext. */
async function activate(d) {
    const box = await d.evaluate(`(() => {
        const el = document.querySelector('canvas, [data-nl-stage], #root');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`);
    if (!box) throw new Error('no stage element to click for user activation');
    const { x, y } = JSON.parse(typeof box === 'string' ? box : JSON.stringify(box));
    await d.click(x, y);
}

module.exports = { install, read, activate };

if (require.main === module) {
    (async () => {
        await D.onWindow('dev-mode', 'Dev Mode', async (d) => {
            // Fail loudly rather than silently measuring the wrong window: `--target` falls back to
            // targets[0] when it matches nothing, and a closed dev-mode window then yields the
            // workspace page with every probe "passing".
            const url = await d.evaluate('location.pathname');
            if (!String(url).includes('dev-mode')) {
                throw new Error(`not the dev-mode window: ${url}`);
            }
            await install(d);
            await activate(d);
            await A.sleep(2500);
            const first = await read(d);
            console.log('after 2.5s:', JSON.stringify(first, null, 2));
            await A.sleep(8000);
            const later = await read(d);
            console.log('after 10.5s:', JSON.stringify(later, null, 2));
        });
    })().catch((e) => {
        console.error('\nSCRIPT FAIL:', e.message);
        process.exit(1);
    });
}
