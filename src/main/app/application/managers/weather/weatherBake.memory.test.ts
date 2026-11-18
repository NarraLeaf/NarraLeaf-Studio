import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";

/** Run the real baker in a fresh process so a forced collection measures only this bake's frames. */
describe("weather bake frame lifetime", () => {
    it.each(["unblocked", "backpressure"])("releases consumed frames with %s writes", mode => {
        const retainedLimitMiB = 8;
        const probe = String.raw`
            const fs = require("fs");
            const os = require("os");
            const path = require("path");
            const Module = require("module");
            const { EventEmitter } = require("events");
            const { buildSync } = require("esbuild");

            const filename = path.resolve("src/main/app/application/managers/weather/weatherBake.ts");
            const bundle = buildSync({
                entryPoints: [filename],
                bundle: true,
                platform: "node",
                format: "cjs",
                write: false,
                alias: { "@shared": path.resolve("src/shared") },
            }).outputFiles[0].text;
            const loaded = new Module(filename, module);
            loaded.filename = filename;
            loaded.paths = module.paths;
            loaded._compile(bundle, filename);

            (async () => {
                const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-weather-memory-"));
                try {
                    const bytes = 1024 * 1024;
                    const frameCount = 80;
                    let produced = 0;
                    let written = 0;
                    let feedingDone;
                    const fed = new Promise(resolve => { feedingDone = resolve; });
                    const child = new EventEmitter();
                    child.stdout = child.stderr = null;
                    child.stdin = new EventEmitter();
                    child.stdin.write = () => {
                        written += 1;
                        if (process.argv[1] === "backpressure") {
                            setImmediate(() => child.stdin.emit("drain"));
                            return false;
                        }
                        return true;
                    };
                    child.stdin.end = () => feedingDone();
                    child.kill = () => true;
                    const frameSource = {
                        next: async () => produced++ < frameCount ? new Uint8Array(bytes) : null,
                        close: () => {},
                    };

                    global.gc();
                    const before = process.memoryUsage().arrayBuffers;
                    const handle = loaded.exports.startWeatherBake(
                        "ffmpeg", { width: 1, height: 1, fps: 30, frames: frameCount },
                        path.join(dir, "snow.webm"),
                        { quality: "final", frameSource, spawnProcess: () => child },
                    );
                    await fed;
                    await new Promise(resolve => setImmediate(resolve));
                    // ArrayBuffer sweeping can finish after a forced collection returns. Wait for
                    // it while the encoder is still open; genuinely retained frames remain counted.
                    const deadline = Date.now() + 2000;
                    let retainedMiB;
                    do {
                        global.gc();
                        retainedMiB = (process.memoryUsage().arrayBuffers - before) / bytes;
                        if (retainedMiB < Number(process.argv[2]) || Date.now() >= deadline) break;
                        await new Promise(resolve => setTimeout(resolve, 25));
                    } while (true);
                    child.emit("close", 1, null);
                    const result = await handle.result;
                    console.log(JSON.stringify({ written, retainedMiB, status: result.status }));
                } finally {
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            })().catch(error => { console.error(error); process.exitCode = 1; });
        `;
        const output = execFileSync(process.execPath, ["--expose-gc", "-e", probe, mode, String(retainedLimitMiB)], {
            cwd: process.cwd(),
            encoding: "utf8",
            timeout: 15_000,
        });
        const measured = JSON.parse(output) as { written: number; retainedMiB: number; status: string };

        expect(measured.written).toBe(80);
        expect(measured.status).toBe("error");
        expect(measured.retainedMiB).toBeLessThan(retainedLimitMiB);
    });
});
