import { describe, expect, it } from "vitest";
import {
  collectReferencedAssetIds,
  collectTextIds,
  isSceneIndependentUnitId,
  restrictCharacterUnits,
  restrictLocalizationToTextIds,
  restrictRecordToAssetIds,
  restrictVoiceToTextIds
} from "./variantPayload";
import type { GameLocalizationBundle } from "@shared/types/localization";
import type { GameVoiceBundle } from "@shared/types/voice";

const KEPT = "11111111-1111-4111-8111-111111111111";
const DROPPED = "22222222-2222-4222-8222-222222222222";
const UNUSED = "33333333-3333-4333-8333-333333333333";

describe("collectTextIds", () => {
  it("finds every textId at any depth", () => {
    const documents = {
      story: {
        scenes: {
          a: { blocks: { b1: { payload: { text: { textId: "t1", value: "hi" } } } } },
          b: { blocks: { b2: { payload: { options: [{ text: { textId: "t2" } }] } } } }
        }
      }
    };
    expect(collectTextIds(documents)).toEqual(new Set(["t1", "t2"]));
  });

  it("ignores blank and non-string values", () => {
    expect(collectTextIds({ textId: "" })).toEqual(new Set());
    expect(collectTextIds({ textId: 5 })).toEqual(new Set());
    expect(collectTextIds(null)).toEqual(new Set());
  });
});

describe("isSceneIndependentUnitId", () => {
  it("recognises the three namespaces no scene owns", () => {
    expect(isSceneIndependentUnitId("ui:panel.title")).toBe(true);
    expect(isSceneIndependentUnitId("char:alice")).toBe(true);
    expect(isSceneIndependentUnitId("key:menu.start")).toBe(true);
    expect(isSceneIndependentUnitId("t1")).toBe(false);
  });
});

describe("restrictLocalizationToTextIds", () => {
  const bundle: GameLocalizationBundle = {
    sourceLocale: "en",
    locales: [
      { code: "en", displayName: "English" },
      { code: "zh-CN", displayName: "中文" }
    ],
    tables: {
      "zh-CN": {
        kept: "留下",
        dropped: "拿走",
        "ui:a.text": "界面",
        "char:c": "角色",
        "key:k": "键"
      }
    },
    keys: { k: "source" }
  };

  it("keeps shipped rows and every scene-independent unit", () => {
    const result = restrictLocalizationToTextIds(bundle, new Set(["kept"]));
    expect(result.bundle.tables["zh-CN"]).toEqual({
      kept: "留下",
      "ui:a.text": "界面",
      "char:c": "角色",
      "key:k": "键"
    });
    expect(result.removedUnitCount).toBe(1);
  });

  it("drops a locale that has nothing left rather than shipping an empty table", () => {
    const result = restrictLocalizationToTextIds(
      { ...bundle, tables: { "zh-CN": { dropped: "拿走" } } },
      new Set(["kept"])
    );
    expect(result.bundle.tables).toEqual({});
  });

  it("leaves the source text of named keys alone", () => {
    expect(restrictLocalizationToTextIds(bundle, new Set()).bundle.keys).toEqual({ k: "source" });
  });
});

describe("restrictVoiceToTextIds", () => {
  it("drops recordings whose row is gone, prefixes included", () => {
    const bundle: GameVoiceBundle = {
      voicedLocales: [{ code: "ja", displayName: "日本語" }],
      tables: { ja: { kept: KEPT, dropped: DROPPED, "ui:a.text": UNUSED } }
    };
    const result = restrictVoiceToTextIds(bundle, new Set(["kept"]));
    expect(result.bundle.tables.ja).toEqual({ kept: KEPT });
    expect(result.removedUnitCount).toBe(2);
  });
});

describe("collectReferencedAssetIds", () => {
  const library = new Set([KEPT, DROPPED, UNUSED]);

  it("finds an id wherever it occurs, including inside a longer string", () => {
    const payload = {
      scene: { background: KEPT },
      widget: { imageUrl: `nlgame://asset/${DROPPED}?v=3` }
    };
    expect(collectReferencedAssetIds(payload, library)).toEqual(new Set([KEPT, DROPPED]));
  });

  it("answers nothing for an id the library does not have", () => {
    expect(
      collectReferencedAssetIds({ a: "44444444-4444-4444-4444-444444444444" }, library)
    ).toEqual(new Set());
  });

  it("matches an id written in upper case", () => {
    expect(collectReferencedAssetIds({ a: KEPT.toUpperCase() }, library)).toEqual(new Set([KEPT]));
  });

  it("finds the asset id half of a model bundle path", () => {
    expect(collectReferencedAssetIds({ a: `${KEPT}/motions/idle.motion3.json` }, library)).toEqual(
      new Set([KEPT])
    );
  });

  it("answers nothing when the library is empty", () => {
    expect(collectReferencedAssetIds({ a: KEPT }, new Set())).toEqual(new Set());
  });
});

describe("restrictRecordToAssetIds", () => {
  it("keeps only shipped keys", () => {
    const result = restrictRecordToAssetIds({ [KEPT]: "a", [DROPPED]: "b" }, new Set([KEPT]));
    expect(result.record).toEqual({ [KEPT]: "a" });
    expect(result.removedCount).toBe(1);
  });
});

/**
 * A character's display name survives the scene drop by construction - it belongs to a character,
 * not to a row - so an edition that stopped shipping the character shipped the name anyway, in every
 * language. The name is usually the spoiler that got the character dropped.
 */
describe("restrictCharacterUnits", () => {
  const bundle = (): GameLocalizationBundle =>
    ({
      sourceLocale: "en",
      locales: ["en", "ja"],
      tables: {
        en: { [`char:${KEPT}`]: "Ren", [`char:${DROPPED}`]: "The Traitor", "ui:title": "Play" },
        ja: { [`char:${DROPPED}`]: "裏切り者", "story-row": "…" }
      }
    }) as unknown as GameLocalizationBundle;

  it("drops the names of characters that do not ship, in every language", () => {
    const result = restrictCharacterUnits(bundle(), new Set([KEPT]));

    expect(result.bundle.tables.en).toEqual({ [`char:${KEPT}`]: "Ren", "ui:title": "Play" });
    expect(result.bundle.tables.ja).toEqual({ "story-row": "…" });
    expect(result.removedUnitCount).toBe(2);
  });

  it("leaves every other unit space alone", () => {
    const result = restrictCharacterUnits(bundle(), new Set());

    expect(result.bundle.tables.en["ui:title"]).toBe("Play");
    expect(result.bundle.tables.ja["story-row"]).toBe("…");
  });

  it("keeps every name when the whole cast ships", () => {
    const result = restrictCharacterUnits(bundle(), new Set([KEPT, DROPPED]));

    expect(result.removedUnitCount).toBe(0);
    expect(result.bundle.tables.en[`char:${DROPPED}`]).toBe("The Traitor");
  });
});
