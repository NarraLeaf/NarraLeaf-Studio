import { describe, expect, it } from "vitest";
import {
    localizationDocumentSpec,
    localizationKeysSpec,
    variableRegistrySpec,
    voiceDocumentSpec,
} from "@shared/documents/specs";
import { ProjectNameConvention } from "../../project/nameConvention";

/**
 * The specs live in `@shared/documents` and spell their paths as literal patterns, because the main
 * process has to resolve a changed file to a document without importing anything from the renderer.
 * `ProjectNameConvention` is the renderer's copy of the same layout. This is the only place that can
 * see both, so it is the only place that can notice them drifting - and drift here means a document
 * saved to a path version control does not recognise, which is silent.
 */
describe("document specs agree with ProjectNameConvention", () => {
    const of = (segments: readonly string[]) => segments.join("/");

    it("puts every adopted document where the convention says it goes", () => {
        expect(variableRegistrySpec.pathFor()).toBe(of(ProjectNameConvention.EditorVariableRegistry));
        expect(voiceDocumentSpec.pathFor({ locale: "ja" })).toBe(of(ProjectNameConvention.EditorVoiceDocument("ja")));
        expect(localizationDocumentSpec.pathFor({ locale: "zh-CN" }))
            .toBe(of(ProjectNameConvention.EditorLocalizationDocument("zh-CN")));
        expect(localizationKeysSpec.pathFor()).toBe(of(ProjectNameConvention.EditorLocalizationKeys));
    });
});
