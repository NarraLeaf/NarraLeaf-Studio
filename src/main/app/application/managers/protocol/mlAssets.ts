import path from "path";

/**
 * The files the head detector loads in the workspace window, served at `app://windows/ml/<name>`.
 *
 * Under the window bundles' host because these are Studio's own files beside them, not an author's.
 * The windows themselves load from `file://`; from there the privileged `app:` scheme answers the
 * runtime's `import()` of its glue module, the model fetch and the wasm compile without CORS headers
 * (checked in a running workspace window). A fixed table rather than a directory: the route never
 * joins a requested path onto a base, so these three files are the only ones it can answer with, and
 * anything else under `/ml/` is a 404.
 *
 * The model is project-independent Studio content and is committed under `resources/ml/head-detect`.
 * The two runtime files are onnxruntime-web's WebAssembly build, read from node_modules in a dev
 * session and from `resources/ml/onnxruntime`, where `pack-electron.js` stages them, in a package -
 * the npm package itself is a devDependency and never reaches the installer.
 */
export const ML_ROUTE_PREFIX = "/ml/";

export const ML_MODEL_FILE = "head-detect.onnx";

/** Names as onnxruntime-web asks for them; keep in step with `stageMlRuntime` in pack-electron.js. */
export const ML_RUNTIME_FILES = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"] as const;

export type MlAssetLocations = {
    /** Studio's resources directory (`BaseApp.getResourcesDir()`). */
    resourcesDir: string;
    /** The application root (`BaseApp.getAppPath()`), where node_modules sits in a dev session. */
    appPath: string;
    packaged: boolean;
};

/** The file on disk a request path names, or null when it names nothing this route serves. */
export function resolveMlAsset(pathname: string, locations: MlAssetLocations): string | null {
    if (!pathname.startsWith(ML_ROUTE_PREFIX)) {
        return null;
    }
    const name = decodeURIComponent(pathname.slice(ML_ROUTE_PREFIX.length));
    if (name === ML_MODEL_FILE) {
        return path.join(locations.resourcesDir, "ml", "head-detect", "model.onnx");
    }
    if ((ML_RUNTIME_FILES as readonly string[]).includes(name)) {
        return locations.packaged
            ? path.join(locations.resourcesDir, "ml", "onnxruntime", name)
            : path.join(locations.appPath, "node_modules", "onnxruntime-web", "dist", name);
    }
    return null;
}
