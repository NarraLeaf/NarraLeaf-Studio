import type { UIDocument } from "@shared/types/ui-editor/document";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";

type Unsubscribe = () => void;

const emptyDocument: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "runtime-empty-document",
    name: "Runtime Empty Document",
    surfaces: [],
    elements: {},
};

class RuntimeUIDocumentService {
    public static getInstance(): RuntimeUIDocumentService {
        return instance;
    }

    public getDocument(): UIDocument {
        return emptyDocument;
    }

    public updateElementProps(): void {
        /* Preview runtime cannot mutate authored documents through editor services. */
    }

    public clearElementBlueprintValueBinding(): void {
        /* Preview runtime cannot mutate authored documents through editor services. */
    }

    public onDocumentChanged(): Unsubscribe {
        return () => undefined;
    }

    public getRevision(): number {
        return 0;
    }
}

const instance = new RuntimeUIDocumentService();

export { RuntimeUIDocumentService as UIDocumentService };
