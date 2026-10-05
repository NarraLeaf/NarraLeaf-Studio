import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    EMPTY_UI_TEXT_WRITER_INDEX,
    indexUITextWriters,
    type UITextWriterIndex,
} from "@shared/types/ui-editor/textWriters";
import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";

/**
 * The project's writers of interface words (`@shared/types/ui-editor/textWriters`), read from the live
 * blueprint document.
 *
 * Every text and button inspector asks for the same index between two blueprint edits, so it is built
 * once per graph revision. The document is edited in
 * place, so its identity alone cannot tell an edited document from the one indexed - the revision the
 * graph service counts is the other half of the key.
 */
let cached: { document: BlueprintDocument; revision: number; index: UITextWriterIndex } | null = null;

export function readProjectTextWriters(services: ServiceRegistry): UITextWriterIndex {
    let document: BlueprintDocument;
    let revision: number;
    try {
        document = services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument();
        revision = services.get<UIGraphService>(Services.UIGraph).getRevision();
    } catch {
        // No blueprint document yet (a workspace still loading): nothing writes anything.
        return EMPTY_UI_TEXT_WRITER_INDEX;
    }
    if (cached && cached.document === document && cached.revision === revision) {
        return cached.index;
    }
    const index = indexUITextWriters(document);
    cached = { document, revision, index };
    return index;
}
