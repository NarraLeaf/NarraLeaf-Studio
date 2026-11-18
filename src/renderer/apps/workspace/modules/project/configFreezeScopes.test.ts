import { describe, expect, it } from "vitest";
import { appTagsSpec, brandSpec, dlcSpec } from "@shared/documents/specs";
import {
    appTagsDocumentFreezeScope,
    brandDocumentFreezeScope,
    dlcDocumentFreezeScope,
} from "./configFreezeScopes";

describe("the freeze scope each configuration panel names", () => {
    it("is the file its own service saves to, through the document spec", () => {
        // A path written a second time is a path that falls behind the one the service writes: if
        // the two disagree, the panel offers an edit the write boundary refuses.
        expect(appTagsDocumentFreezeScope()).toBe(appTagsSpec.pathFor());
        expect(dlcDocumentFreezeScope()).toBe(dlcSpec.pathFor());
        expect(brandDocumentFreezeScope()).toBe(brandSpec.pathFor());
    });
});
