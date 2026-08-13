import path from "path";
import { compileGameRuntimeArtifact } from "@/app/application/managers/preview/compiler/gameRuntimeArtifactCompiler";
import { isBuiltinAppTagId } from "@shared/types/appTag";
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
            // Only an edition that removes content can be missing any: a build that carries the
            // library whole has nothing to have got wrong, and paying for the check there would tax
            // every release build for a question with one possible answer.
            const tagId = message.input.appTag?.id;
            const audit = tagId && !isBuiltinAppTagId(tagId)
                ? await auditShippedContent(result.appDir)
                : undefined;
            send({ type: "done", result, ...(audit ? { audit } : {}) });
        })
        .catch((error: unknown) => {
            const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
            send({ type: "error", message: detail });
        });
});
