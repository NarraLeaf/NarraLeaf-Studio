import { useMemo } from "react";
import { HELP_RESOURCES, HelpBrowser } from "@/lib/help";
import type { HelpTopicId } from "@/lib/help";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { getKeybindingCatalogEntry } from "@/lib/workspace/services/ui/keybindingCatalog";
import { useWorkspace } from "../../context";
import type { EditorComponentProps } from "../types";

export interface HelpEditorPayload {
    topicId?: HelpTopicId;
    /** Set by `openHelpTab`, and only meaningful next to `topicId`. Not carried into a session. */
    request?: number;
}

/**
 * The help browser as an editor tab.
 *
 * An editor tab rather than a panel on purpose: help then costs viewport exactly like a document
 * does, only while it is open, and closes with the same gesture as everything else in that area
 * (docs/help-system.md §5). Nothing about the workspace layout changes for it.
 *
 * Chords are resolved through this window's keybinding service, so a rebound shortcut reads
 * correctly here; the launcher, which has no such service, falls back to the catalog defaults.
 */
export function HelpEditor({ payload }: EditorComponentProps<HelpEditorPayload>) {
    const { context } = useWorkspace();

    const resolveShortcut = useMemo(() => {
        const keybindings = context?.services.get<UIService>(Services.UI).keybindings;
        return (catalogId: string): string | undefined => {
            const entry = getKeybindingCatalogEntry(catalogId);
            if (!entry) {
                return undefined;
            }
            return keybindings?.getEffectiveKey({ id: entry.id, key: entry.key }) ?? entry.key;
        };
    }, [context]);

    return (
        <div className="h-full w-full bg-surface">
            <HelpBrowser
                initialTopic={payload?.topicId}
                topicRequest={payload?.request}
                resources={HELP_RESOURCES}
                resolveShortcut={resolveShortcut}
            />
        </div>
    );
}
