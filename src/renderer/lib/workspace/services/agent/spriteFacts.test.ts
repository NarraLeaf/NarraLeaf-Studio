import { describe, expect, it } from "vitest";
import { AssetType } from "../assets/assetTypes";
import { Services, type WorkspaceContext } from "../services";
import { CharacterProfile } from "../character/CharacterProfile";
import { Character } from "../character/Character";
import { captureDefaultLook, entranceAfterArtChange } from "./spriteFacts";
import { framedEntrance, standingEntrance } from "./spriteStage";

/**
 * When adding art refits a character's entrance by itself. The tests run in node, where nothing
 * decodes a picture, so every fit here is the unmeasured one - the rules being tested are which
 * defaults get refitted, which are kept, and who is followed.
 */

/** A PNG header that states a size: all `readImageFacts` reads in node. */
function png(width: number, height: number): Uint8Array {
    const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const chunk = (type: string, data: number[]) => [...be(data.length), ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...chunk("IHDR", [...be(width), ...be(height), 8, 6, 0, 0, 0]),
        ...chunk("IDAT", [0]),
        ...chunk("IEND", []),
    ]);
}

const STAGE = { width: 1920, height: 1080 };
const IMAGES: Record<string, { width: number; height: number }> = {
    tall: { width: 1000, height: 2000 },
    tall2: { width: 1000, height: 2000 },
    wide: { width: 1600, height: 1600 },
};

function harness(cast: Character[]) {
    const images = Object.fromEntries(Object.keys(IMAGES).map(id => [id, { id, name: id, type: AssetType.Image }]));
    const services: Record<string, unknown> = {
        [Services.Assets]: {
            getAssets: () => ({ [AssetType.Image]: images }),
            fetch: async (asset: { id: string }) => ({ success: true, data: { data: png(IMAGES[asset.id].width, IMAGES[asset.id].height) } }),
        },
        [Services.Project]: { getProjectConfig: () => ({ metadata: { resolution: STAGE } }) },
        [Services.Character]: { listCharacter: () => cast },
    };
    return { services: { get: (name: string) => services[name] } } as unknown as WorkspaceContext;
}

function character(id: string, art?: string): Character {
    const made = Character.fromJSON({ profile: CharacterProfile.create(id, id, "preset").toJSON() });
    const pose = made.profile.appearance.createPose("normal");
    if (pose && art) made.profile.appearance.setPoseAsset(pose.id, art);
    return made;
}

function giveArt(subject: Character, art: string) {
    const pose = subject.profile.appearance.getPoses()[0];
    subject.profile.appearance.setPoseAsset(pose.id, art);
}

describe("fitting the entrance after art is added", () => {
    it("frames a character's first art", async () => {
        const mio = character("mio");
        const ctx = harness([mio]);
        const before = captureDefaultLook(mio);
        giveArt(mio, "tall");
        expect(await entranceAfterArtChange(ctx, mio, before)).toEqual(framedEntrance(IMAGES.tall, STAGE));
    });

    it("refits defaults Studio fitted to the previous art, keeps an author's", async () => {
        const mio = character("mio", "tall");
        const ctx = harness([mio]);
        for (const fitted of [framedEntrance(IMAGES.tall, STAGE), standingEntrance(IMAGES.tall, STAGE)]) {
            mio.profile.setEntranceTransform(fitted);
            const before = captureDefaultLook(mio);
            giveArt(mio, "wide");
            expect(await entranceAfterArtChange(ctx, mio, before)).toEqual(framedEntrance(IMAGES.wide, STAGE));
            giveArt(mio, "tall");
        }
        mio.profile.setEntranceTransform({ zoom: 0.43, position: { xalign: 0.5, yalign: 0.5, yoffset: -77 } });
        const before = captureDefaultLook(mio);
        giveArt(mio, "wide");
        expect(await entranceAfterArtChange(ctx, mio, before)).toBeUndefined();
    });

    it("follows a cast member whose art is the same size", async () => {
        const tuned = { zoom: 0.62, position: { xalign: 0.5, yalign: 0.5, yoffset: -300 } };
        const aoi = character("aoi", "tall");
        aoi.profile.setEntranceTransform(tuned);
        const mio = character("mio");
        const ctx = harness([aoi, mio]);
        const before = captureDefaultLook(mio);
        giveArt(mio, "tall2");
        expect(await entranceAfterArtChange(ctx, mio, before)).toEqual(tuned);
    });

    it("leaves the defaults when the default look did not change", async () => {
        const mio = character("mio", "tall");
        const ctx = harness([mio]);
        const before = captureDefaultLook(mio);
        mio.profile.appearance.createPose("smile");
        expect(await entranceAfterArtChange(ctx, mio, before)).toBeUndefined();
    });
});
