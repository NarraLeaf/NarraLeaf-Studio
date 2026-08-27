import type { DownloadProgressEvent } from "@shared/types/downloadProgress";
import type {
    GameRuntimeArtifactCompileInput,
    GameRuntimeArtifactCompileResult,
} from "@/app/application/managers/preview/compiler/gameRuntimeArtifactCompiler";

/**
 * Message protocol between GameBuildManager / PreviewManager (main process) and
 * the artifact-compile worker (utility process). The compile is moved off the
 * main process because, with asset protection on, sealing the pack drives the
 * native codec through many seconds of synchronous CPU (~250 ms/MB) that would
 * otherwise freeze the Studio window. Everything crosses as structured-clone
 * plain data; the opaque pack key rides inside `input` exactly as the in-process
 * call received it and never leaves the machine.
 */

export type CompileWorkerStartMessage = {
    type: "compile";
    input: GameRuntimeArtifactCompileInput;
};

/**
 * What the shipped-content audit found in the package this compile produced.
 *
 * Declared here rather than imported from the audit's own module: that module is bundled with the
 * renderer's aliases and loaded by path, so nothing on this side of the boundary can import from it
 * without dragging the story compiler into the main bundle. The shapes are kept in step by the
 * audit's own tests, which assert against this contract.
 */
export type ShippedContentAuditReport = {
    checkedAssetCount: number;
    failures: {
        assetId: string;
        origin: string;
        reason: "missing" | "unreadable";
        detail?: string;
    }[];
    storyErrors: { story: string; message: string }[];
};

export type CompileWorkerDoneMessage = {
    type: "done";
    result: GameRuntimeArtifactCompileResult;
    /** Present only for an edition that removes content; every other build has nothing to audit. */
    audit?: ShippedContentAuditReport;
};

export type CompileWorkerErrorMessage = {
    type: "error";
    message: string;
};

/**
 * A redistributable this compile is fetching, so a build that has stopped for a download says so.
 *
 * A plugin may declare binaries whose licence lets a game ship them but not a public registry mirror
 * them, and the first build on a machine pulls each one. That happens here, in a process with no
 * window; the byte count crosses so the main process can put it on the status bar in the language
 * that window is showing.
 */
export type CompileWorkerDownloadMessage = {
    type: "download";
    event: DownloadProgressEvent;
};

export type CompileWorkerInboundMessage = CompileWorkerStartMessage;

export type CompileWorkerOutboundMessage =
    | CompileWorkerDoneMessage
    | CompileWorkerDownloadMessage
    | CompileWorkerErrorMessage;
