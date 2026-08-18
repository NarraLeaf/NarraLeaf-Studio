/*
 * Prove buses are a live gain graph, not arithmetic done once.
 *
 * Reads the engine's own AudioManager rather than wrapping AudioContext: the dev-mode window
 * reloads on launch, so a wrapped constructor is either wiped or installed too late, and a CDP
 * connection held across that reload silently stops answering `Runtime.evaluate` (hangs, no error).
 * A looping token stays alive while it loops, so reading the manager has no race.
 *
 *   D1 a bus change reaches an ALREADY-PLAYING clip and does not stop it
 *   D2 a child bus multiplies with its parent
 *   D3 the change is ramped, not a bare assignment (the slider zipper fix)
 */

const { connect } = require("../drive");

const PORT = Number(process.env.NLS_VERIFY_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Walk the fiber tree to the AudioManager and stash it, then report the bus graph + tokens. */
const FIND = `(function () {
    if (!window.__am) {
        var root = document.querySelector('#root') || document.body.firstElementChild;
        var key = Object.keys(root).find(function (k) { return k.indexOf('__reactContainer$') === 0; });
        if (!key) return JSON.stringify({error: 'no react container'});
        var seen = new Set(), queue = [root[key]], found = null, scanned = 0;
        while (queue.length && !found && scanned < 200000) {
            var f = queue.shift();
            if (!f || seen.has(f)) continue;
            seen.add(f); scanned++;
            var slots = [f.memoizedProps, f.memoizedState, f.stateNode, f.pendingProps];
            for (var i = 0; i < slots.length && !found; i++) {
                var s = slots[i];
                if (!s || typeof s !== 'object') continue;
                if (s.audioManager) { found = s.audioManager; break; }
                for (var k in s) {
                    var v = null; try { v = s[k]; } catch (e) { continue; }
                    if (v && typeof v === 'object' && v.audioManager) { found = v.audioManager; break; }
                }
            }
            if (f.child) queue.push(f.child);
            if (f.sibling) queue.push(f.sibling);
            if (f.alternate) queue.push(f.alternate);
        }
        if (!found) return JSON.stringify({error: 'audioManager not found', scanned: scanned});
        window.__am = found;
    }
    var am = window.__am;

    // The channel map is private to the manager; read it through whatever it exposes, then fall
    // back to the private field. This is a probe, not product code.
    var channels = am.channels || (am['channels']);
    var buses = [];
    if (channels && typeof channels.forEach === 'function') {
        channels.forEach(function (ch, id) {
            var gain = null, parent = null;
            try { gain = ch.getGainNode ? ch.getGainNode().gain.value : null; } catch (e) {}
            try { parent = ch.getParent && ch.getParent() ? ch.getParent().getName() : null; } catch (e) {}
            buses.push({id: String(id), gain: gain, parent: parent});
        });
    }

    var sounds = [];
    if (am.state && typeof am.state.forEach === 'function') {
        am.state.forEach(function (entry, sound) {
            var token = entry && entry.token, node = null;
            try { node = token && token.sourceController && token.sourceController.getSource(); } catch (e) {}
            sounds.push({
                busId: sound && sound.config ? String(sound.config.type) : null,
                playing: token && typeof token.isPlaying === 'function' ? token.isPlaying() : null,
                nodeLoop: node ? node.loop : null,
                ctxState: node && node.context ? node.context.state : null,
            });
        });
    }
    return JSON.stringify({buses: buses, sounds: sounds});
})()`;

const setBus = (id, v) => `(function () {
    var am = window.__am;
    if (!am || typeof am.setBusVolume !== 'function') return 'no setBusVolume';
    am.setBusVolume(${JSON.stringify(id)}, ${v});
    return 'set ${id}=${v}';
})()`;

(async () => {
  const d = await connect({ target: "dev-mode", port: PORT });
  try {
    const path = await d.evaluate("location.pathname");
    if (!String(path).includes("dev-mode")) throw new Error(`wrong window: ${path}`);
    if (await d.evaluate("document.hidden")) throw new Error("dev-mode window is hidden");
    await d.click(700, 450); // real mouse press: unlocks the AudioContext
    await sleep(1500);

    const read = async (label) => {
      const r = JSON.parse(await d.evaluate(FIND));
      console.log(`\n--- ${label} ---`);
      console.log(JSON.stringify(r, null, 1));
      return r;
    };

    await read("baseline");

    const bus = process.env.NLS_VERIFY_BUS;
    if (!bus) throw new Error("set NLS_VERIFY_BUS to the child bus id");

    console.log("\n" + (await d.evaluate(setBus(bus, 0.25))));
    await sleep(60);
    const mid = JSON.parse(await d.evaluate(FIND));
    const midGain = (mid.buses.find((b) => b.id === bus) || {}).gain;
    console.log(
      `D3 ramp: gain 60ms after set = ${midGain} (a bare assignment would already be exactly 0.25)`
    );
    await sleep(600);
    await read("D1 after child bus -> 0.25");

    console.log("\n" + (await d.evaluate(setBus("voice", 0.5))));
    console.log(await d.evaluate(setBus(bus, 0.5)));
    await sleep(700);
    await read("D2 child 0.5 under parent 0.5");
  } finally {
    d.close();
  }
})().catch((e) => {
  console.error("\nSCRIPT FAIL:", e.message);
  process.exit(1);
});
