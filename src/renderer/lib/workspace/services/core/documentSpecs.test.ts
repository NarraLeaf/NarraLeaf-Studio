import { describe, expect, it } from "vitest";
import {
    appTagsSpec,
    assetsMetadataSpec,
    audioTracksSpec,
    brandSpec,
    charactersSpec,
    dictionarySpec,
    localizationDocumentSpec,
    localizationKeysSpec,
    storyDocumentSpec,
    uiDocumentSpec,
    uiGraphsSpec,
    variableRegistrySpec,
    voiceDocumentSpec,
} from "@shared/documents/specs";
import { AssetType } from "../assets/assetTypes";
import { ProjectNameConvention } from "../../project/nameConvention";

/**
 * The specs live in `@shared/documents` and spell their paths as literal patterns, because the main
 * process has to resolve a changed file to a document without importing anything from the renderer.
 * `ProjectNameConvention` is the renderer's copy of the same layout. This is the only place that can
 * see both, so it is the only place that can notice them drifting - and drift here means a document
 * saved to a path version control does not recognise, which is silent.
 */
describe("document specs agree with ProjectNameConvention", () => {
    // The convention spells directories with a trailing slash (`"services/"`), which `project.resolve`
    // absorbs and a pattern must not carry.
    const of = (segments: readonly string[]) => segments.map(segment => segment.replace(/\/$/, "")).join("/");

    it("puts every adopted document where the convention says it goes", () => {
        expect(variableRegistrySpec.pathFor()).toBe(of(ProjectNameConvention.EditorVariableRegistry));
        expect(audioTracksSpec.pathFor()).toBe(of(ProjectNameConvention.EditorAudioTracks));
        expect(appTagsSpec.pathFor()).toBe(of(ProjectNameConvention.EditorAppTags));
        expect(brandSpec.pathFor()).toBe(of(ProjectNameConvention.EditorBrand));
        expect(dictionarySpec.pathFor()).toBe(of(ProjectNameConvention.EditorDictionary));
        expect(voiceDocumentSpec.pathFor({ locale: "ja" })).toBe(of(ProjectNameConvention.EditorVoiceDocument("ja")));
        expect(localizationDocumentSpec.pathFor({ locale: "zh-CN" }))
            .toBe(of(ProjectNameConvention.EditorLocalizationDocument("zh-CN")));
        expect(localizationKeysSpec.pathFor()).toBe(of(ProjectNameConvention.EditorLocalizationKeys));
    });

    /**
     * The wave-2 three. `characters` is read and written through its spec like the five above; the
     * story and asset shards are read-side only (their `serialize` throws by design), but their
     * PATHS still have to be the ones the services write to - a diff that resolves the wrong path
     * finds no spec and degrades to a generic JSON walk, silently.
     */
    it("puts the wave-2 documents where the convention says they go", () => {
        expect(charactersSpec.pathFor()).toBe(of([...ProjectNameConvention.EditorServices, "character.json"]));
        expect(storyDocumentSpec.pathFor({ storyId: "abc" }))
            .toBe(of(ProjectNameConvention.EditorStoryDocument("abc")));
        expect(assetsMetadataSpec.pathFor({ type: AssetType.Image }))
            .toBe(of(ProjectNameConvention.AssetsMetadataShard(AssetType.Image)));
    });

    /**
     * The two interface documents, read-side only like the story and the asset shards. The path is
     * the whole of what has to agree here: get it wrong and version control finds no spec, degrades
     * to a JSON walk over a document made of generated ids, and says so nowhere.
     */
    it("puts the interface documents where the convention says they go", () => {
        expect(uiDocumentSpec.pathFor()).toBe(of(ProjectNameConvention.EditorUIDocument));
        expect(uiGraphsSpec.pathFor()).toBe(of(ProjectNameConvention.EditorUIGraphs));
    });

    /** Every asset type resolves to a shard the spec claims - `other` and `blueprint` included. */
    it("claims every asset type's metadata shard", () => {
        for (const type of Object.values(AssetType)) {
            expect(assetsMetadataSpec.matches(of(ProjectNameConvention.AssetsMetadataShard(type))), type).toBe(true);
        }
    });
});
