import { AppHost, AppProtocol } from "@shared/types/constants";
import type { PortraitCrop } from "./types";
import { bestHead, headFrame, HEAD_DETECT_INPUT_PX, LETTERBOX_FILL, letterbox, toInputTensor } from "./headDetection";

/**
 * The head detector, run in the workspace window on onnxruntime-web's WebAssembly backend.
 *
 * Only ever on an author's or an agent's request - the Auto-frame buttons and
 * `character_avatars_autoframe`. The avatar bake that runs by itself keeps the silhouette heuristic
 * (`lib/utils/headCrop.ts`), so opening a project never loads a model.
 *
 * The model and the runtime come from `app://windows/ml/`, which the main process answers from
 * Studio's own files (`mlAssets.ts`): nothing here reaches the network. Single-threaded and on this
 * thread: more threads need a cross-origin-isolated window, and a proxy worker would load the whole
 * workspace bundle a second time. A picture takes about a quarter of a second, and a batch yields
 * between pictures (see `avatarAutoFrame.ts`).
 */

const ML_BASE = `${AppProtocol}://${AppHost.Windows}/ml/`;
const MODEL_URL = `${ML_BASE}head-detect.onnx`;

type OrtModule = typeof import("onnxruntime-web/wasm");
type Session = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

let loading: Promise<{ ort: OrtModule; session: Session }> | null = null;

/** The session, created on first use and kept for the window's life. A failed load is retried next time. */
function loadDetector(): Promise<{ ort: OrtModule; session: Session }> {
    if (!loading) {
        loading = (async () => {
            const ort = await import("onnxruntime-web/wasm");
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.proxy = false;
            ort.env.wasm.wasmPaths = ML_BASE;
            const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
            return { ort, session };
        })();
        loading.catch(() => {
            loading = null;
        });
    }
    return loading;
}

/**
 * Locate the head in a stack of layers drawn centred on one another (the rule the engine and the
 * bake composite by), and return the avatar framing for it - normalised to the composite - or null
 * when the model sees no head.
 *
 * The layers are drawn straight into the model's input at its scale, so a 4000-pixel sprite never
 * becomes a full-size canvas here.
 */
export async function detectHeadFrame(layers: readonly ImageBitmap[]): Promise<PortraitCrop | null> {
    if (layers.length === 0) {
        return null;
    }
    const width = Math.max(...layers.map(layer => layer.width));
    const height = Math.max(...layers.map(layer => layer.height));
    const box = letterbox(width, height);

    const canvas = new OffscreenCanvas(HEAD_DETECT_INPUT_PX, HEAD_DETECT_INPUT_PX);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        throw new Error("No 2D canvas for the head detector.");
    }
    context.fillStyle = `rgb(${LETTERBOX_FILL}, ${LETTERBOX_FILL}, ${LETTERBOX_FILL})`;
    context.fillRect(0, 0, HEAD_DETECT_INPUT_PX, HEAD_DETECT_INPUT_PX);
    // Transparent areas read as white, as the model saw them in training.
    context.fillStyle = "#ffffff";
    context.fillRect(box.offsetX, box.offsetY, box.drawWidth, box.drawHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    for (const layer of layers) {
        context.drawImage(
            layer,
            box.offsetX + ((width - layer.width) / 2) * box.scale,
            box.offsetY + ((height - layer.height) / 2) * box.scale,
            layer.width * box.scale,
            layer.height * box.scale,
        );
    }
    const pixels = context.getImageData(0, 0, HEAD_DETECT_INPUT_PX, HEAD_DETECT_INPUT_PX).data;

    const { ort, session } = await loadDetector();
    const input = new ort.Tensor("float32", toInputTensor(pixels), [1, 3, HEAD_DETECT_INPUT_PX, HEAD_DETECT_INPUT_PX]);
    const results = await session.run({ [session.inputNames[0]]: input });
    const output = results[session.outputNames[0]];
    const anchors = output.dims[2];
    const head = bestHead(output.data as Float32Array, anchors, box);
    input.dispose();
    output.dispose();
    return head ? headFrame(head, width, height) : null;
}
