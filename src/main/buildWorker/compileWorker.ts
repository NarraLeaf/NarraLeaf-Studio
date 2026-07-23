import { compileGameRuntimeArtifact } from "@/app/application/managers/preview/compiler/gameRuntimeArtifactCompiler";
import type {
    CompileWorkerInboundMessage,
    CompileWorkerOutboundMessage,
} from "./compileWorkerProtocol";

/**
 * Artifact-compile worker entry, forked as an Electron utility process. Running
 * compileGameRuntimeArtifact here keeps the pack seal - which, with asset
 * protection on, pushes the native codec through many seconds of synchronous
 * CPU - off the Studio main process, so the window never freezes during a
 * preview launch or the pre-package compile of a build. All input arrives
 * pre-resolved as plain JSON (including the opaque pack key); the worker only
 * reads/writes files and returns the compile result.
 */

type ParentPort = {
    on(event: "message", listener: (event: { data: unknown }) => void): void;
    postMessage(message: unknown): void;
};

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

function send(message: CompileWorkerOutboundMessage): void {
    parentPort.postMessage(message);
}

parentPort.on("message", event => {
    const message = event.data as CompileWorkerInboundMessage;
    if (message?.type !== "compile") {
        return;
    }
    compileGameRuntimeArtifact(message.input)
        .then(result => send({ type: "done", result }))
        .catch((error: unknown) => {
            const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
            send({ type: "error", message: detail });
        });
});
