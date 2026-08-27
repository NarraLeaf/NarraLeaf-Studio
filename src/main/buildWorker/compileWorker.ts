import path from "path";
import { compileGameRuntimeArtifact } from "@/app/application/managers/preview/compiler/gameRuntimeArtifactCompiler";
import type {
    CompileWorkerInboundMessage,
    CompileWorkerOutboundMessage,
    ShippedContentAuditReport,
} from "./compileWorkerProtocol";
import { setDownloadReporter } from "./downloadReporting";
import { setStepProgressReporter } from "./stepProgress";

/**
 * Artifact-compile worker entry, forked as an Electron utility process. Running
 * compileGameRuntimeArtifact here keeps the pack seal - which, with asset
 * protection on, pushes the native codec through many seconds of synchronous
 * CPU - off the Studio main process, so the window never freezes during a
 * preview launch or the pre-package compile of a build. All input arrives
 * pre-resolved as plain JSON (including the opaque pack key); the worker only
 * reads/writes files and returns the compile result.
 *
 * It also runs the shipped-content audit, for the reason the audit exists at all: an edition that
 * leaves content out has to be checked against the package it produced, and this process is the one
 * holding that package.
 */

type ParentPort = {
    on(event: "message", listener: (event: { data: unknown }) => void): void;
    postMessage(message: unknown): void;
};

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

function send(message: CompileWorkerOutboundMessage): void {
    parentPort.postMessage(message);
}

// The one thing this compile does that is neither reading nor writing a local file: fetching what a
// project needs and this machine has not got - the redistributables a plugin declares, and the
// toolchain a protected build compiles with. Registered at load rather than per compile because the
// downloaders sit several layers in, none of which has any business carrying a progress channel.
setDownloadReporter(event => send({ type: "download", event }));

// How far through a countable step of the compile this is. Registered at load for the same reason,
// and it is the seam a pass over a known list reports through: `countBuildStep` in `stepProgress`,
// advanced once per item, closed when the pass ends. A pass that cannot say how much work it has
// before it starts opens no counter, and the window keeps its sweep.
setStepProgressReporter(progress => send({ type: "progress", progress }));

/**
 * Load and run the audit bundle sitting beside this one.
 *
 * `require` through a computed path on purpose: the audit is bundled with the renderer's aliases
 * (see project/build/build-main.js) and a static import would make esbuild pull it into this bundle,
 * where those aliases mean something else. A missing bundle is a Studio defect and throws - a check
 * that quietly did not run would be worse than one that was never written.
 */
async function auditShippedContent(appDir: string): Promise<ShippedContentAuditReport> {
    const modulePath = path.join(__dirname, "contentAudit.js");
    const audit = require(modulePath) as {
        runShippedContentAudit(appDir: string): Promise<ShippedContentAuditReport>;
    };
    return await audit.runShippedContentAudit(appDir);
}

parentPort.on("message", event => {
    const message = event.data as CompileWorkerInboundMessage;
    if (message?.type !== "compile") {
        return;
    }
    compileGameRuntimeArtifact(message.input)
        .then(async result => {
            // Audited exactly when the compile narrowed the library, and asked of the compile
            // rather than re-derived from the request. Trimming without the audit is the dangerous
            // half - it removes assets with nothing checking that the shipped game still reaches
            // every one it asks for - and the two conditions were previously the same premise
            // written out twice, which is a shape that agrees until the day it does not.
            //
            // A compile that carries the library whole is every preview and every test; there is
            // nothing there for the audit to find and nothing was taken away.
            //
            // Except for a package produced only to be compared against and deleted. The audit
            // protects what a player receives, and that one nobody receives; a defect it would find
            // there belongs to a build of that variant, which is what reports it. It is the caller
            // that knows this, because it is the caller that throws the package away.
            const audit = result.assetReport && !message.input.forComparison
                ? await auditShippedContent(result.appDir)
                : undefined;
            send({ type: "done", result, ...(audit ? { audit } : {}) });
        })
        .catch((error: unknown) => {
            const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
            send({ type: "error", message: detail });
        });
});
