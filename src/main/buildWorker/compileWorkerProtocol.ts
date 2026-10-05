import type { DownloadProgressEvent } from "@shared/types/downloadProgress";
import type { StudioTaskProgress } from "@shared/types/studioTask";
import type {
    GameRuntimeArtifactCompileInput,
    GameRuntimeArtifactCompileResult,
} from "@/app/application/managers/preview/compiler/gameRuntimeArtifactCompiler";
import type { PayloadSummary } from "@/app/application/managers/build/patchPayload";

/**
 * Message protocol between GameBuildManager / PreviewManager (main process) and
 * the artifact-compile worker (utility process). The compile is moved off the
 * main process because, with asset protection on, sealing the pack drives the
 * native codec through many seconds of synchronous CPU (~250 ms/MB) that would
 * otherwise freeze the Studio window. Everything crosses as structured-clone
 * plain data, exactly as the in-process call would receive it.
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

/**
 * How far through a countable step of the compile this worker is, or `null` for a stretch that has
 * no denominator.
 *
 * The compile is mostly one long stretch of reading the project and writing a pack, which nothing
 * here can put a number on. What it does contain are passes over a list that exists before the pass
 * starts, and those are what fill a bar: a step opens a counter with `countBuildStep` in
 * `stepProgress`, advances it once per item, and closes it, at which point this goes back to `null`
 * and the window goes back to a sweep.
 */
export type CompileWorkerProgressMessage = {
    type: "progress";
    progress: StudioTaskProgress | null;
};

/**
 * Read a build's payload: what it says about itself, and the digest of every entry when asked.
 *
 * Here rather than in the main process because a packaged build can only be read through
 * Electron's asar patch, and the patch keeps every archive it opens open until the process exits -
 * which on Windows would leave the author unable to build into that folder again for as long as
 * Studio ran. This process exits once it has answered, and everything it held goes with it,
 * including the native reader a sealed build carries. See `managers/build/patchPayload.ts`.
 */
export type CompileWorkerReadPayloadMessage = {
    type: "read-payload";
    /** The folder the author picked, or a compiled app directory. */
    target: string;
    digests: boolean;
};

/** The answer to a {@link CompileWorkerReadPayloadMessage}; see `PayloadSummary`. */
export type CompileWorkerPayloadMessage = {
    type: "payload";
    summary: PayloadSummary;
};

export type CompileWorkerInboundMessage = CompileWorkerStartMessage | CompileWorkerReadPayloadMessage;

/** What the worker answers a {@link CompileWorkerReadPayloadMessage} with. */
export type CompileWorkerReadPayloadReply = CompileWorkerPayloadMessage | CompileWorkerErrorMessage;

export type CompileWorkerOutboundMessage =
    | CompileWorkerDoneMessage
    | CompileWorkerDownloadMessage
    | CompileWorkerProgressMessage
    | CompileWorkerErrorMessage;
