import path from "path";
import { utilityProcess } from "electron";
import type { App } from "@/app/app";
import type { CompileWorkerReadPayloadReply } from "@/buildWorker/compileWorkerProtocol";
import type { PayloadSummary } from "./patchPayload";

type BuildReaderHostApp = Pick<App, "getDistDir">;

/**
 * Read a build in the artifact compile worker, and answer once that process has exited.
 *
 * The build is usually the folder an author is about to build into again, and reading one - a
 * packaged build through Electron's asar patch, a sealed one by loading the reader it carries -
 * holds files in it until the reading process exits; on Windows a held file cannot be deleted, so
 * the next build into that folder would fail for as long as Studio ran. So the reading happens in a
 * process that is ended as soon as it has answered, and the answer is handed back only after the
 * process is gone: by then nothing of the build is held by anyone.
 *
 * The compile worker rather than a process of its own because it is already the one that opens a
 * sealed payload (it writes them, and audits them), and every way of running Studio already builds it.
 */
export function readBuildPayloadInWorker(
    app: BuildReaderHostApp,
    target: string,
    options: { digests: boolean },
): Promise<PayloadSummary> {
    const workerPath = path.join(app.getDistDir(), "main", "compileWorker.js");
    return new Promise<PayloadSummary>((resolve, reject) => {
        const worker = utilityProcess.fork(workerPath, [], {
            serviceName: "narraleaf-build-reader",
            stdio: "pipe",
            env: process.env,
        });
        let answer: { summary: PayloadSummary } | { error: Error } | null = null;
        worker.stdout?.on("data", chunk => process.stdout.write(chunk));
        worker.stderr?.on("data", chunk => process.stderr.write(chunk));
        worker.on("message", (reply: CompileWorkerReadPayloadReply) => {
            if (answer || (reply?.type !== "payload" && reply?.type !== "error")) {
                return;
            }
            answer = reply.type === "payload" ? { summary: reply.summary } : { error: new Error(reply.message) };
            worker.kill();
        });
        worker.on("exit", code => {
            if (!answer) {
                reject(new Error(`The worker reading ${target} exited before answering (code ${code})`));
            } else if ("error" in answer) {
                reject(answer.error);
            } else {
                resolve(answer.summary);
            }
        });
        worker.once("spawn", () => {
            worker.postMessage({ type: "read-payload", target, digests: options.digests });
        });
    });
}
