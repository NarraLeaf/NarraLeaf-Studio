import fs from "fs";
import path from "path";
import zlib from "zlib";
import { readPsd } from "ag-psd";
import { bakeLayers, describePsd } from "./psd/bakePsdLayers";
import { initializePsdImageData } from "./psd/initializePsdImageData";
import { PSD_UNREADABLE, type PsdFailureCode } from "@shared/types/psdImport";
import type { PsdWorkerInboundMessage, PsdWorkerOutboundMessage } from "./psdWorkerProtocol";

/**
 * PSD import worker, forked as an Electron utility process.
 *
 * Both steps belong off the main process: `readPsd` decompresses every layer of what is often a
 * hundred-megabyte character sheet, and baking re-encodes each kept layer at full document size.
 * Either would freeze the Studio window for seconds.
 *
 * `useImageData` is what lets this run with no canvas at all — ag-psd hands back plain RGBA rather
 * than needing a DOM or node-canvas, and the PNG is written by Studio's own encoder.
 */

type ParentPort = {
    on(event: "message", listener: (event: { data: unknown }) => void): void;
    postMessage(message: unknown): void;
};

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

function send(message: PsdWorkerOutboundMessage): void {
    parentPort.postMessage(message);
}

initializePsdImageData();

const deflate = (bytes: Uint8Array) => new Uint8Array(zlib.deflateSync(bytes));

/** A failure the wizard can name, thrown on with its `PsdFailureCode`. */
class PsdReadFailure extends Error {
    constructor(message: string, public readonly code: PsdFailureCode) {
        super(message);
    }
}

/**
 * Read and parse the PSD, telling apart the two failures an author can act on: a file that could not
 * be opened, and one that is not a PSD this parser reads. Every other failure is thrown as it was.
 */
function readPsdFile(filePath: string) {
    let bytes: Buffer;
    try {
        bytes = fs.readFileSync(filePath);
    } catch (error: unknown) {
        const errno = (error as NodeJS.ErrnoException)?.code;
        if (errno === "EACCES" || errno === "EPERM" || errno === "EBUSY") {
            throw new PsdReadFailure(error instanceof Error ? error.message : String(error), "PERMISSION_DENIED");
        }
        throw error;
    }
    try {
        // Skip the composite: it is the flattened preview, and every byte of it is wasted here.
        return readPsd(bytes, {
            skipCompositeImageData: true,
            skipThumbnail: true,
            useImageData: true,
        });
    } catch (error: unknown) {
        throw new PsdReadFailure(error instanceof Error ? error.message : String(error), PSD_UNREADABLE);
    }
}

function failure(error: unknown): PsdWorkerOutboundMessage {
    return {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof PsdReadFailure ? { code: error.code } : {}),
    };
}

parentPort.on("message", event => {
    const message = event.data as PsdWorkerInboundMessage;
    try {
        if (message?.type === "read") {
            const psd = readPsdFile(message.filePath);
            send({ type: "read-done", document: describePsd(psd, path.basename(message.filePath)) });
            return;
        }
        if (message?.type === "bake") {
            const psd = readPsdFile(message.request.filePath);
            fs.mkdirSync(message.request.outputDir, { recursive: true });
            const write = async (name: string, png: Uint8Array): Promise<string> => {
                const target = path.join(message.request.outputDir, name);
                fs.writeFileSync(target, png);
                return target;
            };
            void bakeLayers(psd, message.request.layers, deflate, write)
                .then(layers => send({ type: "bake-done", layers }))
                .catch((error: unknown) => send(failure(error)));
        }
    } catch (error: unknown) {
        send(failure(error));
    }
});
