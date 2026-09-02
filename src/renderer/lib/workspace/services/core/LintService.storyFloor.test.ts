import { describe, expect, it, vi } from "vitest";
import { RELEASE_APP_TAG } from "@shared/types/appTag";
import { STORY_DOCUMENT_MIN_SUPPORTED_VERSION } from "@shared/story/migrateStoryDocument";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { AssetType } from "../assets/assetTypes";
import { ReferenceService } from "../references/ReferenceService";
import { StoryService } from "../story/StoryService";
import { DEFAULT_LINTING_CONFIGURATION, DEFAULT_NETWORK_CONFIGURATION } from "../../project/configuration";
import { Services, type WorkspaceContext } from "../services";
import type { LintReportEntry } from "@/lib/lint/types";
import { LintService } from "./LintService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * What the build says about a project written before the schema floor.
 *
 * A project made by an older Studio keeps its story document at the version it was written at until
 * something edits it, so an author who never touched that story arrives at a new Studio with a
 * document the ladder no longer has steps for. That refusal is deliberate, and the finding is the
 * only place the author meets it: the build stops, names their story, and everything the ladder
 * knew about *why* is three wrappers upstream.
 *
 * It read "骨架 could not be opened (story/invalid-command)" - a sentence that points at the script
 * for a failure the script has nothing to do with. The chain asserted here is three links long and
 * a break in any of them puts that sentence back: the ladder has to throw the versions as values,
 * `RendererError` has to carry the cause through `loadStory`, and the sweep has to look for it. So
 * this drives the real `StoryService` rather than a stand-in that throws what it likes.
 */

const STORY_ID = "71bb159f-1322-4539-b09f-9593a426a67d";

/** The oldest shape this repository has produced that a real project is still holding: v17. */
function belowFloorDocument() {
    return {
        schemaVersion: 17,
        id: STORY_ID,
        name: "Skeleton",
        chapters: [],
        scenes: {},
        meta: { createdAt: "2026-08-07T04:03:28.336Z", updatedAt: "2026-08-07T04:03:28.336Z" },
    };
}

/** A real `StoryService` holding one library entry, over a filesystem that answers one document. */
function storyServiceReading(readJSON: () => Promise<unknown>): StoryService {
    const service = new StoryService();
    const context = {
        project: {
            resolve: (...parts: (string | string[])[]) =>
                parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/").replace(/\/+/g, "/"),
        },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.FileSystem:
                        return { readJSON };
                    case Services.Assets:
                        return { lockAsset: vi.fn(), unlockAsset: vi.fn() };
                    default:
                        return {};
                }
            },
        },
    } as unknown as WorkspaceContext;
    service.setContext(context);
    (service as unknown as { index: unknown }).index = {
        schemaVersion: 1,
        stories: [{
            id: STORY_ID,
            name: "Skeleton",
            documentPath: `editor/story/stories/${STORY_ID}/storydoc.json`,
            createdAt: "2026-08-07T04:03:28.336Z",
            updatedAt: "2026-08-07T04:03:28.336Z",
        }],
        meta: {},
    };
    return service;
}

/** A `LintService` whose story service is the real one above; every other service is a stand-in. */
function mount(storyService: StoryService): LintService {
    const referenceService = new ReferenceService();
    (referenceService as unknown as { indexCache: Map<string, unknown> }).indexCache = new Map<string, unknown>();
    vi.spyOn(referenceService, "ensureReady").mockResolvedValue(undefined);

    const ctx = {
        // Variadic, and answering the project root for no arguments at all, because that is what
        // the real one does - the sweep asks for the root that way to settle whether the project is
        // trusted before it probes any media.
        project: { resolve: (...parts: (string[] | string)[]) => ["/project", ...parts.flat()].join("/") },
        services: {
            get: (id: Services) => {
                switch (id) {
                    case Services.Project:
                        return {
                            getLintingConfiguration: () => ({ ...DEFAULT_LINTING_CONFIGURATION }),
                            getNetworkConfiguration: () => ({ ...DEFAULT_NETWORK_CONFIGURATION }),
                            getProjectConfig: () => ({}),
                        };
                    case Services.Story:
                        return storyService;
                    case Services.Assets:
                        return { getAssets: () => ({ [AssetType.Image]: {} }) };
                    case Services.Reference:
                        return referenceService;
                    case Services.Character:
                        return { listCharacter: () => [] };
                    case Services.AppTags:
                        return { listTags: () => [RELEASE_APP_TAG], listDeclaredExternalLinks: () => [] };
                    case Services.Dlc:
                        return { list: () => [] };
                    case Services.VariableRegistry:
                        return { listEntries: () => [], listEntriesInScope: () => [] };
                    case Services.Localization:
                        return { getConfiguration: () => ({ sourceLocale: "en", locales: [] }) };
                    case Services.Voice:
                        return { getConfiguration: () => ({ voicedLocales: [] }) };
                    case Services.UIDocument:
                        return { getDocument: () => null };
                    case Services.UIGraph:
                        return { getDocument: () => ({ blueprintDocument: null }) };
                    default:
                        throw new Error(`Unexpected service lookup: ${String(id)}`);
                }
            },
        },
    } as unknown as WorkspaceContext;

    const service = new LintService();
    service.setContext(ctx);
    return service;
}

async function findingsFor(readJSON: () => Promise<unknown>): Promise<LintReportEntry[]> {
    const service = mount(storyServiceReading(readJSON));
    await service.buildContext();
    return (service as unknown as { contextFindings: LintReportEntry[] }).contextFindings;
}

describe("LintService and the story schema ladder", () => {
    it("names both versions when a document is older than the floor", async () => {
        const findings = await findingsFor(async () => ({ ok: true, data: belowFloorDocument() }));

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.message.storyTooOld");
        // The document's own version and the oldest that opens - the pair the author needs to tell
        // "this project predates this Studio" from "I broke my script". A finding carrying only the
        // story's name says the second thing about the first situation.
        expect(findings[0].messageParams).toEqual({
            story: "Skeleton",
            version: 17,
            minimum: STORY_DOCUMENT_MIN_SUPPORTED_VERSION,
        });
        expect(findings[0].severity).toBe("error");
    });

    it("names both versions when a document is newer than this build", async () => {
        const findings = await findingsFor(async () => ({
            ok: true,
            data: { ...belowFloorDocument(), schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION + 2 },
        }));

        expect(findings).toHaveLength(1);
        // Its own line rather than the too-old one reworded. The two situations ask opposite things
        // of the author, and a document from the future is the one where reading it would be worse
        // than refusing: every field this build has not heard of would be gone on the next save.
        expect(findings[0].messageKey).toBe("lint.message.storyTooNew");
        expect(findings[0].messageParams).toEqual({
            story: "Skeleton",
            version: STORY_DOCUMENT_SCHEMA_VERSION + 2,
            supported: STORY_DOCUMENT_SCHEMA_VERSION,
        });
        expect(findings[0].severity).toBe("error");
    });

    it("opens a document at the current version without a finding", async () => {
        const findings = await findingsFor(async () => ({
            ok: true,
            data: { ...belowFloorDocument(), schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION },
        }));

        expect(findings).toEqual([]);
    });

    it("keeps the general wording for a failure that is not about the version", async () => {
        const findings = await findingsFor(async () => ({
            ok: false,
            error: { message: "Unexpected token } in JSON at position 41273", code: "EPARSE" },
        }));

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.message.storyLoadFailed");
        expect(findings[0].messageParams).toEqual({ story: "Skeleton" });
    });
});
