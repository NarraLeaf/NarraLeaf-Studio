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

export type CompileWorkerDoneMessage = {
    type: "done";
    result: GameRuntimeArtifactCompileResult;
};

export type CompileWorkerErrorMessage = {
    type: "error";
    message: string;
};

export type CompileWorkerInboundMessage = CompileWorkerStartMessage;

export type CompileWorkerOutboundMessage =
    | CompileWorkerDoneMessage
    | CompileWorkerErrorMessage;
