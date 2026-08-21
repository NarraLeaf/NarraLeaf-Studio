import { isMainThread, parentPort as threadPort, workerData } from "worker_threads";
import { buildWeatherField, createWeatherRenderer } from "@shared/weather/field";
import { resolveWeatherParams, type WeatherBakeSpec } from "@shared/weather/model";
import {
    serialWeatherFrames,
    startWeatherBake,
    type WeatherBakeHandle,
    type WeatherFrameSequence,
} from "@/app/application/managers/weather/weatherBake";
import { createWeatherRenderPool, WEATHER_RENDER_THREAD_DATA } from "./weatherRenderPool";
import type { WeatherWorkerInboundMessage, WeatherWorkerOutboundMessage } from "./weatherWorkerProtocol";

/**
 * Weather bake worker, forked as an Electron utility process - and, inside it, its own render
 * threads.
 *
 * This one file is two programs, chosen by `workerData`. As a utility process it hosts
 * {@link startWeatherBake} unchanged: the drawing, the encoder, the temporary file and the rename
 * all still happen exactly where they did, one process to the left of the main one. See
 * `weatherWorkerProtocol.ts` for what that move is worth - the difference between the app answering
 * in 0.2 ms and in 40 ms for the whole minute a clip takes.
 *
 * As a worker thread it is a renderer and nothing else: it builds the same field from the same seed
 * and answers with the pixels of whichever phase it is handed. One file rather than two because a
 * second entry point is a second pair of build registrations, and forgetting one of those is the
 * mistake this pipeline has now made three times.
 *
 * One bake per worker, and it exits when that bake is answered. There is no queue here - the studio
 * task scheduler is the queue, and it runs one heavy job at a time.
 */

const renderSpec = (workerData as Record<string, unknown> | null)?.[WEATHER_RENDER_THREAD_DATA] as
    | WeatherBakeSpec
    | undefined;

if (!isMainThread && renderSpec) {
    runRenderThread(renderSpec);
} else {
    runBakeHost();
}

/** Draw the phases this thread is asked for, for as long as it is asked. */
function runRenderThread(spec: WeatherBakeSpec): void {
    const field = buildWeatherField(spec.ref.seed, resolveWeatherParams(spec.ref), spec.width, spec.height);
    const renderer = createWeatherRenderer(field, spec.width, spec.height, { frames: spec.frames });
    threadPort?.on("message", (message: { index: number }) => {
        renderer.render(message.index / spec.frames);
        // Copied out of the renderer's own buffer so it can be transferred rather than cloned: the
        // renderer overwrites that buffer the moment the next phase is asked for.
        const frame = new Uint8Array(renderer.frame);
        threadPort?.postMessage({ index: message.index, frame }, [frame.buffer]);
    });
}

function runBakeHost(): void {
    type ParentPort = {
        on(event: "message", listener: (event: { data: unknown }) => void): void;
        postMessage(message: unknown): void;
    };
    const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;
    const send = (message: WeatherWorkerOutboundMessage): void => parentPort.postMessage(message);

    let handle: WeatherBakeHandle | null = null;
    /** A cancel that overtook its own bake. Messages are ordered, so this is belt and braces. */
    let cancelled = false;

    parentPort.on("message", event => {
        const message = event.data as WeatherWorkerInboundMessage;
        if (message?.type === "cancel") {
            cancelled = true;
            handle?.cancel();
            return;
        }
        if (message?.type !== "bake" || handle) {
            return;
        }
        handle = startWeatherBake(message.binaryPath, message.spec, message.targetPath, {
            frameSource: frameSourceFor(message.spec),
            onProgress: progress => send({ type: "progress", frames: progress.frames, total: progress.total }),
        });
        if (cancelled) {
            handle.cancel();
        }
        void handle.result
            .then(result => send({ type: "done", result }))
            // `startWeatherBake` is documented never to throw, and every way it can fail is already a
            // status. This is here so that a broken promise still reaches the host as an answer
            // rather than as a worker that goes quiet and is eventually killed for it.
            .catch((error: unknown) => send({
                type: "done",
                result: {
                    status: "error",
                    detail: error instanceof Error ? error.message : String(error),
                    stderr: "",
                },
            }));
    });
}

/**
 * Threads if this host can fork them, and the plain loop if it cannot.
 *
 * The fallback is not politeness: a host that refuses to start a worker thread would otherwise fail
 * every bake, and a clip drawn slowly is worth immeasurably more than no clip at all. It says so on
 * stderr, which the manager already forwards to the log.
 */
function frameSourceFor(spec: WeatherBakeSpec): WeatherFrameSequence {
    try {
        return createWeatherRenderPool(spec);
    } catch (error) {
        process.stderr.write(
            `[WeatherBake] drawing this clip on one thread: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return serialWeatherFrames(spec);
    }
}
