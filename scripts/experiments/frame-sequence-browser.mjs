// Exploration harness: real engine transition resolvers and Image serialization,
// but an explicit experimental clock and DOM driver, not the production Player.
import { Image as EngineImage, Dissolve, Reveal, Mask } from "narraleaf-react";
import { FrameSequence } from "./frame-sequence.mjs";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

async function makeFrames() {
    return Promise.all(["#e65555", "#5ac878", "#5795ea"].map(async (color, index) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 128;
        const context = canvas.getContext("2d");
        context.fillStyle = color;
        context.fillRect(16 + index * 8, 16, 64, 96);
        return canvas.toDataURL("image/png");
    }));
}

const frames = await makeFrames();
await Promise.all(frames.map(async src => { const image = new window.Image(); image.src = src; await image.decode(); }));
const poseKey = "sequence://idle";
let sequence = new FrameSequence({ frames, fps: 12 });
let engineImage = new EngineImage({ src: frames[0] });
let sample = sequence.sample();
let paused = false;
let playing = false;
let request = null;
let lastTime = null;
let transition = null;
let progress = 0.5;
let views = [];

const stage = document.querySelector("#stage");
function mount() {
    stage.replaceChildren();
    views = [0, 1].map(() => {
        const image = document.createElement("img");
        image.width = image.height = 128;
        image.style.cssText = "position:absolute;inset:0;width:128px;height:128px";
        stage.append(image);
        return image;
    });
    paint();
}
function paint() {
    const resolvers = transition?.createTask().resolve;
    views.forEach((image, i) => {
        const props = resolvers ? resolvers[i].resolver(progress) : { src: poseKey };
        // Proposed engine seam: resolve a stable sequence resource AFTER the transition's
        // own src resolver, BEFORE applying its props, using ONE sample for the entire tick.
        image.src = props.src === poseKey ? sample.src : props.src;
        Object.assign(image.style, props.style ?? {});
    });
    document.querySelector("#time").textContent = `frame ${sample.index} / ${sample.elapsedMs.toFixed(1)} ms`;
}
function setTransition(kind) {
    views.forEach(image => image.removeAttribute("style"));
    views.forEach(image => image.style.cssText = "position:absolute;inset:0;width:128px;height:128px");
    transition = kind === "mask" ? new Reveal({ duration: 800, pattern: Mask.wipe({ direction: "left" }) }) : new Dissolve({ duration: 800 });
    transition._setPrevSrc(poseKey)._setTargetSrc(poseKey)._setCurrentSrc(poseKey);
    paint();
}
function tick(time) {
    if (lastTime !== null && !paused) sample = sequence.advance(time - lastTime);
    lastTime = time;
    paint();
}
function loop(time) {
    if (!playing) return;
    tick(time);
    request = requestAnimationFrame(loop);
}
function start() { playing = true; lastTime = null; request = requestAnimationFrame(loop); }
function stop() { playing = false; cancelAnimationFrame(request); request = null; lastTime = null; }
function save() {
    // Test the engine's actual Image.toData/fromData path with a proposed state field.
    // This is not yet a declared or supported production field.
    engineImage.state.sequencePlayback = sequence.save();
    return JSON.parse(JSON.stringify(engineImage.toData()));
}
function load(data) {
    const restored = new EngineImage({ src: frames[0] });
    restored.fromData(data);
    engineImage = restored;
    sequence = new FrameSequence({ frames, fps: 12 }, restored.state.sequencePlayback.elapsedMs);
    sample = sequence.sample();
    lastTime = null;
    paint();
}
mount();
await check("transparent PNGs decoded", async () => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d"); const img = new window.Image(); img.src = frames[0]; await img.decode();
    ctx.drawImage(img, 0, 0);
    assert(ctx.getImageData(0, 0, 1, 1).data[3] === 0, "transparent corner was lost");
    assert(ctx.getImageData(20, 20, 1, 1).data[3] === 255, "opaque body was lost");
});
for (const kind of ["dissolve", "mask"]) {
    await check(`engine ${kind} resolvers preserve shared frame at every tested boundary`, async () => {
        setTransition(kind);
        for (const time of [0, 17, 83, 147, 301, 599, 1001]) {
            tick(time);
            assert(views[0].src === views[1].src, "transition sides diverged");
            assert(views[0].src === sample.src, "transition reverted to static source");
            await Promise.all(views.map(view => view.decode()));
            const pixels = views.map(view => {
                const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
                const ctx = canvas.getContext("2d"); ctx.drawImage(view, 0, 0);
                return ctx.getImageData(0, 0, 128, 128).data;
            });
            assert(pixels[0].every((value, i) => value === pixels[1][i]), "decoded transition images differ");
        }
        assert(kind !== "mask" || views[1].style.clipPath || views[1].style.maskImage || views[1].style.webkitMaskImage, "mask style missing");
        assert(kind !== "dissolve" || views[0].style.opacity === "0.5", "dissolve style missing");
        lastTime = null;
    });
}
await check("pause does not charge the stopped interval", () => {
    tick(0); tick(100); paused = true; const before = sample.elapsedMs;
    tick(5000); tick(10000); assert(sample.elapsedMs === before, "pause advanced");
    paused = false; tick(10020); assert(sample.elapsedMs === before + 20, "resume charged pause gap");
});
await check("engine Image serialization restores sequence time", () => {
    const data = save(); const before = sample;
    sequence.advance(987); load(data);
    assert(sample.elapsedMs === before.elapsedMs && sample.index === before.index, "save/load lost progress");
});
await check("DOM remount preserves progress", () => {
    const before = sample; mount();
    assert(sample === before && views.every(view => view.src === before.src), "mount restarted playback");
});
await check("static Image round trip remains unchanged", () => {
    const image = new EngineImage({ src: frames[0] }); const data = image.toData();
    const restored = new EngineImage({ src: frames[1] }); restored.fromData(JSON.parse(JSON.stringify(data)));
    assert(restored.state.currentSrc === frames[0], "static image changed");
    assert(!("sequencePlayback" in restored.state), "static state gained animation");
});
window.sequenceExperiment = { results, tick, save, load, mount, stop, start, setTransition, get sample() { return sample; } };
document.querySelector("#results").textContent = results.map(name => `PASS ${name}`).join("\n");
document.querySelector("#pause").onclick = () => { paused = !paused; lastTime = null; document.querySelector("#pause").textContent = paused ? "Resume" : "Pause"; };
document.querySelector("#dissolve").onclick = () => setTransition("dissolve");
document.querySelector("#mask").onclick = () => setTransition("mask");
document.querySelector("#remount").onclick = mount;
let saved = save();
document.querySelector("#save").onclick = () => { saved = save(); };
document.querySelector("#load").onclick = () => load(saved);
setTransition("dissolve");
start();
window.addEventListener("pagehide", stop, { once: true });
