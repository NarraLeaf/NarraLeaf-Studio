// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StoryActionPayload } from "@shared/types/story";
import type { CharacterAppearanceKind } from "@shared/utils/characterAppearanceKinds";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import type { PuppetDescriptionRequest } from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import { CharacterActionEditor } from "./StorySceneActionInspector";

/**
 * The inspector for a puppet state row, for each kind of character a runtime draws.
 *
 * A Live2D character's kind is `live2d` and a Spine one's `spine`; only a runtime the author wrote
 * is `puppet`. The inspector used to ask `getKind() === "puppet"`, so for a Live2D character the
 * `/motion` row's inspector said she was drawn by Studio and had no runtime state, and never asked
 * her model what motions it has. Rendered as markup so no workspace has to be mounted: the model's
 * answer comes from a stub of `usePuppetDescription`, and the select is drawn as a plain `<select>`
 * so its options are in the markup.
 */

const MOTIONS = ["Idle_0", "Idle_6", "TapBody_0"];

const asked: (PuppetDescriptionRequest | null)[] = [];

vi.mock("@/lib/workspace/hooks/usePuppetDescription", async importOriginal => {
    const actual = await importOriginal<typeof import("@/lib/workspace/hooks/usePuppetDescription")>();
    return {
        ...actual,
        usePuppetDescription: (request: PuppetDescriptionRequest | null) => {
            asked.push(request);
            return {
                result: request
                    ? {
                        status: "ok",
                        description: {
                            motions: MOTIONS,
                            expressions: [],
                            skins: [],
                            params: [{ id: "ParamAngleX", min: -30, max: 30, default: 0 }],
                            size: null,
                        },
                        origin: "memory",
                        fingerprint: "test",
                    }
                    : null,
                loading: false,
                refresh: () => undefined,
            };
        },
    };
});

vi.mock("@/apps/workspace/modules/characters/editors/components/PuppetPreview", () => ({
    PuppetPreview: () => null,
}));

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/i18n")>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/components/elements", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/components/elements")>()),
    Select: (props: { options: { value: string | number; label: string }[]; value: string | number }) => (
        <select value={String(props.value)} onChange={() => undefined}>
            {props.options.map(option => (
                <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
            ))}
        </select>
    ),
}));

function characterOf(kind: CharacterAppearanceKind): Character {
    const profile = CharacterProfile.create("hiyori", "Hiyori", kind);
    profile.appearance.setPuppetAsset("model-hiyori");
    profile.appearance.setPuppetBackend("live2d");
    return Character.fromJSON({ profile: profile.toJSON() });
}

function markupFor(kind: CharacterAppearanceKind, payload: Extract<StoryActionPayload, { action: "character" }>): string {
    asked.length = 0;
    return renderToStaticMarkup(
        <CharacterActionEditor
            payload={payload}
            storyId="story-1"
            sceneId="scene-1"
            blockId="block-1"
            storyName="Story"
            characters={[characterOf(kind)]}
            onChange={() => undefined}
        />,
    );
}

describe("a puppet state row's inspector", () => {
    for (const kind of ["live2d", "spine", "puppet"] as const) {
        it(`offers the model's motions for a ${kind} character`, () => {
            const markup = markupFor(kind, { action: "character", operation: "setMotion", characterId: "hiyori" });
            expect(markup).not.toContain("storyInspector.character.notPuppetHint");
            for (const motion of MOTIONS) {
                expect(markup).toContain(`<option value="${motion}">${motion}</option>`);
            }
            expect(asked).toContainEqual(expect.objectContaining({ assetId: "model-hiyori", backend: "live2d" }));
        });

        it(`offers the model's parameters for a ${kind} character`, () => {
            const markup = markupFor(kind, { action: "character", operation: "setParams", characterId: "hiyori", params: {} });
            expect(markup).not.toContain("storyInspector.character.notPuppetHint");
            expect(markup).toContain("storyInspector.character.puppetParams");
            expect(asked).toContainEqual(expect.objectContaining({ assetId: "model-hiyori", backend: "live2d" }));
        });
    }

    it("still says a character Studio draws itself has no runtime state", () => {
        for (const kind of ["preset", "layered"] as const) {
            const markup = markupFor(kind, { action: "character", operation: "setMotion", characterId: "hiyori" });
            expect(markup).toContain("storyInspector.character.notPuppetHint");
            expect(markup).not.toContain("<option value=\"Idle_0\">");
        }
    });
});
