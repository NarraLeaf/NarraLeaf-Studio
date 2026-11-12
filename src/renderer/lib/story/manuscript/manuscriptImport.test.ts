import { describe, expect, it } from "vitest";
import { planPastedRows, splitPastedText, inferPasteSeparator } from "@/lib/story/paste/storyPasteModel";
import {
    docxToSource,
    guessTableMapping,
    parseDelimitedText,
    parseFountain,
    partitionPlanIntoScenes,
    proseSourceText,
    sourceSceneLineCounts,
    structuredSourceSplit,
    tableToSource,
} from "./manuscriptImport";

describe("parseFountain", () => {
    it("reads scene headings, cues, continuation lines, parentheticals and action", () => {
        const source = parseFountain([
            "Title: Test",
            "Author: Someone",
            "",
            "INT. CLASSROOM - DAY",
            "",
            "Rain on the *windows*.",
            "The room is empty.",
            "",
            "ALICE (V.O.)",
            "(quietly)",
            "Is anyone",
            "here?",
            "",
            "CUT TO:",
            "",
            "EXT. ROOF - NIGHT",
            "",
            "@McCLANE",
            "Yippee.",
            "(beat)",
            "Again.",
            "",
            "/* boneyard */",
            "[[cut this later]]",
        ].join("\n"));
        expect(source.scenes).toEqual([
            {
                name: "INT. CLASSROOM - DAY",
                lines: [
                    { text: "Rain on the windows. The room is empty." },
                    { speaker: "ALICE", text: "Is anyone here?", note: "quietly" },
                ],
            },
            {
                name: "EXT. ROOF - NIGHT",
                lines: [
                    { speaker: "McCLANE", text: "Yippee." },
                    { speaker: "McCLANE", text: "Again.", note: "beat cut this later" },
                ],
            },
        ]);
    });

    it("recognises CJK names as cues and joins CJK continuation lines without a space", () => {
        const source = parseFountain(["", "林檎", "今天的雨", "下得真大。", "", "窗外一片灰色，什么也看不见。", "", "", "早苗", "嗯。"].join("\n"));
        expect(source.scenes).toEqual([{
            lines: [
                { speaker: "林檎", text: "今天的雨下得真大。" },
                { text: "窗外一片灰色，什么也看不见。" },
                { speaker: "早苗", text: "嗯。" },
            ],
        }]);
    });

    it("does not take a lone action line in capitals for a cue", () => {
        const source = parseFountain("BOOM\n\nShe runs.");
        expect(source.scenes[0].lines).toEqual([{ text: "BOOM" }, { text: "She runs." }]);
    });
});

describe("tables", () => {
    it("tokenises CSV with quotes, a BOM and multi-line fields", () => {
        expect(parseDelimitedText("﻿角色,台词\r\n林,\"你好，\"\"世界\"\"\n第二行\"\r\n,\r\n")).toEqual([
            ["角色", "台词"],
            ["林", "你好，\"世界\"\n第二行"],
            [],
        ]);
    });

    it("guesses tab and semicolon delimiters", () => {
        expect(parseDelimitedText("a\tb\nc\td")).toEqual([["a", "b"], ["c", "d"]]);
        expect(parseDelimitedText("a;b\nc;d")).toEqual([["a", "b"], ["c", "d"]]);
    });

    it("maps columns from a header in any of the three languages", () => {
        expect(guessTableMapping([["シーン", "話者", "セリフ", "備考"]])).toEqual({ headerRow: true, speaker: 1, text: 2, note: 3, scene: 0 });
        expect(guessTableMapping([["Line", "Speaker"]])).toEqual({ headerRow: true, speaker: 1, text: 0, note: null, scene: null });
        expect(guessTableMapping([["林", "你好"], ["早苗", "嗯"]])).toEqual({ headerRow: false, speaker: 0, text: 1, note: null, scene: null });
    });

    it("turns rows into scenes, narration and notes, skipping blank lines", () => {
        const rows = [["场景", "角色", "台词", "备注"], ["教室", "林", "你好", "轻声"], ["教室", "", "雨声。", ""], ["", "", "", ""], ["屋顶", "早苗", "嗯", ""]];
        const source = tableToSource(rows, guessTableMapping(rows));
        expect(source.scenes).toEqual([
            { name: "教室", lines: [{ speaker: "林", text: "你好", note: "轻声" }, { text: "雨声。" }] },
            { name: "屋顶", lines: [{ speaker: "早苗", text: "嗯" }] },
        ]);
    });
});

describe("into the wizard and back", () => {
    it("hands the wizard a ready split and cuts its plan back into scenes", () => {
        const source = tableToSource([["教室", "林", "你好", "轻声"], ["教室", "", "雨声。"], ["屋顶", "林", "嗯"]], { headerRow: false, scene: 0, speaker: 1, text: 2, note: 3 });
        const split = structuredSourceSplit(source);
        expect(split.speakers).toEqual([{ label: "林", count: 2, lineIndices: [0, 2] }]);
        expect(split.narrationCount).toBe(1);
        const plan = planPastedRows({ split, mappings: {} });
        const scenes = partitionPlanIntoScenes(plan, source);
        expect(scenes).toEqual([
            {
                name: "教室",
                rows: [
                    { row: { kind: "dialogue", text: "你好", speakerName: "林" }, note: "轻声" },
                    { row: { kind: "narration", text: "雨声。" } },
                ],
            },
            { name: "屋顶", rows: [{ row: { kind: "dialogue", text: "嗯", speakerName: "林" } }] },
        ]);
    });

    it("splits a Word manuscript into scenes at headings and runs the paste inference on it", () => {
        const source = docxToSource([
            { text: "剧本", headingLevel: 0 },
            { text: "第一场", headingLevel: 1 },
            { text: "林：你好" },
            { text: "" },
            { text: "早苗：嗯" },
            { text: "雨还在下。" },
            { text: "第二场", headingLevel: 1 },
            { text: "林：走吧" },
        ]);
        expect(source.scenes.map(scene => scene.name)).toEqual(["第一场", "第二场"]);
        expect(sourceSceneLineCounts(source)).toEqual([3, 1]);
        const text = proseSourceText(source);
        const choice = inferPasteSeparator(text);
        expect(choice.kind).toBe("fullwidthColon");
        const plan = planPastedRows({ split: splitPastedText(text, choice), mappings: {} });
        const scenes = partitionPlanIntoScenes(plan, source);
        expect(scenes.map(scene => scene.rows.length)).toEqual([3, 1]);
        expect(scenes[1].rows[0].row).toEqual({ kind: "dialogue", text: "走吧", speakerName: "林" });
    });
});
