import { initializeCanvas } from "ag-psd";

/**
 * Teach ag-psd to make `ImageData` without a canvas.
 *
 * `useImageData: true` is not on its own enough: ag-psd still calls its canvas factory to *construct*
 * the ImageData objects, and throws "Canvas not initialized" the moment it decodes the first layer.
 * Supplying only the ImageData half keeps the worker free of node-canvas — a native module Studio
 * would otherwise have to build and ship on three platforms to read a file format.
 *
 * The canvas method is deliberately a thrower rather than a stub: nothing in this worker should ever
 * reach a path that needs one, and a silent empty canvas would turn that mistake into a blank layer.
 */
export function initializePsdImageData(): void {
  initializeCanvas(
    () => {
      throw new Error("PSD import does not use a canvas; only ImageData is provided");
    },
    (width: number, height: number) =>
      ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
        colorSpace: "srgb"
      }) as ImageData
  );
}
