import { describe, expect, it, vi } from "vitest";
import { ensureNormalizedLayout } from "./utils";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

describe("interaction utils", () => {
    it("normalizes negative layout dimensions without recording history", () => {
        const updateElementLayout = vi.fn();
        const documentService = { updateElementLayout } as unknown as UIDocumentService;

        const normalized = ensureNormalizedLayout(
            "image-1",
            { x: 20, y: 30, width: -100, height: 50 },
            documentService,
        );

        expect(normalized).toEqual({ x: -80, y: 30, width: 100, height: 50 });
        expect(updateElementLayout).toHaveBeenCalledWith(
            "image-1",
            { x: -80, y: 30, width: 100, height: 50 },
            { skipHistory: true },
        );
    });
});
