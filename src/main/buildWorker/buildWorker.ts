// Side-effect import kept FIRST: it disables Electron's asar fs patch before
// electron-builder is loaded (see enableNoAsar.ts for why).
import "./enableNoAsar";
import type {
    GameBuildWorkerInboundMessage,
    GameBuildWorkerOutboundMessage,
} from "./protocol";
import { runGameBuild } from "./runGameBuild";

/**
 * Packaging worker entry, forked as an Electron utility process. It owns the
 * electron-builder run so the (long, chatty and crash-prone) packaging stays
 * out of the Studio main process; the manager kills this process to cancel a
 * build. All configuration arrives pre-resolved as plain JSON.
 */

type ParentPort = {
    on(event: "message", listener: (event: { data: unknown }) => void): void;
    postMessage(message: unknown): void;
};

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

function send(message: GameBuildWorkerOutboundMessage): void {
    parentPort.postMessage(message);
}

parentPort.on("message", event => {
    const message = event.data as GameBuildWorkerInboundMessage;
    if (message?.type !== "start") {
        return;
    }
    runGameBuild(message.config, (level, text) => send({ type: "log", level, message: text }))
        .then(artifacts => send({ type: "done", artifacts }))
        .catch((error: unknown) => {
            const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
            send({ type: "error", message: detail });
        });
});
