import type { WeatherBakeQuality, WeatherBakeSpec } from "@shared/weather/model";
import type { WeatherBakeResult } from "@/app/application/managers/weather/weatherBake";

/**
 * Message protocol between the weather bake manager (main process) and the bake worker.
 *
 * ## Why a bake is not allowed to run on the main process
 *
 * A bake looks like an encoder's job, and the encoder is indeed a child process - but the frames it
 * eats are drawn in JavaScript, one 8 MB buffer at a time, by whoever started it. Measured on a
 * 24-thread machine while a 1080p clip was being made in the main process: the smallest possible IPC
 * round trip went from 53,308 of them in ten seconds to **250**, its median from 0.2 ms to 39.6 ms -
 * one frame's drawing, paid by everything else main had to do. A Dev Mode reload, which is a few
 * hundred short async steps, went from 30 ms to fifteen SECONDS, so an author who nudged a parameter
 * waited a quarter of a minute for the picture to catch up.
 *
 * The control that makes this the renderer's fault rather than the machine's: an unrelated ffmpeg
 * running the identical encode across all 24 threads cost those round trips 14%, not 200x. A busy
 * machine is fine. A busy event loop is not.
 *
 * So the whole bake - drawing the frames and feeding them in - happens here, and main keeps a
 * handle: progress on the way out, one cancel on the way in.
 */

export type WeatherWorkerBakeMessage = {
    type: "bake";
    /** Absolute path to the ffmpeg the host resolved. The worker resolves nothing itself. */
    binaryPath: string;
    spec: WeatherBakeSpec;
    /**
     * How hard the encoder works. Carried rather than decided here: the worker knows nothing about
     * who asked, and the tier is the difference between the file a build ships and the one a Dev
     * Mode session throws away.
     */
    quality: WeatherBakeQuality;
    /** Where the finished clip lands. The worker writes through a temporary name beside it. */
    targetPath: string;
};

/** Stop, wherever it has got to. The worker answers with `done` carrying a `cancelled` result. */
export type WeatherWorkerCancelMessage = { type: "cancel" };

export type WeatherWorkerInboundMessage = WeatherWorkerBakeMessage | WeatherWorkerCancelMessage;

/**
 * Frames the encoder has taken, not frames we have handed it.
 *
 * The pipe holds several, so counting our own side reports a bar that fills early and then waits.
 */
export type WeatherWorkerProgressMessage = { type: "progress"; frames: number; total: number };

/** The one answer, whatever happened: produced, cancelled, or failed. */
export type WeatherWorkerDoneMessage = { type: "done"; result: WeatherBakeResult };

export type WeatherWorkerOutboundMessage = WeatherWorkerProgressMessage | WeatherWorkerDoneMessage;
