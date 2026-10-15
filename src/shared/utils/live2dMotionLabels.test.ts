import { describe, expect, it } from "vitest";
import { live2dMotionFileLabel, live2dMotionLabels } from "./live2dMotionLabels";

/**
 * Naming a Live2D model's motions by their files.
 *
 * The runtime calls a motion `<group>_<index>` and a row stores that. The list shows the file's
 * name instead wherever the file says more - and never a label that says less than the key did.
 */

/** The motions of the Hiyori sample, as its `Hiyori.model3.json` lists them. */
const HIYORI = {
    Version: 3,
    FileReferences: {
        Moc: "Hiyori.moc3",
        Motions: {
            Idle: [
                { File: "motions/Hiyori_m01.motion3.json", FadeInTime: 0.5 },
                { File: "motions/Hiyori_m02.motion3.json" },
                { File: "motions/Hiyori_m03.motion3.json" },
                { File: "motions/Hiyori_m05.motion3.json" },
            ],
            TapBody: [{ File: "motions/Hiyori_m04.motion3.json" }],
        },
    },
};

describe("live2dMotionFileLabel", () => {
    it("reads a file's name as words", () => {
        expect(live2dMotionFileLabel("haru_m_03.motion3.json", "Idle")).toBe("haru m 03");
        expect(live2dMotionFileLabel("motions/Hiyori_m01.motion3.json", "Idle")).toBe("Hiyori m01");
        expect(live2dMotionFileLabel("motions\\wave-hello.motion3.json", "TapBody")).toBe("wave hello");
        expect(live2dMotionFileLabel("sigh.json", "Idle")).toBe("sigh");
    });

    it("gives no label where the name is only the group, a number, or the word motion", () => {
        expect(live2dMotionFileLabel("Idle_01.motion3.json", "Idle")).toBeNull();
        expect(live2dMotionFileLabel("idle01.motion3.json", "Idle")).toBeNull();
        expect(live2dMotionFileLabel("tap_body_2.motion3.json", "TapBody")).toBeNull();
        expect(live2dMotionFileLabel("motions/03.motion3.json", "Idle")).toBeNull();
        expect(live2dMotionFileLabel("motion_01.motion3.json", "Idle")).toBeNull();
        expect(live2dMotionFileLabel("mtn_02.motion3.json", "")).toBeNull();
        expect(live2dMotionFileLabel(".motion3.json", "Idle")).toBeNull();
    });
});

describe("live2dMotionLabels", () => {
    it("keys each label by the runtime's own name for the motion", () => {
        expect(live2dMotionLabels(HIYORI)).toEqual({
            Idle_0: "Hiyori m01",
            Idle_1: "Hiyori m02",
            Idle_2: "Hiyori m03",
            // The fourth idle is the fifth file: the label is what tells them apart.
            Idle_3: "Hiyori m05",
            TapBody_0: "Hiyori m04",
        });
    });

    it("leaves out a motion whose file says nothing more, and keeps the others", () => {
        const manifest = {
            FileReferences: {
                Motions: {
                    Idle: [{ File: "Idle_00.motion3.json" }, { File: "blink_slow.motion3.json" }],
                    Flick: [{ Sound: "x.wav" }, "not an entry"],
                },
            },
        };
        expect(live2dMotionLabels(manifest)).toEqual({ Idle_1: "blink slow" });
    });

    it("answers nothing for what is not a Cubism 3 manifest", () => {
        expect(live2dMotionLabels(null)).toEqual({});
        expect(live2dMotionLabels("text")).toEqual({});
        expect(live2dMotionLabels({ motions: { idle: [{ file: "a.mtn" }] } })).toEqual({});
        expect(live2dMotionLabels({ FileReferences: { Motions: [] } })).toEqual({});
    });
});
