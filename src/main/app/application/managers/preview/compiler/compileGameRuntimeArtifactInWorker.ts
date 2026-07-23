import path from "path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { App } from "@/app/app";
import type {
    CompileWorkerOutboundMessage,
} from "@/buildWorker/compileWorkerProtocol";
import type {
    GameRuntimeArtifactCompileInput,
    GameRuntimeArtifactCompileResult,
} from "./gameRuntimeArtifactCompiler";

type CompileWorkerHostApp = Pick<App, "getDistDir">;

export type CompileWorkerHooks = {
    /**
     * Invoked once the worker is forked, with its handle, so the caller can
     * store it and kill an in-flight compile on cancel/stop. The worker is torn
     * down automatically once the compile settles.
     */
    onStart?: (worker: UtilityProcess) => void;
    /**
     * Lets the caller mark an early worker exit as an intentional cancel rather
     * than a crash, so the surfaced error matches the caller's cancel wording
     * (mirrors the packaging worker in GameBuildManager).
     */
    cancelled?: () => boolean;
};

/**
 * Run compileGameRuntimeArtifact in a forked Electron utility process instead of
 * on the main process. The compile seals the pack through the native codec -
 * seconds of synchronous CPU for a protected project - which would otherwise
 * freeze the Studio window; the worker keeps the main thread responsive. The
 * opaque pack key travels inside `input` (the same value the in-process call
 * received) and never leaves the machine.
 */
export function compileGameRuntimeArtifactInWorker(
    app: CompileWorkerHostApp,
    input: GameRuntimeArtifactCompileInput,
    hooks?: CompileWorkerHooks,
): Promise<GameRuntimeArtifactCompileResult> {
    const workerPath = path.join(app.getDistDir(), "main", "compileWorker.js");
    return new Promise<GameRuntimeArtifactCompileResult>((resolve, reject) => {
        const worker = utilityProcess.fork(workerPath, [], {
            serviceName: "narraleaf-artifact-compile",
            stdio: "pipe",
            env: process.env,
        });
        hooks?.onStart?.(worker);
        let settled = false;
        const settle = (fn: () => void) => {
            if (settled) {
                return;
            }
            settled = true;
            fn();
        };
        // The compile emits no protocol logs, but plugin-data resolution can
        // console.warn; surface it rather than dropping the diagnostic trail.
        worker.stdout?.on("data", chunk => process.stdout.write(chunk));
        worker.stderr?.on("data", chunk => process.stderr.write(chunk));
        worker.on("message", (message: CompileWorkerOutboundMessage) => {
            if (message.type === "done") {
                worker.kill();
                settle(() => resolve(message.result));
                return;
            }
            worker.kill();
            settle(() => reject(new Error(message.message)));
        });
        worker.on("exit", code => {
            settle(() => reject(new Error(
                hooks?.cancelled?.()
                    ? "Build cancelled"
                    : `Artifact compile worker exited unexpectedly (code ${code})`,
            )));
        });
        worker.once("spawn", () => {
            worker.postMessage({ type: "compile", input });
        });
    });
}
