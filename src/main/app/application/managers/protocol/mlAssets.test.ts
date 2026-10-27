import path from "path";
import { describe, expect, it } from "vitest";
import { ML_MODEL_FILE, ML_RUNTIME_FILES, resolveMlAsset } from "./mlAssets";

const dev = { resourcesDir: "/studio/resources", appPath: "/studio", packaged: false };
const packaged = { resourcesDir: "/App/Contents/Resources/resources", appPath: "/App/Contents/Resources/app.asar", packaged: true };

describe("resolveMlAsset", () => {
    it("serves the committed model from resources in both modes", () => {
        expect(resolveMlAsset(`/ml/${ML_MODEL_FILE}`, dev)).toBe(path.join("/studio/resources", "ml", "head-detect", "model.onnx"));
        expect(resolveMlAsset(`/ml/${ML_MODEL_FILE}`, packaged)).toBe(path.join(packaged.resourcesDir, "ml", "head-detect", "model.onnx"));
    });

    it("reads the runtime from node_modules in dev and from the staged copy in a package", () => {
        for (const name of ML_RUNTIME_FILES) {
            expect(resolveMlAsset(`/ml/${name}`, dev)).toBe(path.join("/studio", "node_modules", "onnxruntime-web", "dist", name));
            expect(resolveMlAsset(`/ml/${name}`, packaged)).toBe(path.join(packaged.resourcesDir, "ml", "onnxruntime", name));
        }
    });

    it("answers nothing outside its table", () => {
        expect(resolveMlAsset("/ml/../../etc/passwd", dev)).toBeNull();
        expect(resolveMlAsset("/ml/%2E%2E%2Fmodel.onnx", dev)).toBeNull();
        expect(resolveMlAsset("/ml/ort-wasm-simd-threaded.jsep.wasm", dev)).toBeNull();
        expect(resolveMlAsset("/workspace/index.js", dev)).toBeNull();
    });
});
