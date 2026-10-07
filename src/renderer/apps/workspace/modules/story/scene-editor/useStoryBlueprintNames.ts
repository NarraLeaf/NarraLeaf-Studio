import { useMemo } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useTranslation } from "@/lib/i18n";
import { catalogStoryBlueprintNodeReader, storyBlueprintName } from "@/lib/story/storyBlueprintSummary";
import type { StoryRowLookups } from "@/lib/story/storyRowProjection";
import { Services } from "@/lib/workspace/services/services";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";

/**
 * The name each `/blueprint` row's blueprint goes by, for the row projection's `blueprintName`.
 *
 * One subscription per caller - the scene editor's line context and the inspector, not one per row -
 * and a new lookup whenever the blueprint document changes, so a row follows its graph being edited
 * and its blueprint being renamed. Names are worked out once per document revision and kept.
 *
 * Undefined until the workspace is ready, which the projection reads as "name only the kind".
 */
export function useStoryBlueprintNames(): StoryRowLookups["blueprintName"] {
    const { context, isInitialized } = useWorkspace();
    const { t } = useTranslation();
    const revision = useBlueprintDocumentRevision();
    return useMemo(() => {
        if (!context || !isInitialized) {
            return undefined;
        }
        const blueprints = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const catalog = context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
        const names = new Map<string, string | null>();
        return (blueprintId: string) => {
            if (!names.has(blueprintId)) {
                let name: string | null = null;
                try {
                    const document = blueprints.getBlueprintDocument();
                    name = storyBlueprintName(document, blueprintId, catalogStoryBlueprintNodeReader(catalog, document, t));
                } catch {
                    // No blueprint document yet: the row names its kind, as it does before one exists.
                }
                names.set(blueprintId, name);
            }
            return names.get(blueprintId) ?? null;
        };
        // `revision` is the document changing under the same service objects.
    }, [context, isInitialized, revision, t]);
}
