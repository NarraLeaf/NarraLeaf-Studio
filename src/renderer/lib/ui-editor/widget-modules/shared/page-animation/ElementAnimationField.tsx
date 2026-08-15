import {
    resolveUIElementAnimationSettings,
    uiElementOwnsChildAnimationTiming,
} from "@shared/types/ui-editor/elementAnimation";
import {
    isDefaultUIPageAnimationSettings,
    type UIPageAnimationSettings,
} from "@shared/types/ui-editor/pageAnimation";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { PageAnimationEditor } from "./PageAnimationEditor";

/**
 * How one element arrives and leaves, in the editor a Surface already uses for its page animation.
 *
 * The same record and the same controls, minus the one question an element cannot answer: nothing
 * navigates away from a widget, so it has no incoming Page to hold. What it does have is a parent,
 * and the parent's own "wait for children" is what waits for it.
 */
export function ElementAnimationField({ data }: CustomFieldProps<UIInspectorData>) {
    const element = data.element;
    const settings = resolveUIElementAnimationSettings(element);

    const update = (next: UIPageAnimationSettings) => {
        // One undo entry per field visited: typing a duration collapses, moving to the direction
        // beside it starts a new one. Same derivation the Surface editor uses.
        const changed = (Object.keys(next) as (keyof UIPageAnimationSettings)[])
            .filter(key => next[key] !== settings[key])
            .sort()
            .join(",");
        data.documentService.updateElementAnimation(
            element.id,
            // Back to defaults is back to having none, so a document only carries the animations
            // somebody actually asked for.
            isDefaultUIPageAnimationSettings(next) ? null : next,
            { mergeKey: `element:${element.id}:animation:${changed}` },
        );
    };

    return (
        <PageAnimationEditor
            settings={settings}
            showExitBlocking={false}
            showChildTiming={uiElementOwnsChildAnimationTiming(element.type)}
            onChange={update}
        />
    );
}
