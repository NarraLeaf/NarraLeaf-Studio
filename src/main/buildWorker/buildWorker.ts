// Side-effect import kept FIRST: it disables Electron's asar fs patch before
// electron-builder is loaded (see enableNoAsar.ts for why).
import "./enableNoAsar";
import type {
    GameBuildWorkerInboundMessage,
    GameBuildWorkerOutboundMessage,
} from "./protocol";
import { setDownloadReporter } from "./downloadReporting";
import { setStepProgressReporter } from "./stepProgress";
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

// Anything this worker fetches itself - the code-signing bundle, on a host that has to be handed
// one - reaches the status bar through here. What electron-builder downloads on its own account
// does not: nothing inside this process can see those, and they are read off its output instead.
setDownloadReporter(event => send({ type: "download", event }));

// How far through a countable step of the packaging this is. Registered here for the same reason
// the download sink is: the steps that can count themselves sit inside the repack and the digest
// pass, and the functions between them and this line are about packing files.
setStepProgressReporter(progress => send({ type: "progress", progress }));

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
