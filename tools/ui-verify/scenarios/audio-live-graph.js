/*
 * Read the LIVE Web Audio graph of the running game.
 *
 * Wrapping AudioContext.prototype.createBufferSource only sees clips created after the wrap, and
 * the dev-mode window reloads on every launch, so the wrap is either too late or wiped. Reading the
 * engine's own AudioManager avoids the race entirely: the token for a looping clip is still alive
 * while it loops, and its AudioBufferSourceNode carries the ground truth.
 *
 *   C5  the marked in point reached the game   -> region start is the marked inMs, not 0
 *   C6  a looping clip survives its out point  -> the token is still playing well past outMs
 *   C7  intro->loop                            -> loop=true, loopStart=1.997, loopEnd=5.987
 *
 * Fixture segments.wav: 0-2s 220Hz / 2-6s 440Hz / 6-10s 880Hz, marked in=1.003 loop=1.997 out=5.987.
 */

const { connect } = require("../drive");

const PORT = Number(process.env.NLS_VERIFY_PORT || 9333);

const FIND = `(function () {
    var root = document.querySelector('#root') || document.body.firstElementChild;
    var key = Object.keys(root).find(function (k) { return k.indexOf('__reactContainer$') === 0; });
    if (!key) return JSON.stringify({ error: 'no react container' });

    var seen = new Set();
    var queue = [root[key]];
    var found = null;
    var scanned = 0;

    function probe(o) {
        if (!o || typeof o !== 'object' || seen.has(o)) return null;
        seen.add(o);
        if (o.audioManager && typeof o.audioManager === 'object') return o.audioManager;
        return null;
    }

    while (queue.length && !found && scanned < 200000) {
        var f = queue.shift();
        if (!f || seen.has(f)) continue;
        seen.add(f);
        scanned++;
        var slots = [f.memoizedProps, f.memoizedState, f.stateNode, f.pendingProps];
        for (var i = 0; i < slots.length; i++) {
            var s = slots[i];
            if (!s || typeof s !== 'object') continue;
            found = probe(s);
            if (found) break;
            // one level down: the manager usually hangs off a context value or a game object
            for (var k in s) {
                var v = null;
                try { v = s[k]; } catch (e) { continue; }
                if (!v || typeof v !== 'object') continue;
                found = probe(v);
                if (found) break;
            }
            if (found) break;
        }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
        if (f.alternate) queue.push(f.alternate);
    }

    if (!found) return JSON.stringify({ error: 'audioManager not found', scanned: scanned });
    window.__am = found;

    var out = [];
    var state = found.state;
    if (state && typeof state.forEach === 'function') {
        state.forEach(function (entry, sound) {
            var token = entry && entry.token;
            var node = null;
            try { node = token && token.sourceController && token.sourceController.getSource(); } catch (e) {}
            var cfg = sound && sound.config ? sound.config : {};
            out.push({
                src: String(cfg.src || '').slice(-28),
                type: cfg.type,
                cfgLoop: cfg.loop,
                cfgSeek: cfg.seek,
                cfgEndTime: cfg.endTime,
                cfgLoopStart: cfg.loopStart,
                nodeLoop: node ? node.loop : null,
                nodeLoopStart: node ? node.loopStart : null,
                nodeLoopEnd: node ? node.loopEnd : null,
                bufferDur: node && node.buffer ? node.buffer.duration : null,
                tokenPlaying: token && typeof token.isPlaying === 'function' ? token.isPlaying() : null,
                ctxState: node && node.context ? node.context.state : null,
                ctxNow: node && node.context ? node.context.currentTime : null,
            });
        });
    }
    return JSON.stringify({ scanned: scanned, sounds: out });
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

(async () => {
  const d = await connect({ target: "dev-mode", port: PORT });
  try {
    const path = await d.evaluate("location.pathname");
    if (!String(path).includes("dev-mode")) throw new Error(`wrong window: ${path}`);
    if (await d.evaluate("document.hidden")) throw new Error("dev-mode window is hidden");

    // A real mouse press: a CDP keyboard event alone leaves the AudioContext suspended and the
    // whole reading looks like "nothing is playing".
    await d.click(700, 450);
    await sleep(1200);

    console.log(stamp(), "--- read 1 ---");
    console.log(JSON.stringify(JSON.parse(await d.evaluate(FIND)), null, 1));

    await sleep(10000);
    console.log(stamp(), "--- read 2, ~10s later (out point is 5.987s) ---");
    console.log(JSON.stringify(JSON.parse(await d.evaluate(FIND)), null, 1));
  } finally {
    d.close();
  }
})().catch((e) => {
  console.error("\nSCRIPT FAIL:", e.message);
  process.exit(1);
});
