import type { Workspace } from "@/lib/workspace/workspace";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import { Services } from "@/lib/workspace/services/services";

/**
 * Persist UI document and graph to disk before Dev Mode reads project files.
 */
export async function flushUIDocAndGraphIfDirty(workspace: Workspace): Promise<void> {
    const ctx = workspace.getContext();
    const uid = ctx.services.get<UIDocumentService>(Services.UIDocument);
    const graph = ctx.services.get<UIGraphService>(Services.UIGraph);
    if (uid.isDirty()) {
        await uid.save(uid.getDocument());
    }
    if (graph.isDirty()) {
        await graph.save(graph.getDocument());
    }
}
