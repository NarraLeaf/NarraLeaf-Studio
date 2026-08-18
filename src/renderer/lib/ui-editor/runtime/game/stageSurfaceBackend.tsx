import { createRoot, type Root } from "react-dom/client";
import type {
    ImageBackend,
    ImageBackendContent,
    ImageBackendInstance,
    ImageBackendSize,
    PuppetBackend,
    PuppetInstance,
    PuppetSize,
    PuppetState,
} from "narraleaf-react";
import type { UIDocument, UIStageSurface } from "@shared/types/ui-editor/document";
import {
    parseStageSurfaceSrc,
    readStageSurfaceMountOptions,
    STAGE_SURFACE_BACKEND_NAME,
} from "@shared/utils/stageSurfaceBackend";
import { EmbeddedStageSurface } from "@/lib/ui-editor/runtime/app/EmbeddedStageSurface";
import type { GameUiSlotHostOptions } from "@/lib/ui-editor/runtime/app/StageSlotSurfaceShell";
import type { FramedCharacterState } from "@/lib/ui-editor/runtime/app/FramedCharacterContext";

export { STAGE_SURFACE_BACKEND_NAME };

/**
 * Studio's own half of both of the engine's host seams: it draws a Game UI surface inside a stage
 * element's box.
 *
 * Which seam mounts it depends on who is being framed, and the difference is exactly the one the
 * engine draws between them:
 *
 *  - a character Studio draws itself is an **`Image`**, so the frame goes on that image's own
 *    backend and the engine hands over the sources it resolved — one element, and `/face` keeps
 *    meaning what it means for an unframed character;
 *  - a character an author's runtime draws is a **`Puppet`**, so the frame is the puppet and the
 *    model is drawn by a widget inside the surface, from the state the engine applies here.
 *
 * Both end in the same React tree; what differs is only what is put into the context the widgets
 * inside read. `puppetBackendHost.ts` is the author-facing half of the puppet seam and stays what
 * it is — it finds renderers the author supplied and never names one. This module names none
 * either: what it mounts is Studio's own React.
 */
type SurfaceHostInput = {
    uidoc: UIDocument;
    slotHostOptions: GameUiSlotHostOptions;
    log?: (level: "info" | "warning" | "error", message: string) => void;
};

/**
 * One React root per host element, shared by every mount that claims the same container.
 *
 * Two engine behaviours meet here and neither can be argued with. The engine mounts a backend from
 * inside its own React commit, so `dispose` cannot unmount synchronously — unmounting a root from
 * inside a commit warns and can be dropped outright. And under StrictMode it mounts, disposes and
 * mounts again in one pass, so the deferred unmount from the first dispose is still queued when the
 * second mount arrives.
 *
 * Creating a second root then warns (`createRoot() on a container that has already been passed to
 * createRoot()`) and draws twice; reusing the root but unmounting on the first dispose is worse —
 * the queued unmount tears down the root the *second* mount is using and the box goes silently
 * empty, which is exactly the failure this counter was written for. So the root is shared and
 * counted: it goes away when the last claim on it does.
 */
type ContainerRoot = { root: Root; claims: number };
const rootsByContainer = new WeakMap<HTMLElement, ContainerRoot>();

type SurfaceMountHandle = {
    setState: (state: FramedCharacterState) => void;
    resize: (size: { width: number; height: number }) => void;
    dispose: () => void;
};

function mountSurface(
    input: SurfaceHostInput,
    container: HTMLElement,
    mount: {
        surfaceId: string | null;
        objectName: string | undefined;
        characterId: string | undefined;
        size: { width: number; height: number };
        initial: FramedCharacterState;
    },
): SurfaceMountHandle {
    const surface = input.uidoc.surfaces.find(
        (item): item is UIStageSurface =>
            item.id === mount.surfaceId && item.kind === "stageSurface" && item.mount.kind === "element",
    );
    let entry = rootsByContainer.get(container);
    if (!entry) {
        entry = { root: createRoot(container), claims: 0 };
        rootsByContainer.set(container, entry);
    }
    entry.claims += 1;
    const claimed = entry;
    let released = false;
    let size = mount.size;
    let state = mount.initial;

    if (!surface) {
        // A missing surface leaves an empty box rather than taking the stage down — the same bargain
        // the engine strikes for a missing backend.
        input.log?.("warning",
            `[${STAGE_SURFACE_BACKEND_NAME}] no element-mounted surface with id "${mount.surfaceId ?? "(none)"}"`);
    }

    const draw = () => {
        if (released || !surface) {
            return;
        }
        claimed.root.render(
            <EmbeddedStageSurface
                options={input.slotHostOptions}
                surface={surface}
                objectName={mount.objectName ?? surface.id}
                characterId={mount.characterId}
                character={state}
                size={size}
            />,
        );
    };
    draw();

    return {
        setState: next => {
            state = next;
            draw();
        },
        resize: next => {
            size = next;
            draw();
        },
        dispose: () => {
            if (released) {
                return;
            }
            released = true;
            claimed.claims -= 1;
            // Deferred for the reason given on `rootsByContainer`, and re-checked when it runs: a
            // remount that arrived in between holds a claim of its own, and the root is its.
            queueMicrotask(() => {
                if (claimed.claims > 0) {
                    return;
                }
                if (rootsByContainer.get(container) === claimed) {
                    rootsByContainer.delete(container);
                }
                claimed.root.unmount();
            });
        },
    };
}

/** The frame for a character Studio draws: the engine resolved the pictures, the surface shows them. */
export function createStageSurfaceImageBackend(input: SurfaceHostInput): ImageBackend {
    return {
        name: STAGE_SURFACE_BACKEND_NAME,
        mount(container: HTMLElement, ctx): ImageBackendInstance {
            const { surfaceId, objectName, characterId } = readStageSurfaceMountOptions(ctx.options);
            const handle = mountSurface(input, container, {
                surfaceId: surfaceId ?? null,
                objectName,
                characterId,
                size: ctx.size,
                initial: { kind: "image", content: ctx.content },
            });
            return {
                apply: (content: ImageBackendContent) => handle.setState({ kind: "image", content }),
                resize: (size: ImageBackendSize) => handle.resize(size),
                dispose: () => handle.dispose(),
            };
        },
    };
}

/** The frame for a character an author's runtime draws: the model is mounted by a widget inside. */
export function createStageSurfacePuppetBackend(input: SurfaceHostInput): PuppetBackend {
    return {
        name: STAGE_SURFACE_BACKEND_NAME,
        mount(container: HTMLElement, ctx): PuppetInstance {
            const options = readStageSurfaceMountOptions(ctx.options);
            const handle = mountSurface(input, container, {
                surfaceId: options.surfaceId ?? parseStageSurfaceSrc(ctx.src),
                objectName: options.objectName,
                characterId: options.characterId,
                size: ctx.size,
                initial: { kind: "puppet", state: null },
            });
            return {
                ready: () => Promise.resolve(),
                apply: (state: PuppetState) => handle.setState({ kind: "puppet", state }),
                command: () => undefined,
                resize: (size: PuppetSize) => handle.resize(size),
                dispose: () => handle.dispose(),
            };
        },
    };
}
