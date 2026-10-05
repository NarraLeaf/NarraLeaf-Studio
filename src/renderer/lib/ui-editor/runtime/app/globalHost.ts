/**
 * The host the game's global blueprint runs on.
 *
 * The global blueprint belongs to no surface, so it borrows one: every dispatch to it from the app -
 * its key heads and the actions they raise, `On Action` for a pointer gesture, the four ambient
 * events, `App Boot` and `On Game Ready` - runs on the active page's host (see `hostAdapterBundles`).
 * That is what its state reads, its broadcasts and its Fn calls have always been answered by, and
 * nothing here changes it.
 *
 * One question cannot be borrowed. `Is Game Overlay` on a page's host is a fact about that page -
 * whether it was opened over a running playthrough - fixed when it opened. Asked from the global
 * blueprint, that answered for whichever page happened to be active, which during a game is the
 * page the game hid when it took the screen: so a menu shown with `Show Layer` over the story, or a
 * confirmation over it, left the answer false, and a global key meant to act on the story only
 * while it is on screen - H hiding the dialogue box, A turning auto forward on - acted on the story
 * behind the menu. The question the global blueprint is asking is the game's: is something covering
 * the story? The skip loop, the auto-forward hold and the advance keys already ask exactly that
 * (`isStoryOnScreen` in `GameApp`, `stageOcclusion`), so the global host answers with the same rule:
 * a page drawn over the stage, or a modal layer. A layer that declares nothing modal - a HUD, a
 * toast - leaves the story as live as it was, there and here.
 *
 * Outside a game there is no stage to cover, and the answer stays the active page's, as it was.
 *
 * Both readings are taken when a graph asks, never when the host is built, so a key pressed in the
 * same instant a layer opens or closes reads the screen as it is - the reason `isStoryOnScreen`
 * reads stores rather than state.
 *
 * Comments in English per project convention.
 */

import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { UIHostAdapter, UIHostAdapterBlueprintRuntime } from "@/lib/ui-editor/runtime/types";
import type { HostAdapterBundle } from "./types";

/** What the global answer is read from, at the moment a graph asks. */
export type GlobalStageReading = {
    /** Whether a game holds the screen: a session with its stage up (`sessionGate.isInGame`). */
    isInGame: () => boolean;
    /** Whether a page or a modal, drawn layer is over that stage (`stageOcclusion.isStageCovered`). */
    isStageCovered: () => boolean;
};

/**
 * `target`, with the keys of `overrides` answered from there and every other read passed through.
 *
 * A proxy rather than a copy because the page's adapter is not finished when it is built: the layer
 * that draws the page fills in its transition reader afterwards, and a copy taken before that would
 * keep answering without it. Spreading the result still yields the overrides, since a spread reads
 * every key through `get`.
 */
function overlay<T extends object>(target: T, overrides: Partial<T>): T {
    return new Proxy(target, {
        get(subject, key, receiver) {
            if (Object.prototype.hasOwnProperty.call(overrides, key)) {
                return (overrides as Record<PropertyKey, unknown>)[key];
            }
            return Reflect.get(subject, key, receiver);
        },
    });
}

/**
 * The global blueprint's host, made from the active page's: that host in every respect, except that
 * `Is Game Overlay` answers for the game while one is running.
 *
 * The page's own host is untouched - a graph on the page, or on a layer, still asks about itself.
 * A Fn the global blueprint calls runs on this host too, as the body of a call runs on its caller's,
 * so pulling nodes out of a global graph into a Fn does not change what they read.
 */
export function buildGlobalHostAdapterBundle(page: HostAdapterBundle, reading: GlobalStageReading): HostAdapterBundle {
    const runtime = page.hostAdapter.blueprintRuntime;
    const hostApi = runtime?.hostApi;
    if (!runtime || !hostApi) {
        return page;
    }
    const game = hostApi.game;
    const globalHostApi = overlay<BlueprintHostApiRuntime>(hostApi, {
        game: overlay(game, {
            isGameOverlay: () => {
                // Asked of the page first, every time, so the call is traced exactly as it always was
                // and the answer outside a game is the page's by construction rather than by copy.
                const pageAnswer = game.isGameOverlay();
                return reading.isInGame() ? reading.isStageCovered() : pageAnswer;
            },
        }),
    });
    let globalAdapter: UIHostAdapter | null = null;
    const invokeBlueprintFn = runtime.invokeBlueprintFn;
    const globalRuntime = overlay<UIHostAdapterBlueprintRuntime>(runtime, {
        hostApi: globalHostApi,
        ...(invokeBlueprintFn
            ? {
                invokeBlueprintFn: input => invokeBlueprintFn({ ...input, hostAdapter: globalAdapter ?? undefined }),
            }
            : {}),
    });
    globalAdapter = overlay<UIHostAdapter>(page.hostAdapter, { blueprintRuntime: globalRuntime });
    return { ...page, hostAdapter: globalAdapter };
}
