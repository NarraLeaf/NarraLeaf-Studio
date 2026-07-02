import { extname } from "@shared/utils/path";

export interface ProjectIconPreview {
    url: string;
    mediaType: string;
    width: number | null;
    height: number | null;
    extractedFromIcns: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export async function createProjectIconPreview(
    bytes: Uint8Array,
    mediaType: string,
    filePath: string,
): Promise<ProjectIconPreview> {
    const extension = extname(filePath).replace(/^\./, "").toLowerCase();
    const icns = extension === "icns" || mediaType === "image/icns";
    const previewBytes = icns ? extractLargestPngFromIcns(bytes) ?? bytes : bytes;
    const previewMediaType = icns && previewBytes !== bytes ? "image/png" : mediaType;
    const blob = new Blob([toArrayBuffer(previewBytes)], { type: previewMediaType });
    const url = URL.createObjectURL(blob);

    try {
        const dimensions = await readImageDimensions(url);
        return {
            url,
            mediaType: previewMediaType,
            width: dimensions.width,
            height: dimensions.height,
            extractedFromIcns: icns && previewBytes !== bytes,
        };
    } catch {
        return {
            url,
            mediaType: previewMediaType,
            width: null,
            height: null,
            extractedFromIcns: icns && previewBytes !== bytes,
        };
    }
}

function extractLargestPngFromIcns(bytes: Uint8Array): Uint8Array | null {
    if (bytes.length < 8 || text(bytes, 0, 4) !== "icns") {
        return null;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const declaredLength = view.getUint32(4, false);
    const totalLength = Math.min(bytes.length, declaredLength > 8 ? declaredLength : bytes.length);
    const candidates: Uint8Array[] = [];
    let offset = 8;

    while (offset + 8 <= totalLength) {
        const chunkLength = view.getUint32(offset + 4, false);
        if (chunkLength < 8) {
            break;
        }

        const dataStart = offset + 8;
        const dataEnd = Math.min(offset + chunkLength, totalLength);
        if (dataEnd > dataStart && hasPngSignature(bytes, dataStart)) {
            candidates.push(bytes.slice(dataStart, dataEnd));
        }

        offset += chunkLength;
    }

    candidates.sort((a, b) => b.byteLength - a.byteLength);
    return candidates[0] ?? null;
}

function hasPngSignature(bytes: Uint8Array, offset: number): boolean {
    if (offset + PNG_SIGNATURE.length > bytes.length) {
        return false;
    }
    return PNG_SIGNATURE.every((value, index) => bytes[offset + index] === value);
}

function text(bytes: Uint8Array, start: number, length: number): string {
    return Array.from(bytes.slice(start, start + length))
        .map(byte => String.fromCharCode(byte))
        .join("");
}

function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("Failed to load icon preview"));
        image.src = url;
    });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}
