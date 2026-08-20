import { useMemo, useRef, type ReactNode } from "react";
import type { StoryDocument, StorySceneId } from "@shared/types/story";
import { useWorkspace } from "@/apps/workspace/context";
import { useRegistry } from "@/apps/workspace/registry/Registry";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { Services } from "@/lib/workspace/services/services";
/**
 * ⚠ **This import closes a cycle**, and the cycle is kept on purpose:
 *
 *     StorySceneEditorTab → StoryRefNavigationProvider → searchJump → openStorySceneEditorTab
 *                        ↑                                                                 │
 *                        └─────────────────────────────────────────────────────────────────┘
 *
 * It exists because `jumpToSearchTarget` is the workspace's ONE deep-link vocabulary and it can open
 * a scene editor, while the scene editor is also what needs to navigate. Breaking it would mean a
 * second navigation path for rows — the version that quietly stops matching the first — so the cycle
 * is the cheaper of the two.
 *
 * **Why it is safe today.** Every binding across the cycle is a hoisted `function` declaration, and
 * every use of one is inside another function body, so nothing is READ while a module is still
 * initializing: by the time any of these are called, all four modules have finished evaluating.
 *
 * **What would break it.** Anything on this ring that evaluates a cross-module import at module
 * initialization time — a top-level `const` computed from another ring member's export, a decorator, a
 * `class X extends Y`, an eagerly-built lookup table, a `const foo = someImport` re-export alias. Any
 * of those would read a binding from a half-initialized module and get `undefined` **at runtime only**:
 * tsc cannot see it, and the tests here mount the tokens with a stubbed context rather than the real
 * provider, so nothing in the suite would fail either. Keep every cross-ring reference inside a
 * function body, or cut the ring before adding one.
 */
import { jumpToSearchTarget } from "../../search/searchJump";
import { StoryRefNavigationScope } from "./storyRefNavigation";
import { storyRefJumpTarget } from "./storyRefJump";

/**
 * Wires the scene editor's pointing words to the workspace's navigation.
 *
 * Two decisions worth stating, because both are load-bearing:
 *
 * **The destination vocabulary is `jumpToSearchTarget` and nothing else.** A search hit, a lint
 * finding, an asset reference and now a word on a row all reach a place the same way, so "what opens
 * a character" is answered once. A second navigation path here would be the version that quietly
 * stops matching the first.
 *
 * **The document is latched in a ref, not closed over.** The value this publishes has to keep a
 * stable identity through every keystroke: it is read by every link token on screen, and a context
 * whose identity changes with the document would re-render all of them on every edit — undoing the
 * `memo` that makes typing in a long scene cheap. So the resolver reads the latest document at CALL
 * time and the memo below depends only on the services.
 *
 * Navigation is READ-ONLY and therefore survives a freeze. Nothing here is wrapped in the freeze
 * guard on purpose: a frozen workspace is the state in which following a reference matters most,
 * since looking things up is all that is left to do.
 */
export function StoryRefNavigationProvider(props: {
    document: StoryDocument;
    sceneId: StorySceneId;
    children: ReactNode;
}) {
    const { context } = useWorkspace();
    const { openEditorTab, setPanelVisibility } = useRegistry();
    const latest = useRef({ document: props.document, sceneId: props.sceneId });
    latest.current = { document: props.document, sceneId: props.sceneId };

    const value = useMemo(() => {
        const resolve = (ref: Parameters<typeof storyRefJumpTarget>[0]) =>
            storyRefJumpTarget(ref, {
                ...latest.current,
                // Read through the service on every call rather than off a snapshot, like the row's own
                // asset names: an import or a delete does not touch the story document, so nothing here
                // would be told to rebuild a captured table.
                assetType: assetId => {
                    const table = context?.services.get<AssetsService>(Services.Assets).getAssets();
                    for (const byId of Object.values(table ?? {})) {
                        const found = (byId as Record<string, Asset>)[assetId];
                        if (found) {
                            return found.type;
                        }
                    }
                    return null;
                },
                // Asked only when the library did not answer - see `isAssetSet`. Read live for the
                // same reason as the table above it.
                isAssetSet: assetId => Boolean(
                    context?.services.get<AssetSetService>(Services.AssetSets).getSet(assetId),
                ),
            });
        return {
            canOpen: (ref: Parameters<typeof storyRefJumpTarget>[0]) => resolve(ref) !== null,
            open: (ref: Parameters<typeof storyRefJumpTarget>[0]) => {
                const target = resolve(ref);
                if (target) {
                    jumpToSearchTarget(target, { openEditorTab, setPanelVisibility, context });
                }
            },
        };
    }, [context, openEditorTab, setPanelVisibility]);

    return <StoryRefNavigationScope value={value}>{props.children}</StoryRefNavigationScope>;
}
