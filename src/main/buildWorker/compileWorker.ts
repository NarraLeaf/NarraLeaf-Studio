import path from "path";
import { compileGameRuntimeArtifact } from "@/app/application/managers/preview/compiler/gameRuntimeArtifactCompiler";
import type {
    CompileWorkerInboundMessage,
    CompileWorkerOutboundMessage,
    ShippedContentAuditReport,
} from "./compileWorkerProtocol";

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
            const audit = result.assetReport ? await auditShippedContent(result.appDir) : undefined;
            send({ type: "done", result, ...(audit ? { audit } : {}) });
        })
        .catch((error: unknown) => {
            const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
            send({ type: "error", message: detail });
        });
});
