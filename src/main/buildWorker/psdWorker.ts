import fs from "fs";
import path from "path";
import zlib from "zlib";
import { readPsd } from "ag-psd";
import { bakeLayers, describePsd } from "./psd/bakePsdLayers";
import { initializePsdImageData } from "./psd/initializePsdImageData";
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

parentPort.on("message", event => {
    const message = event.data as PsdWorkerInboundMessage;
    try {
        if (message?.type === "read") {
            // Skip the composite: it is the flattened preview, and every byte of it is wasted here.
            const psd = readPsd(fs.readFileSync(message.filePath), {
                skipCompositeImageData: true,
                skipThumbnail: true,
                useImageData: true,
            });
            send({ type: "read-done", document: describePsd(psd, path.basename(message.filePath)) });
            return;
        }
        if (message?.type === "bake") {
            const psd = readPsd(fs.readFileSync(message.request.filePath), {
                skipCompositeImageData: true,
                skipThumbnail: true,
                useImageData: true,
            });
            fs.mkdirSync(message.request.outputDir, { recursive: true });
            const write = async (name: string, png: Uint8Array): Promise<string> => {
                const target = path.join(message.request.outputDir, name);
                fs.writeFileSync(target, png);
                return target;
            };
            void bakeLayers(psd, message.request.layers, deflate, write)
                .then(layers => send({ type: "bake-done", layers }))
                .catch((error: unknown) => send({
                    type: "error",
                    message: error instanceof Error ? error.message : String(error),
                }));
        }
    } catch (error: unknown) {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
});
