/**
 * Live2D Cubism, as a NarraLeaf puppet backend.
 *
 * # This file is not a Live2D distribution, and Studio is not one either
 *
 * Every line here is NarraLeaf's own. It contains no Live2D code at all — only `import` specifiers
 * that *name* the Cubism SDK, and they resolve to nothing until an author supplies it. Studio ships
 * this glue and never the SDK: Cubism Core is redistributable only under the Live2D Proprietary
 * Software License Agreement, the Cubism Framework only under the Live2D Open Software License, and
 * that second licence forbids letting a "source distributed or third-party modifiable" licence cover
 * its code — which is exactly what NarraLeaf's MPL-2.0 is. So the SDK cannot enter this repository,
 * and Studio must never download it either, because fetching it on the author's behalf would be
 * distributing it.
 *
 * The consequence is that this file is *source*, not a shipped module: Studio's runtime installer
 * unpacks the author's own Cubism SDK for Web archive next to it and bundles the two together on the
 * author's machine, producing `<project>/runtimes/puppet/live2d/index.js`.
 *
 * # What it implements
 *
 * The engine's `PuppetBackend`: `mount(container, ctx)` returning an instance with
 * `apply` / `command` / `describe` / `resize` / `ready` / `dispose`. It reads the model bundle
 * entirely through `ctx.resolveSibling`, so it never guesses a path — a `.model3.json` manifest is
 * the only authority on which files a model has.
 *
 * The three-name state vocabulary maps as: `motion` → a Cubism motion (`"<group>_<index>"`, or a bare
 * group name meaning its first entry), `expression` → a Cubism expression by its manifest `Name`, and
 * `skin` → nothing, because the format has no such idea; a request for one is reported rather than
 * silently dropped.
 */

// Must come first: publishes `globalThis.Live2DCubismCore`, which every Framework module reads as a
// bare global rather than an import. Both `gen/` files are written by the installer from the author's
// SDK -- see `puppetRuntimeInstaller.ts`, which owns this layout.
import "./gen/core.js";
import { SHADER_SOURCES } from "./gen/shaders.js";

import {
    CubismFramework,
    LogLevel,
    Option,
} from "../sdk/framework/live2dcubismframework";
import { CubismModelSettingJson } from "../sdk/framework/cubismmodelsettingjson";
import { CubismDefaultParameterId } from "../sdk/framework/cubismdefaultparameterid";
import { CubismUserModel } from "../sdk/framework/model/cubismusermodel";
import { CubismMatrix44 } from "../sdk/framework/math/cubismmatrix44";
import { CubismEyeBlink } from "../sdk/framework/effect/cubismeyeblink";
import {
    BreathParameterData,
    CubismBreath,
} from "../sdk/framework/effect/cubismbreath";
import {
    CubismShaderManager_WebGL,
    CubismShader_WebGL,
} from "../sdk/framework/rendering/cubismshader_webgl";
import { CubismWebGLOffscreenManager } from "../sdk/framework/rendering/cubismoffscreenmanager";

const BACKEND_NAME = "live2d";

/** Live2D has no skin concept; the channel is reported empty rather than invented. */
const SKINS = [];

/**
 * Adapter-level parameters, distinguished from the model's own by a prefix no Cubism parameter uses.
 * `PuppetState.params` is a flat `Record<string, number>` shared between the two, so they need to be
 * told apart without a lookup table.
 */
const ADAPTER_PARAMS = [
    { id: "@timeScale", min: 0, max: 4, default: 1 },
    { id: "@scale", min: 0.05, max: 4, default: 1 },
    { id: "@x", min: -2, max: 2, default: 0 },
    { id: "@y", min: -2, max: 2, default: 0 },
];

/* ------------------------------------------------------------------------------------------------
 * Diagnostics
 *
 * A bounded ring buffer, module-scoped. Loading a Live2D model is a dozen fetches driven by a
 * manifest, and when one of them is wrong the useful information is the *sequence* — which file was
 * reached, which texture was rejected, how far the load got — not the single error that surfaced. So
 * the trail is kept and handed to the host's log at the moment it becomes relevant, which is when a
 * mount fails. Nothing is published to a global: an author's game is not a debugging session.
 * ---------------------------------------------------------------------------------------------- */

const NOTE_LIMIT = 200;
const notes = [];

function note(message) {
    notes.push(message);
    if (notes.length > NOTE_LIMIT) {
        notes.shift();
    }
}

/** The recent trail, oldest first, as one string per line. */
function recentNotes() {
    return notes.join("\n");
}

/* ------------------------------------------------------------------------------------------------
 * Framework lifetime
 * ---------------------------------------------------------------------------------------------- */

let shaderLoaderPatched = false;

/**
 * Serve the 13 shader sources from the bundle instead of the network.
 *
 * `CubismShader_WebGL.loadShaders()` builds `<dir><basename>` and `fetch()`es it, swallowing
 * failures into an empty string — so a wrong path does not error, it compiles empty programs and
 * draws nothing. There is no directory to point it at here: a backend's own files arrive as
 * single-use opaque grant URLs, and the model bundle's directory grant holds the *model*, not the
 * runtime. Intercepting the one-line fetch is the whole fix, and the basename is all the URL
 * carries that matters.
 */
function patchShaderLoader() {
    if (shaderLoaderPatched) {
        return;
    }
    shaderLoaderPatched = true;
    CubismShader_WebGL.prototype.loadShader = function loadShaderFromBundle(url) {
        const name = String(url).slice(String(url).lastIndexOf("/") + 1);
        const source = SHADER_SOURCES[name];
        if (source == null) {
            note(`shader "${name}" is not in the bundle`);
            return Promise.reject(new Error(`shader "${name}" is not bundled`));
        }
        return Promise.resolve(source);
    };
}

let frameworkStarted = false;

function ensureFramework(log) {
    if (frameworkStarted) {
        return;
    }
    const option = new Option();
    option.logFunction = message => note(`core: ${String(message).trim()}`);
    // Verbose here would put every drawable through `note` on every frame.
    option.loggingLevel = LogLevel.LogLevel_Warning;
    CubismFramework.startUp(option);
    CubismFramework.initialize();
    patchShaderLoader();
    frameworkStarted = true;

    // Reported once, because "which Core is this" is the first question about any Live2D problem and
    // the answer is otherwise invisible: the Core is bundled into this file by the author's own
    // install, so it is not something anyone can look up afterwards.
    try {
        const version = Live2DCubismCore.Version.csmGetVersion();
        const text = `0x${version.toString(16)} (${(version >> 24) & 0xff}.${(version >> 16) & 0xff})`;
        note(`core ${text}`);
        log("info", `Cubism Core ${text}`);
    } catch (error) {
        note(`core version unavailable: ${String(error)}`);
        log("warning", `Cubism Core did not report a version: ${String(error)}`);
    }
}

/* ------------------------------------------------------------------------------------------------
 * Fetch helpers. Everything goes through the URL the host handed us; nothing is guessed.
 * ---------------------------------------------------------------------------------------------- */

async function fetchArrayBuffer(url, what) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading ${what} (${url})`);
    }
    return response.arrayBuffer();
}

/**
 * Decode a texture to an `HTMLImageElement`, by way of a blob URL.
 *
 * Cubism needs premultiplied textures and gets them by having GL do the multiply on upload
 * (`UNPACK_PREMULTIPLY_ALPHA_WEBGL`). That rules out `ImageBitmap`: WebGL **requires**
 * `UNPACK_PREMULTIPLY_ALPHA_WEBGL` to be false when the source is an `ImageBitmap`, and raises
 * `INVALID_OPERATION` otherwise — which `texImage2D` reports through `getError()` and nowhere else,
 * so the upload silently does nothing and the model draws in flat white.
 *
 * The blob URL matters too. An `<img>` pointed straight at the host's own scheme is not necessarily
 * same-origin with the document, and `texImage2D` on a tainted image throws `SecurityError`; a blob
 * minted in this realm always is.
 */
async function decodeTexture(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading texture (${url})`);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    try {
        const image = new Image();
        await new Promise((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error(`could not decode texture ${url}`));
            image.src = objectUrl;
        });
        if (typeof image.decode === "function") {
            await image.decode().catch(() => undefined);
        }
        return image;
    } finally {
        // Revoked on the next tick so the upload has definitely taken its copy.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
}

/* ------------------------------------------------------------------------------------------------
 * The model
 * ---------------------------------------------------------------------------------------------- */

class Live2DModel extends CubismUserModel {
    constructor() {
        super();
        // `CubismUserModel` owns the two *managers* but not the loaded-asset maps: those live in the
        // SDK's sample model, so a class deriving straight from `CubismUserModel` has to bring them.
        this._motions = new Map();
        this._expressions = new Map();
        this.setting = null;
        /** `"<group>_<index>"`, the key Cubism's own sample uses. */
        this.motionNames = [];
        this.motionGroups = new Map();
        this.expressionNames = [];
        this.textures = [];
    }

    /** The model's own canvas, in pixels rather than Cubism's logical units. */
    pixelCanvasSize() {
        const model = this.getModel();
        if (!model) {
            return null;
        }
        const perUnit = model.getPixelsPerUnit();
        return {
            width: Math.round(model.getCanvasWidth() * perUnit),
            height: Math.round(model.getCanvasHeight() * perUnit),
        };
    }

    modelParams() {
        const model = this.getModel();
        if (!model) {
            return [];
        }
        const out = [];
        for (let index = 0; index < model.getParameterCount(); index++) {
            out.push({
                id: model.getParameterId(index).getString(),
                min: model.getParameterMinimumValue(index),
                max: model.getParameterMaximumValue(index),
                default: model.getParameterDefaultValue(index),
            });
        }
        return out;
    }

    /**
     * Put every parameter back to the value it has with nothing applied.
     *
     * This is what the engine's `motion: null` means — "the model rests at whatever it looks like
     * with no motion applied". Stopping the motion manager alone would not do it: the per-frame
     * `loadParameters()` restores the snapshot the last motion frame saved, so the model would
     * freeze mid-motion instead of resting.
     */
    resetToRestPose() {
        const model = this.getModel();
        if (!model) {
            return;
        }
        for (let index = 0; index < model.getParameterCount(); index++) {
            model.setParameterValueByIndex(index, model.getParameterDefaultValue(index));
        }
        model.saveParameters();
    }
}

class Live2DPuppetInstance {
    constructor(container, ctx, hostLog) {
        this.ctx = ctx;
        // Two loggers on purpose: the host's own `(level, message)` for diagnostics, and a
        // one-argument wrapper for the load path, which reports at warning level.
        this.hostLog = hostLog;
        this.log = message => hostLog("warning", message);
        this.disposed = false;
        this.size = { width: ctx.size.width, height: ctx.size.height };
        this.options = ctx.options || {};
        this.model = null;
        this.pendingState = null;
        this.appliedState = null;
        this.params = {};
        this.frameHandle = null;
        this.lastFrameTime = 0;
        this.drawnFrames = 0;
        this.motionEnd = null;

        this.canvas = document.createElement("canvas");
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.style.display = "block";
        container.appendChild(this.canvas);
        this.applyCanvasSize();

        // Cubism 5-r.5 asks for webgl2 only.
        this.gl = this.canvas.getContext("webgl2", {
            alpha: true,
            premultipliedAlpha: true,
            antialias: true,
            depth: false,
            stencil: false,
        });

        this.readyPromise = this.boot();
        this.readyPromise.catch(error => {
            const message = error && error.message ? error.message : String(error);
            note(`mount failed: ${message}`);
            this.log(`load failed: ${message}`);
            // The trail, only on the path where it is worth reading. One error on its own rarely says
            // which of a manifest's dozen files was the problem.
            this.hostLog("info", `Live2D load trail:\n${recentNotes()}`);
        });
    }

    applyCanvasSize() {
        const ratio = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.round(this.size.width * ratio));
        this.canvas.height = Math.max(1, Math.round(this.size.height * ratio));
    }

    /**
     * The entry URL. `resolveSibling("")` is documented to resolve to `src` itself *and* to put the
     * result through the preload-cache rules, which a bare read of `ctx.src` would skip.
     */
    entryUrl() {
        try {
            const resolved = this.ctx.resolveSibling("");
            if (typeof resolved === "string" && resolved) {
                return resolved;
            }
        } catch {
            // A host that does not implement it falls back to the descriptor as given.
        }
        return this.ctx.src;
    }

    sibling(relativePath) {
        return this.ctx.resolveSibling(relativePath);
    }

    async boot() {
        if (!this.gl) {
            throw new Error("WebGL2 is not available");
        }
        ensureFramework(this.hostLog);
        await this.load();
        if (this.disposed) {
            return;
        }
        this.start();
        await this.firstFrame();
        // Off unless the author asks: see reportPaint, which costs a full-canvas readPixels.
        if (this.options.diagnostics === true) {
            this.reportPaint();
        }
    }

    /**
     * Read the canvas back and say what is on it — `{"diagnostics": true}` in the character's runtime
     * options, and off otherwise.
     *
     * Worth having because it answers the one question a screenshot cannot when a model "does not
     * show up": it distinguishes *drew the model* from *drew nothing* from *drew a flat white
     * silhouette* (the signature of a texture upload WebGL rejected), and it works in a packaged
     * production game, which refuses to run under a debugger at all.
     *
     * Not on by default because it is a synchronous full-canvas `readPixels` — several megabytes and a
     * pipeline stall, once per character mount. That is a fair price for an author chasing a bug and
     * an unfair one for every player.
     */
    reportPaint() {
        const gl = this.gl;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const pixels = new Uint8Array(width * height * 4);
        // Has to happen inside a frame: without preserveDrawingBuffer the back buffer is only
        // readable until the compositor takes it.
        const original = this.draw.bind(this);
        this.draw = delta => {
            original(delta);
            this.draw = original;
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let opaque = 0;
            let flatWhite = 0;
            const distinct = new Set();
            for (let index = 0; index < pixels.length; index += 4) {
                if (pixels[index + 3] < 8) {
                    continue;
                }
                opaque++;
                if (pixels[index] > 245 && pixels[index + 1] > 245 && pixels[index + 2] > 245) {
                    flatWhite++;
                }
                distinct.add((pixels[index] >> 4) << 8 | (pixels[index + 1] >> 4) << 4 | (pixels[index + 2] >> 4));
            }
            const line = `painted ${width}x${height}: ${opaque} opaque px, `
                + `${distinct.size} distinct colours, ${flatWhite} flat-white px`;
            note(line);
            this.log(line);
        };
    }

    async load() {
        const entry = this.entryUrl();
        note(`loading ${entry}`);
        const manifest = await fetchArrayBuffer(entry, "the model manifest");
        const setting = new CubismModelSettingJson(manifest, manifest.byteLength);

        const model = new Live2DModel();
        model.setting = setting;

        const mocName = setting.getModelFileName();
        if (!mocName) {
            throw new Error("the manifest names no model file");
        }
        const moc = await fetchArrayBuffer(this.sibling(mocName), mocName);
        model.loadModel(moc, false);
        if (!model.getModel()) {
            throw new Error(`the model file could not be read (${mocName})`);
        }

        // Expressions. `getExpressionName(i)` is the manifest's own `Name`, which is the string the
        // author will be choosing from a dropdown, so it is what `_expressions` gets keyed on.
        for (let index = 0; index < setting.getExpressionCount(); index++) {
            const name = setting.getExpressionName(index);
            const file = setting.getExpressionFileName(index);
            if (!name || !file) {
                continue;
            }
            try {
                const buffer = await fetchArrayBuffer(this.sibling(file), file);
                const expression = model.loadExpression(buffer, buffer.byteLength, name);
                if (expression) {
                    model._expressions.set(name, expression);
                    model.expressionNames.push(name);
                }
            } catch (error) {
                this.ctx.warn(`expression "${name}" could not be loaded`, error);
            }
        }

        const physicsName = setting.getPhysicsFileName();
        if (physicsName) {
            try {
                const buffer = await fetchArrayBuffer(this.sibling(physicsName), physicsName);
                model.loadPhysics(buffer, buffer.byteLength);
            } catch (error) {
                this.ctx.warn("physics could not be loaded", error);
            }
        }

        const poseName = setting.getPoseFileName();
        if (poseName) {
            try {
                const buffer = await fetchArrayBuffer(this.sibling(poseName), poseName);
                model.loadPose(buffer, buffer.byteLength);
            } catch (error) {
                this.ctx.warn("pose could not be loaded", error);
            }
        }

        const userDataName = setting.getUserDataFile();
        if (userDataName) {
            try {
                const buffer = await fetchArrayBuffer(this.sibling(userDataName), userDataName);
                model.loadUserData(buffer, buffer.byteLength);
            } catch (error) {
                this.ctx.warn("user data could not be loaded", error);
            }
        }

        // Effect parameter ids have to be collected before motions are read: a motion is told which
        // parameters belong to blinking and lip sync so it can suppress them.
        const eyeBlinkIds = [];
        for (let index = 0; index < setting.getEyeBlinkParameterCount(); index++) {
            eyeBlinkIds.push(setting.getEyeBlinkParameterId(index));
        }
        const lipSyncIds = [];
        for (let index = 0; index < setting.getLipSyncParameterCount(); index++) {
            lipSyncIds.push(setting.getLipSyncParameterId(index));
        }
        if (eyeBlinkIds.length > 0) {
            model._eyeBlink = CubismEyeBlink.create(setting);
        }

        const ids = CubismFramework.getIdManager();
        model._breath = CubismBreath.create();
        model._breath.setParameters([
            new BreathParameterData(ids.getId(CubismDefaultParameterId.ParamAngleX), 0, 15, 6.5345, 0.5),
            new BreathParameterData(ids.getId(CubismDefaultParameterId.ParamAngleY), 0, 8, 3.5345, 0.5),
            new BreathParameterData(ids.getId(CubismDefaultParameterId.ParamAngleZ), 0, 10, 5.5345, 0.5),
            new BreathParameterData(ids.getId(CubismDefaultParameterId.ParamBodyAngleX), 0, 4, 15.5345, 0.5),
            new BreathParameterData(ids.getId(CubismDefaultParameterId.ParamBreath), 0.5, 0.5, 3.2345, 1),
        ]);

        // Motions, every group, every entry. `<group>_<index>` is Cubism's own key and therefore the
        // author-facing name; the bare group name is accepted too and means its first entry.
        for (let groupIndex = 0; groupIndex < setting.getMotionGroupCount(); groupIndex++) {
            const group = setting.getMotionGroupName(groupIndex);
            const count = setting.getMotionCount(group);
            model.motionGroups.set(group, count);
            for (let index = 0; index < count; index++) {
                const file = setting.getMotionFileName(group, index);
                const name = `${group}_${index}`;
                try {
                    const buffer = await fetchArrayBuffer(this.sibling(file), file);
                    const motion = model.loadMotion(
                        buffer, buffer.byteLength, name, null, null, setting, group, index, false,
                    );
                    if (motion) {
                        motion.setEffectIds(eyeBlinkIds, lipSyncIds);
                        model._motions.set(name, motion);
                        model.motionNames.push(name);
                    }
                } catch (error) {
                    this.ctx.warn(`motion "${name}" could not be loaded`, error);
                }
            }
        }

        const layout = new Map();
        setting.getLayoutMap(layout);
        if (model._modelMatrix) {
            model._modelMatrix.setupFromLayout(layout);
        }
        model.getModel().saveParameters();

        model.createRenderer(this.canvas.width, this.canvas.height);
        const renderer = model.getRenderer();
        renderer.setIsPremultipliedAlpha(true);
        renderer.startUp(this.gl);

        // Textures last: `bindTexture` only records a handle, but the uploads want the context the
        // renderer has already been given.
        const textureCount = setting.getTextureCount();
        for (let index = 0; index < textureCount; index++) {
            const file = setting.getTextureFileName(index);
            if (!file) {
                continue;
            }
            const source = await decodeTexture(this.sibling(file));
            const texture = this.uploadTexture(source, `texture ${index} (${file})`);
            model.textures.push(texture);
            renderer.bindTexture(index, texture);
        }

        // Fires the (now inlined) shader load. Has to follow `startUp`, which is what gives the
        // renderer its context.
        renderer.loadShaders(null);

        this.model = model;
        note(
            `loaded: ${model.motionNames.length} motions, `
            + `${model.expressionNames.length} expressions, ${textureCount} textures`,
        );
        if (this.pendingState) {
            const state = this.pendingState;
            this.pendingState = null;
            this.applyNow(state);
        }
    }

    uploadTexture(source, what) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        while (gl.getError() !== gl.NO_ERROR) {
            // Drain anything left by an earlier call so the check below is about this upload.
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        // Checked rather than assumed: a rejected upload leaves a valid-looking texture object that
        // simply has no image in it, and the only report of that is here.
        const error = gl.getError();
        if (error !== gl.NO_ERROR) {
            this.ctx.warn(`${what} was rejected by WebGL (0x${error.toString(16)})`);
            note(`${what} upload failed: 0x${error.toString(16)}`);
        }
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return texture;
    }

    /* -- state -------------------------------------------------------------------------------- */

    /** `"Idle_3"` names one motion; `"Idle"` names its group and means the first entry. */
    resolveMotion(name) {
        const model = this.model;
        if (model._motions.get(name)) {
            const separator = name.lastIndexOf("_");
            const group = separator === -1 ? name : name.slice(0, separator);
            const index = separator === -1 ? 0 : Number(name.slice(separator + 1));
            return { key: name, group, index: Number.isFinite(index) ? index : 0 };
        }
        if (model.motionGroups.has(name) && model.motionGroups.get(name) > 0) {
            return { key: `${name}_0`, group: name, index: 0 };
        }
        return null;
    }

    applyNow(state) {
        const model = this.model;
        const previous = this.appliedState;
        this.appliedState = state;

        // Motion. Re-issued only when the request changed, so an unrelated `apply()` does not
        // restart the loop the model is settled into.
        const motion = state.motion || null;
        if (!previous || previous.motion !== motion) {
            if (!motion) {
                model._motionManager.stopAllMotions();
                model.resetToRestPose();
            } else {
                const resolved = this.resolveMotion(motion);
                if (!resolved) {
                    this.ctx.warn(`unknown motion "${motion}"`);
                } else {
                    const entry = model._motions.get(resolved.key);
                    entry.setLoop(true);
                    entry.setLoopFadeIn(true);
                    entry.setFinishedMotionHandler(null);
                    model._motionManager.setReservePriority(0);
                    model._motionManager.startMotionPriority(entry, false, 3);
                }
            }
        }

        // Expression. `null` clears rather than substituting a model's own "neutral".
        const expression = state.expression || null;
        if (!previous || previous.expression !== expression) {
            if (!expression) {
                model._expressionManager.stopAllMotions();
            } else if (model._expressions.get(expression)) {
                model._expressionManager.startMotion(model._expressions.get(expression), false);
            } else {
                this.ctx.warn(`unknown expression "${expression}"`);
            }
        }

        // Skin: the format has no such idea, so a request for one is reported rather than ignored.
        if (state.skin) {
            this.ctx.warn(`this runtime has no skins; ignoring "${state.skin}"`);
        }

        this.params = { ...(state.params || {}) };
    }

    apply(state) {
        if (!this.model) {
            this.pendingState = state;
            // Returning the load holds `ready()` back until the first pose has landed, so the
            // element is never reported ready showing a pose the author did not ask for.
            return this.readyPromise.catch(() => undefined);
        }
        this.applyNow(state);
        return undefined;
    }

    adapterParam(id, fallback) {
        const value = this.params[id];
        return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    }

    /* -- frame loop --------------------------------------------------------------------------- */

    start() {
        if (this.frameHandle !== null || this.disposed) {
            return;
        }
        this.lastFrameTime = performance.now();
        const frame = now => {
            this.frameHandle = null;
            if (this.disposed) {
                return;
            }
            const delta = Math.min(0.1, Math.max(0, (now - this.lastFrameTime) / 1000));
            this.lastFrameTime = now;
            try {
                this.draw(delta);
            } catch (error) {
                note(`frame failed: ${error && error.message ? error.message : String(error)}`);
            }
            this.frameHandle = requestAnimationFrame(frame);
        };
        this.frameHandle = requestAnimationFrame(frame);
    }

    draw(delta) {
        const model = this.model;
        if (!model || !model.getModel()) {
            return;
        }
        const gl = this.gl;
        const scaled = delta * this.adapterParam("@timeScale", 1);
        const cubism = model.getModel();

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);

        CubismWebGLOffscreenManager.getInstance().beginFrameProcess(gl);

        // The main motion runs against the saved snapshot and re-saves it; every effect below layers
        // on top of that result and is recomputed from scratch each frame.
        cubism.loadParameters();
        let motionUpdated = false;
        if (!model._motionManager.isFinished()) {
            motionUpdated = model._motionManager.updateMotion(cubism, scaled);
        }
        cubism.saveParameters();

        if (model._eyeBlink && !motionUpdated) {
            model._eyeBlink.updateParameters(cubism, scaled);
        }
        if (model._expressionManager) {
            model._expressionManager.updateMotion(cubism, scaled);
        }
        if (model._breath) {
            model._breath.updateParameters(cubism, scaled);
        }
        if (model._physics) {
            model._physics.evaluate(cubism, scaled);
        }
        if (model._pose) {
            model._pose.updateParameters(cubism, scaled);
        }

        // The author's explicit parameters go last so nothing overwrites them.
        for (const [id, value] of Object.entries(this.params)) {
            if (id.startsWith("@") || typeof value !== "number" || !Number.isFinite(value)) {
                continue;
            }
            cubism.setParameterValueById(CubismFramework.getIdManager().getId(id), value);
        }

        cubism.update();

        const projection = new CubismMatrix44();
        const width = this.canvas.width;
        const height = this.canvas.height;
        // Fit by height, which is what the model matrix normalises to (two logical units tall).
        projection.scale(height / width, 1);
        const scale = this.adapterParam("@scale", Number(this.options.scale) || 1);
        projection.scaleRelative(scale, scale);
        projection.translateRelative(
            this.adapterParam("@x", Number(this.options.offsetX) || 0),
            this.adapterParam("@y", Number(this.options.offsetY) || 0),
        );
        // `draw()` would mutate this in place, which is why it is rebuilt every frame.
        projection.multiplyByMatrix(model._modelMatrix);

        const renderer = model.getRenderer();
        renderer.setMvpMatrix(projection);
        renderer.setRenderState(null, [0, 0, width, height]);
        renderer.drawModel(null);

        CubismWebGLOffscreenManager.getInstance().endFrameProcess(gl);

        if (this.shadersReady()) {
            this.drawnFrames++;
        }
    }

    /**
     * Whether the renderer has programs to draw with.
     *
     * Until the sources land, every draw call bails out with a warning, so counting frames alone
     * would report a blank canvas as ready.
     */
    shadersReady() {
        const shader = CubismShaderManager_WebGL.getInstance().getShader(this.gl);
        return Boolean(shader && shader._isShaderLoaded);
    }

    firstFrame() {
        return new Promise((resolve, reject) => {
            const deadline = performance.now() + 15000;
            const check = () => {
                if (this.disposed) {
                    resolve();
                    return;
                }
                if (this.drawnFrames >= 2) {
                    resolve();
                    return;
                }
                if (performance.now() > deadline) {
                    reject(new Error("the first frame did not draw within 15s"));
                    return;
                }
                requestAnimationFrame(check);
            };
            check();
        });
    }

    /* -- contract ----------------------------------------------------------------------------- */

    ready() {
        return this.readyPromise;
    }

    command(name, payload) {
        const data = payload || {};
        if (!this.model) {
            return this.readyPromise.then(() => this.command(name, payload));
        }
        const model = this.model;
        if (name === "playOnce") {
            const requested = typeof data.motion === "string"
                ? data.motion
                : `${data.group}_${typeof data.index === "number" ? data.index : 0}`;
            const resolved = this.resolveMotion(requested);
            if (!resolved) {
                this.ctx.warn(`unknown motion "${requested}"`);
                return Promise.resolve();
            }
            const entry = model._motions.get(resolved.key);
            entry.setLoop(false);
            return new Promise(resolve => {
                entry.setFinishedMotionHandler(() => resolve());
                model._motionManager.setReservePriority(0);
                model._motionManager.startMotionPriority(entry, false, 3);
            });
        }
        if (name === "randomMotion") {
            const group = String(data.group || "");
            const count = model.motionGroups.get(group) || 0;
            if (count === 0) {
                this.ctx.warn(`unknown motion group "${group}"`);
                return Promise.resolve();
            }
            return this.command("playOnce", { group, index: Math.floor(Math.random() * count) });
        }
        if (name === "setParam") {
            if (typeof data.id === "string" && typeof data.value === "number") {
                this.params = { ...this.params, [data.id]: data.value };
            }
            return Promise.resolve();
        }
        if (name === "stop") {
            model._motionManager.stopAllMotions();
            model.resetToRestPose();
            return Promise.resolve();
        }
        this.ctx.warn(`unknown command "${name}"`);
        return Promise.resolve();
    }

    resize(size) {
        this.size = { width: size.width, height: size.height };
        this.applyCanvasSize();
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
        if (this.model) {
            this.model.setRenderTargetSize(this.canvas.width, this.canvas.height);
        }
    }

    async describe() {
        // Deliberately awaited rather than refused: the host asks whenever the author opens an
        // inspector, which is not when a model happens to have finished loading.
        await this.readyPromise;
        const model = this.model;
        return {
            motions: [...model.motionNames],
            expressions: [...model.expressionNames],
            skins: [...SKINS],
            params: [...ADAPTER_PARAMS, ...model.modelParams()],
            size: model.pixelCanvasSize(),
        };
    }

    dispose() {
        this.disposed = true;
        if (this.frameHandle !== null) {
            cancelAnimationFrame(this.frameHandle);
            this.frameHandle = null;
        }
        try {
            if (this.model) {
                this.model.release();
            }
        } catch (error) {
            note(`release failed: ${error && error.message ? error.message : String(error)}`);
        }
        if (this.gl) {
            for (const texture of (this.model ? this.model.textures : [])) {
                try {
                    this.gl.deleteTexture(texture);
                } catch {
                    // A lost context is not worth reporting on teardown.
                }
            }
        }
        this.model = null;
        this.canvas.remove();
    }
}

export default function createPuppetBackends({ log }) {
    log("info", `${BACKEND_NAME} backend registered`);
    return {
        name: BACKEND_NAME,
        mount(container, ctx) {
            return new Live2DPuppetInstance(container, ctx, log);
        },
    };
}
