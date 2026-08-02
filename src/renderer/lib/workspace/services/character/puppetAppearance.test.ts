import { describe, expect, it } from "vitest";
import { CharacterAppearance, emptyAppearance } from "./CharacterAppearance";
import { migrateCharacterStore } from "./migrateAppearance";
import type { PuppetAppearance } from "./types";
import { KNOWN_PUPPET_RUNTIME_IDS, knownPuppetRuntime } from "@shared/utils/puppetRuntimes";

function puppet(overrides: Partial<PuppetAppearance> = {}): PuppetAppearance {
    return {
        kind: "puppet",
        assetId: "asset-model",
        backend: "some-runtime",
        entry: null,
        size: { width: 700, height: 900 },
        options: { scale: 0.5 },
        ...overrides,
    };
}

describe("puppet appearance", () => {
    it("round-trips through the store clone", () => {
        const appearance = new CharacterAppearance(puppet());
        expect(appearance.toJSON()).toEqual(puppet());
    });

    it("survives the store migration", () => {
        // The migration reads an unrecognised kind as the *pre-rework* store and rewrites it, so a
        // kind it does not know is deleted rather than ignored. This is the guard for that.
        const store = [{ profile: { name: "Doll", appearance: puppet() } }];
        const report = migrateCharacterStore(store);
        expect(report.migrated).toBe(0);
        expect(store[0].profile.appearance).toEqual(puppet());
    });

    it("starts empty and is not silently sourced", () => {
        expect(emptyAppearance("puppet")).toEqual({
            kind: "puppet",
            assetId: null,
            backend: "",
            entry: null,
            size: null,
            options: {},
        });
    });

    /**
     * The named kinds are the same shape as `puppet` and have to travel the same two paths — the
     * clone (which is a field-by-field whitelist, so a kind it does not carry through is *retyped* on
     * the next save) and the migration (which deletes what it does not recognise). Both failures are
     * silent, which is why each named kind is asserted rather than the generic one standing in.
     */
    describe.each(KNOWN_PUPPET_RUNTIME_IDS)("%s appearance", kind => {
        it("keeps its own kind through the store clone", () => {
            const appearance = new CharacterAppearance(puppet({ kind }));
            expect(appearance.toJSON()).toEqual(puppet({ kind }));
            expect(appearance.getKind()).toBe(kind);
            // Same arm as `puppet`: the runtime cannot tell the three apart, so everything below the
            // kind has to behave identically.
            expect(appearance.getPuppet()).not.toBeNull();
            expect(appearance.listAssetIds()).toEqual(["asset-model"]);
            expect(appearance.resolveDrawList({})).toEqual([]);
        });

        it("survives the store migration", () => {
            const store = [{ profile: { name: "Doll", appearance: puppet({ kind }) } }];
            const report = migrateCharacterStore(store);
            expect(report.migrated).toBe(0);
            expect(store[0].profile.appearance).toEqual(puppet({ kind }));
        });

        it("starts pointed at the runtime it was created for", () => {
            // The author picked a product from the menu; making them then type its folder name is the
            // gap this fills. `puppet` has no name to guess and still starts empty (asserted above).
            expect(emptyAppearance(kind)).toEqual({
                kind,
                assetId: null,
                backend: knownPuppetRuntime(kind).backend,
                entry: null,
                size: null,
                options: {},
            });
        });
    });

    it("degrades a malformed box to the stage default rather than collapsing the element", () => {
        const appearance = new CharacterAppearance(puppet({ size: { width: 0, height: 900 } }));
        expect((appearance.toJSON() as PuppetAppearance).size).toBeNull();
        appearance.setPuppetSize({ width: -1, height: 10 });
        expect(appearance.getPuppet()?.size).toBeNull();
    });

    it("locks the model asset like any other reference", () => {
        expect(new CharacterAppearance(puppet()).listAssetIds()).toEqual(["asset-model"]);
        expect(new CharacterAppearance(puppet({ assetId: null })).listAssetIds()).toEqual([]);
    });

    it("draws no images and carries no differential avatars", () => {
        const appearance = new CharacterAppearance(puppet());
        expect(appearance.resolveDrawList({})).toEqual([]);
        appearance.setAvatar("anything", { overrideAssetId: "asset-avatar" });
        expect(appearance.getAvatars()).toEqual({});
    });

    it("carries no resting pose until the author sets one", () => {
        const appearance = new CharacterAppearance(puppet());
        expect(appearance.getPuppetDefaultState()).toEqual({ motion: null, expression: null, skin: null });
        // Absent rather than a triple of nulls, so a character that never had one adds nothing to
        // the store.
        expect(appearance.toJSON()).not.toHaveProperty("defaultState");
    });

    it("keeps a resting pose through the store clone", () => {
        const appearance = new CharacterAppearance(puppet());
        appearance.setPuppetDefaultState("motion", "walk");
        appearance.setPuppetDefaultState("skin", "winter");

        expect(appearance.getPuppetDefaultState())
            .toEqual({ motion: "walk", expression: null, skin: "winter" });
        expect(appearance.toJSON()).toEqual(puppet({
            defaultState: { motion: "walk", expression: null, skin: "winter" },
        }));
    });

    it("clears a field back to nothing, which is a state and not a missing value", () => {
        const appearance = new CharacterAppearance(puppet({
            defaultState: { motion: "walk", expression: null, skin: null },
        }));
        appearance.setPuppetDefaultState("motion", "");

        expect(appearance.getPuppetDefaultState().motion).toBeNull();
        expect(appearance.toJSON()).not.toHaveProperty("defaultState");
    });

    it("does not read a resting pose off a malformed store", () => {
        const appearance = new CharacterAppearance(puppet({
            defaultState: { motion: 7, expression: "  ", skin: null } as never,
        }));
        expect(appearance.getPuppetDefaultState()).toEqual({ motion: null, expression: null, skin: null });
    });

    it("cold-switches away from a puppet the way the other kinds do", () => {
        const released: (string | null)[] = [];
        const appearance = new CharacterAppearance(puppet());
        appearance.setOnAssetChange(oldId => released.push(oldId));
        appearance.setKind("preset");
        expect(released).toEqual(["asset-model"]);
        expect(appearance.getKind()).toBe("preset");
        expect(appearance.getPuppet()).toBeNull();
    });
});
