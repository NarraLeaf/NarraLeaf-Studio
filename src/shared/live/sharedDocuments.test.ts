import { describe, expect, it } from "vitest";
import {
    assetGroupsSpec,
    assetSetsSpec,
    assetsMetadataSpec,
    audioTracksSpec,
    charactersSpec,
    dictionarySpec,
    localizationDocumentSpec,
    localizationKeysSpec,
    storyDocumentSpec,
    variableRegistrySpec,
    voiceDocumentSpec,
} from "@shared/documents/specs";
import { isVersioned } from "@shared/vcs/workingSet";
import { opDocumentKind, type LiveOp } from "./ops";
import {
    liveDocumentPath,
    liveSessionCarries,
    liveSessionDocuments,
    liveSessionWritablePaths,
    type LiveSessionLocales,
    type LiveSessionRegistries,
} from "./sharedDocuments";

const STORY = "story-1";
const LOCALES: LiveSessionLocales = { translations: ["ja", "fr"], voice: ["ja"] };
const ASSET_TYPES = ["image", "audio"];
const ASSET_CATEGORIES = ["image", "media"];
const REGISTRIES: LiveSessionRegistries = { variables: true, localizationKeys: true };

/**
 * The three tables a session always carries.
 *
 * Unparameterised with the cast, so they need nothing from the caller and appear in every answer -
 * which is what the expectations below spell out rather than filter away.
 */
const TABLES = [{ doc: "dictionary" }, { doc: "audio-tracks" }, { doc: "asset-sets" }];

/**
 * The one table two things read: the write boundary, which asks which paths a session leaves
 * writable, and the host, which asks whether an operation is about a document it speaks for.
 *
 * The failure these guard is the pair disagreeing. A path the boundary allows that the vocabulary
 * cannot carry is an edit that lands on one machine and nowhere else, with no digest over it and
 * nothing anywhere reporting a problem.
 */
describe("the documents a session carries", () => {
    it("is every story in the project, the cast, and each language's two libraries", () => {
        expect(liveSessionDocuments([STORY]))
            .toEqual([{ doc: "story", storyId: STORY }, { doc: "characters" }, ...TABLES]);
        expect(liveSessionDocuments([STORY, "story-2"], LOCALES)).toEqual([
            { doc: "story", storyId: STORY },
            { doc: "story", storyId: "story-2" },
            { doc: "characters" },
            { doc: "localization", locale: "ja" },
            { doc: "localization", locale: "fr" },
            { doc: "voice", locale: "ja" },
            ...TABLES,
        ]);
    });

    it("takes the two lists apart, because the two are configured apart", () => {
        // A project can be translated into a language nobody records voice for, which is the ordinary
        // case rather than an edge one: recording is expensive and translating is not.
        expect(liveSessionDocuments([], { translations: ["fr"], voice: [] })).toEqual([
            { doc: "characters" },
            { doc: "localization", locale: "fr" },
            ...TABLES,
        ]);
    });

    it("adds the asset library's metadata shards per type, and its folder shards per section", () => {
        // Two axes, not one: a folder under Media holds audio and video alike, so it cannot belong
        // to either type's shard.
        expect(liveSessionDocuments([], { translations: [], voice: [] }, ASSET_TYPES, ASSET_CATEGORIES)).toEqual([
            { doc: "characters" },
            { doc: "assets", assetType: "image" },
            { doc: "assets", assetType: "audio" },
            { doc: "asset-groups", category: "image" },
            { doc: "asset-groups", category: "media" },
            ...TABLES,
        ]);
    });

    it("addresses each one through its own document spec, so a document that moves takes this with it", () => {
        expect(liveDocumentPath({ doc: "story", storyId: STORY })).toBe(storyDocumentSpec.pathFor({ storyId: STORY }));
        expect(liveDocumentPath({ doc: "characters" })).toBe(charactersSpec.pathFor());
        expect(liveDocumentPath({ doc: "localization", locale: "ja" }))
            .toBe(localizationDocumentSpec.pathFor({ locale: "ja" }));
        expect(liveDocumentPath({ doc: "voice", locale: "ja" })).toBe(voiceDocumentSpec.pathFor({ locale: "ja" }));
        expect(liveDocumentPath({ doc: "assets", assetType: "image" }))
            .toBe(assetsMetadataSpec.pathFor({ type: "image" }));
        expect(liveDocumentPath({ doc: "asset-groups", category: "media" }))
            .toBe(assetGroupsSpec.pathFor({ category: "media" }));
        expect(liveDocumentPath({ doc: "dictionary" })).toBe(dictionarySpec.pathFor());
        expect(liveDocumentPath({ doc: "audio-tracks" })).toBe(audioTracksSpec.pathFor());
        expect(liveDocumentPath({ doc: "asset-sets" })).toBe(assetSetsSpec.pathFor());
    });

    it("names paths the repository actually stores, or the freeze would be exempting nothing", () => {
        for (const path of liveSessionWritablePaths([STORY], LOCALES, ASSET_TYPES, ASSET_CATEGORIES)) {
            expect(isVersioned(path)).toBe(true);
        }
    });

    it("carries what it was given, and nothing it was not", () => {
        // ⚠ Compared against the set rather than assumed. A story created DURING a session is in
        // nobody else's copy - the room agreed a revision on the way in - so an operation about it
        // would be one the others could not apply, and the boundary must not be allowing writes to
        // a document the host would refuse.
        expect(liveSessionCarries([STORY, "story-2"], { doc: "story", storyId: "story-2" })).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "story", storyId: "story-2" })).toBe(false);
        expect(liveSessionCarries([STORY], { doc: "characters" })).toBe(true);
    });

    it("carries a language by name, never a kind, so an unread library is not writable", () => {
        // The trap this file exists to keep shut, one document along: widening to "every path of
        // every shared kind" would leave the French library writable while the host refused every
        // operation about it - a translation that lands here and nowhere else, with no digest over
        // it. A language a machine could not read is one no effect can ever reach.
        expect(liveSessionCarries([STORY], { doc: "localization", locale: "ja" }, LOCALES)).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "localization", locale: "de" }, LOCALES)).toBe(false);
        // And a language translated but not voiced is carried on one side only.
        expect(liveSessionCarries([STORY], { doc: "localization", locale: "fr" }, LOCALES)).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "voice", locale: "fr" }, LOCALES)).toBe(false);
    });

    it("carries an asset type by name, so a shard nothing read is not writable", () => {
        // The locale rule one document along, and it matters for the same reason: a shard this
        // machine never loaded is one no effect can be applied to, because appliers are synchronous.
        expect(liveSessionCarries([STORY], { doc: "assets", assetType: "image" }, LOCALES, ASSET_TYPES)).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "assets", assetType: "font" }, LOCALES, ASSET_TYPES)).toBe(false);
        expect(liveSessionCarries([STORY], { doc: "assets", assetType: "image" }, LOCALES)).toBe(false);
        expect(liveSessionCarries([STORY], { doc: "asset-groups", category: "media" }, LOCALES, ASSET_TYPES, ASSET_CATEGORIES)).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "asset-groups", category: "font" }, LOCALES, ASSET_TYPES, ASSET_CATEGORIES)).toBe(false);
    });

    it("leaves the payloads and the row order writable without making them addressable", () => {
        // ⚠ The one place "writable" and "addressable" deliberately differ. An asset's bytes are
        // not a document anybody states an operation about - an applier puts them down - and the row
        // order is recomputed by every machine from what it just applied. Both have to be writable
        // and neither may be addressed, which is why neither is a `LiveDocument`.
        const paths = liveSessionWritablePaths([STORY], LOCALES, ASSET_TYPES, ASSET_CATEGORIES);
        expect(paths).toContain("assets/content");
        expect(paths.filter(path => path.includes("assets.order."))).toHaveLength(2);
        expect(paths.filter(path => path.includes("assets.groups."))).toHaveLength(2);
        expect(paths.filter(path => path.includes("assets.metadata."))).toHaveLength(2);

        const addressable = liveSessionDocuments([STORY], LOCALES, ASSET_TYPES, ASSET_CATEGORIES);
        expect(addressable.some(document => liveDocumentPath(document).startsWith("assets/content"))).toBe(false);
        expect(addressable.some(document => liveDocumentPath(document).includes("assets.order."))).toBe(false);
    });

    it("carries no payload path at all for a session with no asset library", () => {
        expect(liveSessionWritablePaths([STORY], LOCALES, ASSET_TYPES)).not.toContain("assets/content");
    });

    it("has a writable path for every document kind the vocabulary can carry, and no others", () => {
        // The invariant, stated as a test: a document is writable during a session exactly when the
        // session can carry its changes. A verb whose document is not here would be an operation the
        // room applies and every machine then fails to save.
        const carried = new Set<string>();
        const verbs: LiveOp[] = [
            { op: "rename-story", name: "x" },
            { op: "create-character", character: { profile: { id: "c" } } as never },
            { op: "set-translation", locale: "ja", unitId: "t", unit: null },
            { op: "set-take", locale: "ja", unitId: "t", unit: null },
            { op: "update-asset", assetType: "image", assetId: "a", record: {} },
            { op: "set-asset-folder", category: "image", folderId: "g", folder: {} },
            { op: "set-dictionary-entry", term: "x", entry: null },
            { op: "create-audio-track", track: { id: "t" } as never, beforeId: null },
            { op: "delete-asset-sets", setIds: ["s"] },
        ];
        for (const op of verbs) {
            carried.add(opDocumentKind(op));
        }
        expect([...carried].sort()).toEqual([
            "asset-groups",
            "asset-sets",
            "assets",
            "audio-tracks",
            "characters",
            "dictionary",
            "localization",
            "story",
            "voice",
        ]);
        // Two stories, the cast, two translation libraries, one voice library, two asset shards,
        // two folder shards and the three project tables - every document the vocabulary can carry -
        // plus the three paths no operation is about: the payload root and the two row orders.
        expect(liveSessionWritablePaths([STORY, "story-2"], LOCALES, ASSET_TYPES, ASSET_CATEGORIES))
            .toHaveLength(13 + 3);
    });

    it("adds the two project-level registries, and only the ones this machine could read", () => {
        // Booleans rather than a list, because neither is parameterised - and read rather than
        // assumed, for the libraries' reason: a registry that would not parse is one no effect can be
        // applied to, and carrying it would leave the boundary allowing writes the host refuses.
        // Beside the three unparameterised project tables, which are always carried.
        expect(liveSessionDocuments([], { translations: [], voice: [] }, [], [], REGISTRIES)).toEqual([
            { doc: "characters" },
            { doc: "dictionary" },
            { doc: "audio-tracks" },
            { doc: "asset-sets" },
            { doc: "variables" },
            { doc: "localization-keys" },
        ]);
        expect(liveSessionDocuments([], { translations: [], voice: [] }, [], [], {
            variables: true,
            localizationKeys: false,
        })).toEqual([
            { doc: "characters" },
            { doc: "dictionary" },
            { doc: "audio-tracks" },
            { doc: "asset-sets" },
            { doc: "variables" },
        ]);
        // Neither, which is what a caller that read neither passes - and the default.
        expect(liveSessionDocuments([STORY]).some(one => one.doc === "variables")).toBe(false);
        expect(liveSessionDocuments([STORY]).some(one => one.doc === "localization-keys")).toBe(false);
    });

    it("puts each registry at the path its own spec owns", () => {
        expect(liveDocumentPath({ doc: "variables" })).toBe(variableRegistrySpec.pathFor());
        expect(liveDocumentPath({ doc: "localization-keys" })).toBe(localizationKeysSpec.pathFor());
        // ⚠ Both are versioned project data, so both really are inside the freeze this widens.
        expect(isVersioned(variableRegistrySpec.pathFor())).toBe(true);
        expect(isVersioned(localizationKeysSpec.pathFor())).toBe(true);
    });

    it("keeps the named-key registry frozen for a session that could not read it", () => {
        // The half of the invariant that stays: a document is writable during a session exactly when
        // the session can carry its changes, and a registry nothing parsed carries nothing.
        expect(liveSessionWritablePaths([STORY], LOCALES).some(path => path.endsWith("keys.json"))).toBe(false);
        expect(liveSessionCarries([STORY], { doc: "localization-keys" }, LOCALES)).toBe(false);
        expect(liveSessionCarries([STORY], { doc: "variables" }, LOCALES)).toBe(false);
        expect(liveSessionCarries([STORY], { doc: "localization-keys" }, LOCALES, [], [], REGISTRIES)).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "variables" }, LOCALES, [], [], REGISTRIES)).toBe(true);
    });

    it("carries the three project tables whatever else it was given", () => {
        // They are one document each per project, so there is nothing to expand and no way for a
        // caller to leave one out - which is the whole reason they take no parameter.
        for (const document of TABLES) {
            expect(liveSessionCarries([], document as never)).toBe(true);
        }
    });
});
