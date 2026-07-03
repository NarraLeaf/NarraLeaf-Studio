import type { Workspace } from "@/lib/workspace/workspace";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { Services } from "@/lib/workspace/services/services";

/**
 * Persist editor-side project state to disk before Dev Mode reads project files.
 */
export async function flushUIDocAndGraphIfDirty(workspace: Workspace): Promise<void> {
    const ctx = workspace.getContext();
    const uid = ctx.services.get<UIDocumentService>(Services.UIDocument);
    const graph = ctx.services.get<UIGraphService>(Services.UIGraph);
    const story = ctx.services.get<StoryService>(Services.Story);
    const character = ctx.services.get<CharacterService>(Services.Character);
    if (uid.isDirty()) {
        await uid.save(uid.getDocument());
    }
    if (graph.isDirty()) {
        await graph.save(graph.getDocument());
    }
    if (story.isDirty()) {
        await story.flushPendingChanges();
    }
    if (character.isDirty()) {
        await character.flushPendingChanges();
    }
}
