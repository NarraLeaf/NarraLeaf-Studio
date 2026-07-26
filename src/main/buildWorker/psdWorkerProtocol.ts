import type { PsdBakeJob, PsdBakedLayer, PsdDocument } from "@shared/types/psdImport";

/**
 * Message protocol between the PSD import manager (main process) and the PSD worker (utility
 * process). Parsing a PSD decompresses every layer, and baking re-encodes each one at document size
 * — both are seconds of synchronous CPU on a real character sheet, which would otherwise freeze the
 * Studio window. Everything crosses as structured-clone plain data.
 *
 * The two steps are separate messages on purpose: the author has to see the tree, and decide what to
 * do about any blend mode the engine cannot reproduce, before a single pixel is baked.
 */

export type PsdWorkerReadMessage = { type: "read"; filePath: string };
export type PsdWorkerBakeMessage = { type: "bake"; request: PsdBakeJob };

export type PsdWorkerReadDoneMessage = { type: "read-done"; document: PsdDocument };
export type PsdWorkerBakeDoneMessage = { type: "bake-done"; layers: PsdBakedLayer[] };
export type PsdWorkerErrorMessage = { type: "error"; message: string };

export type PsdWorkerInboundMessage = PsdWorkerReadMessage | PsdWorkerBakeMessage;

export type PsdWorkerOutboundMessage =
    | PsdWorkerReadDoneMessage
    | PsdWorkerBakeDoneMessage
    | PsdWorkerErrorMessage;
