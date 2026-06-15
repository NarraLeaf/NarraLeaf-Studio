import { useState, useEffect } from "react";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

export function useDocumentVersion(documentService: UIDocumentService | null): number {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (!documentService) {
            return;
        }
        const unsubscribe = documentService.onDocumentChanged(() => {
            setVersion((prev) => prev + 1);
        });
        return unsubscribe;
    }, [documentService]);

    return version;
}
