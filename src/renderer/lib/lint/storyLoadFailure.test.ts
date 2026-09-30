import { describe, expect, it } from "vitest";
import {
    STORY_DOCUMENT_MIN_SUPPORTED_VERSION,
    StoryDocumentTooNewError,
    StoryDocumentTooOldError,
} from "@shared/story/migrateStoryDocument";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { storyUnreadableFinding } from "./storyLoadFailure";

/**
 * A story that would not open, as lint reports it.
 *
 * The id is the assertion worth making: this is not a row the compiler refused, and reporting it as
 * one told an author to go looking in their own script for a document their Studio is simply too new
 * to read. `story/unreadable` has no rule behind it, so there is nothing to configure and the
 * severity is fixed.
 */

const STORY = { id: "story-1", name: "First Day" };

describe("storyUnreadableFinding", () => {
    it("is an error under an id no rule owns", () => {
        const finding = storyUnreadableFinding(STORY, new Error("truncated"));
        expect(finding.ruleId).toBe("story/unreadable");
        expect(finding.severity).toBe("error");
        expect(finding.location).toEqual({ kind: "story", storyId: "story-1", storyName: "First Day" });
    });

    it("names both versions for a document below the floor", () => {
        const below = STORY_DOCUMENT_MIN_SUPPORTED_VERSION - 1;
        const finding = storyUnreadableFinding(
            STORY,
            new StoryDocumentTooOldError(below, STORY_DOCUMENT_MIN_SUPPORTED_VERSION),
        );
        expect(finding.messageKey).toBe("lint.message.storyTooOld");
        expect(finding.messageParams).toEqual({
            story: "First Day",
            version: below,
            minimum: STORY_DOCUMENT_MIN_SUPPORTED_VERSION,
        });
    });

    it("finds the ladder's refusal however many times it was rewrapped", () => {
        // Every reader between the ladder and a surface re-throws, and what survives the rewrap is
        // the `cause` chain rather than the sentence.
        const ahead = STORY_DOCUMENT_SCHEMA_VERSION + 1;
        const wrapped = new Error("could not read storydoc.json", {
            cause: new Error("migration failed", {
                cause: new StoryDocumentTooNewError(ahead, STORY_DOCUMENT_SCHEMA_VERSION),
            }),
        });
        const finding = storyUnreadableFinding(STORY, wrapped);
        expect(finding.messageKey).toBe("lint.message.storyTooNew");
        expect(finding.messageParams).toEqual({
            story: "First Day",
            version: ahead,
            supported: STORY_DOCUMENT_SCHEMA_VERSION,
        });
    });

    it("falls back to the generic line where there is no version to name", () => {
        const finding = storyUnreadableFinding(STORY, new Error("Unexpected token < in JSON"));
        expect(finding.messageKey).toBe("lint.message.storyLoadFailed");
        expect(finding.messageParams).toEqual({ story: "First Day" });
    });
});
