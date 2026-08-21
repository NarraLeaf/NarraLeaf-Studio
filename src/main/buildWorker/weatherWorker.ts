import { startWeatherBake, type WeatherBakeHandle } from "@/app/application/managers/weather/weatherBake";
import type { WeatherWorkerInboundMessage, WeatherWorkerOutboundMessage } from "./weatherWorkerProtocol";

/**
 * Weather bake worker, forked as an Electron utility process.
 *
 * It hosts {@link startWeatherBake} unchanged - the drawing, the encoder, the temporary file and the
 * rename all still happen exactly where they did, one process to the left. See
 * `weatherWorkerProtocol.ts` for what that move is worth: it is the difference between the app
 * answering in 0.2 ms and in 40 ms for the whole minute a clip takes.
 *
 * One bake per worker, and it exits when that bake is answered. There is no queue here - the studio
 * task scheduler is the queue, and it runs one heavy job at a time.
 */

type ParentPort = {
    on(event: "message", listener: (event: { data: unknown }) => void): void;
    postMessage(message: unknown): void;
};

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

function send(message: WeatherWorkerOutboundMessage): void {
    parentPort.postMessage(message);
}

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
        onProgress: progress => send({ type: "progress", frames: progress.frames, total: progress.total }),
    });
    if (cancelled) {
        handle.cancel();
    }
    void handle.result
        .then(result => send({ type: "done", result }))
        // `startWeatherBake` is documented never to throw, and every way it can fail is already a
        // status. This is here so that a broken promise still reaches the host as an answer rather
        // than as a worker that goes quiet and is eventually killed for it.
        .catch((error: unknown) => send({
            type: "done",
            result: {
                status: "error",
                detail: error instanceof Error ? error.message : String(error),
                stderr: "",
            },
        }));
});
