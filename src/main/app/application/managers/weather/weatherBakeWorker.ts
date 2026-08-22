import path from "path";
import { utilityProcess } from "electron";
import type { App } from "@/app/app";
import type {
    WeatherWorkerInboundMessage,
    WeatherWorkerOutboundMessage,
} from "@/buildWorker/weatherWorkerProtocol";
import type { WeatherBakeQuality, WeatherBakeSpec } from "@shared/weather/model";
import type { WeatherBakeHandle, WeatherBakeProgress, WeatherBakeResult } from "./weatherBake";

export type WeatherBakeWorkerHostApp = Pick<App, "getDistDir">;

/**
 * How long a cancelled worker has to say so before it is simply killed.
 *
 * The encoder gets a SIGTERM and a SIGKILL behind it, so the honest answer arrives in milliseconds.
 * This bounds the case where it arrives never - a wedged worker must not hold the queue, and the
 * clip it was making is a temporary file that nothing will ever look at again.
 */
const CANCEL_GRACE_MS = 5000;

/**
 * Run one bake in a forked utility process, presented as the same handle the in-process bake returns.
 *
 * Identical shape on purpose: the manager submits work, reports frames and cancels, and none of that
 * has any business knowing which process the drawing happens in. What it buys is in
 * `weatherWorkerProtocol.ts` - a main process that stays answerable while a clip is being made.
 *
 * Never throws, for the same reason {@link import("./weatherBake").startWeatherBake} does not: every
 * way this can fail is a status the caller renders. A worker that dies without answering is an
 * `error`, not an exception - and not a promise that never settles, which is the failure that would
 * wedge the scheduler for the rest of the session.
 */
export function startWeatherBakeInWorker(
    app: WeatherBakeWorkerHostApp,
    binaryPath: string,
    spec: WeatherBakeSpec,
    targetPath: string,
    options: {
        quality: WeatherBakeQuality;
        threads: number | null;
        onProgress?: (progress: WeatherBakeProgress) => void;
    },
): WeatherBakeHandle {
    let settle: (result: WeatherBakeResult) => void = () => undefined;
    const result = new Promise<WeatherBakeResult>(resolve => {
        settle = resolve;
    });

    const worker = utilityProcess.fork(path.join(app.getDistDir(), "main", "weatherWorker.js"), [], {
        serviceName: "narraleaf-weather-bake",
        stdio: "pipe",
        env: process.env,
    });

    let answered = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: WeatherBakeResult): void => {
        if (answered) {
            return;
        }
        answered = true;
        if (killTimer) {
            clearTimeout(killTimer);
        }
        worker.kill();
        settle(value);
    };

    // The encoder's own words go where every other worker's do: a bake that failed says why in the
    // log, and the sentence the author sees comes from the result.
    worker.stderr?.on("data", chunk => process.stderr.write(chunk));
    worker.on("message", (message: WeatherWorkerOutboundMessage) => {
        if (message.type === "progress") {
            options.onProgress?.({ frames: message.frames, total: message.total });
            return;
        }
        finish(message.result);
    });
    worker.on("exit", () => finish({
        status: "error",
        detail: "the weather worker stopped before it produced a clip",
        stderr: "",
    }));

    const post = (message: WeatherWorkerInboundMessage): void => worker.postMessage(message);
    post({ type: "bake", binaryPath, spec, quality: options.quality, threads: options.threads, targetPath });

    return {
        result,
        cancel: () => {
            if (answered) {
                return;
            }
            post({ type: "cancel" });
            killTimer ??= setTimeout(() => finish({ status: "cancelled" }), CANCEL_GRACE_MS);
            killTimer.unref?.();
        },
    };
}
