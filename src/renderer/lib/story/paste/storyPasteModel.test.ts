import { describe, expect, it } from "vitest";
import { isValidStoryEntityId } from "@shared/utils/storyId";
import {
  inferPasteSeparator,
  materializePastedRows,
  planPastedRows,
  planPlainPaste,
  routeStoryPaste,
  speakerMemoryKey,
  splitPastedText
} from "./storyPasteModel";
import type { PastePlan, SpeakerMappingTarget } from "./storyPasteTypes";

/**
 * The fixtures are manuscript-shaped on purpose. Every interesting judgement this model makes is about
 * the difference between a cast list and prose, and toy strings (`a: b`) are equally good evidence for
 * both - they would let a scorer that counts colons pass every test and still mis-read the first real
 * chapter anyone pastes.
 */

const CHINESE_MANUSCRIPT = [
  "第一章 雨",
  "",
  "窗外的雨下了整夜。",
  "林：他说：「走吧」",
  "早苗：我还没准备好。",
  "她没有回答，只是把伞收了起来。",
  "林：那就等雨停。",
  "早苗：好。"
].join("\n");

/** A Ren'Py-ish script: an indented block under a label line that ends with a colon and says nothing. */
const RENPY_SCRIPT = [
  "label chapter_one:",
  '    alice: "You\'re late again."',
  '    bob: "The train was stuck outside the station."',
  '    alice: "That\'s what you said yesterday."',
  "    narrator: The room went quiet."
].join("\n");

/** Colons everywhere, speakers nowhere. The labels are clauses, and that is the only thing that says so. */
const ENGLISH_NOVEL = [
  "The house had two rules, and his father had repeated them until they were furniture: never open the cellar, never ask why.",
  "Rain came off the hill in sheets and the gutters gave up before noon.",
  "She had said it plainly enough at the time: you will not like what you find down there.",
  "He went down anyway."
].join("\n");

/** The harder `none`: Chinese prose whose colon prefixes are SHORT. Only the punctuation rule catches it. */
const CHINESE_NOVEL = [
  "她停下来，回头看了一眼身后的长廊：什么也没有。",
  "雨声盖过了脚步声。",
  "他忽然明白了那句话真正的意思，也明白了自己已经来不及：门在半小时前就锁上了。",
  "灯灭了。"
].join("\n");

/**
 * An English script whose names carry honorifics. The `.` in `Mrs.` is part of a name, not the end of
 * a sentence, and reading it as sentence punctuation condemned every English manuscript ever written.
 */
const HONORIFIC_SCRIPT = [
  "Mrs. Hudson: Your tea is going cold.",
  "Dr. Watson: I'll be up in a moment.",
  "Mrs. Hudson: You said that an hour ago.",
  "Dr. Watson: The case is nearly finished.",
  "Mrs. Hudson: It always is.",
  "Dr. Watson: Not this time."
].join("\n");

/** Screenplay parentheticals: the stage direction rides along with the name and is not part of it. */
const PARENTHETICAL_SCRIPT = [
  "ALICE (whispering, to herself): I should never have come back here.",
  "BOB: You came anyway.",
  "ALICE: The door was standing open.",
  "BOB (after a pause): It usually is.",
  "ALICE: Then I will close it.",
  "BOB: Suit yourself."
].join("\n");

/**
 * Literary prose with spaced em-dashes. Every "label" is a clause used exactly once, which is the
 * only thing that says prose - each one is short, clean and perfectly name-shaped on its own.
 */
const EM_DASH_EXCERPT = [
  "He stopped at the door — the lock had been turned from inside.",
  "The house was colder than the street had been.",
  "She looked at him — neither of them said anything for a while.",
  "Somewhere above, a floorboard settled and was quiet again.",
  "He waited — the hallway light buzzed once and went out.",
  "Then he went up."
].join("\n");

const LENTICULAR_MANUSCRIPT = [
  "【林】早上好。",
  "【早苗】昨晚睡得好吗？",
  "外面的风停了。",
  "【林】还行。"
].join("\n");

const CORNER_BRACKET_MANUSCRIPT = [
  "「林」走吧。",
  "「早苗」等一下，我去拿伞。",
  "他没有停下来。",
  "「林」快点。"
].join("\n");

const DASH_SCRIPT = [
  "Alice - Where were you?",
  "Bob - Outside, waiting for the rain to stop.",
  "The lamp guttered and went out.",
  "Alice - Come in, then."
].join("\n");

/** Hyphens in words, no dialogue at all. `dash` must not read `well` as a speaker. */
const HYPHENATED_PROSE = [
  "The well-known merchant-prince kept a half-empty ledger under the counter.",
  "Nothing else moved in the long-abandoned hall.",
  "A single lamp burned down to nothing."
].join("\n");

const SPREADSHEET_PASTE = ["林\t早上好", "早苗\t早。", "林\t今天也要出门吗"].join("\n");

/** A UUID v4 factory that is deterministic, so a test can name the ids it expects. */
function makeIdFactory(): () => string {
  let issued = 0;
  return () => {
    issued += 1;
    return `00000000-0000-4000-8000-${issued.toString(16).padStart(12, "0")}`;
  };
}

function mappings(
  entries: Record<string, SpeakerMappingTarget>
): Record<string, SpeakerMappingTarget> {
  return Object.fromEntries(
    Object.entries(entries).map(([label, target]) => [speakerMemoryKey(label), target])
  );
}

function planFor(text: string, entries: Record<string, SpeakerMappingTarget> = {}): PastePlan {
  return planPastedRows({
    split: splitPastedText(text, inferPasteSeparator(text)),
    mappings: mappings(entries)
  });
}

describe("inferPasteSeparator", () => {
  it("reads a Chinese manuscript as fullwidth-colon and a Ren'Py script as colon", () => {
    expect(inferPasteSeparator(CHINESE_MANUSCRIPT)).toEqual({ kind: "fullwidthColon" });
    expect(inferPasteSeparator(RENPY_SCRIPT)).toEqual({ kind: "colon" });
  });

  it("answers `none` for prose that merely contains colons", () => {
    expect(inferPasteSeparator(ENGLISH_NOVEL)).toEqual({ kind: "none" });
    expect(inferPasteSeparator(CHINESE_NOVEL)).toEqual({ kind: "none" });
  });

  it("recognises the bracket forms and a spreadsheet's tab", () => {
    expect(inferPasteSeparator(LENTICULAR_MANUSCRIPT)).toEqual({ kind: "lenticular" });
    expect(inferPasteSeparator(CORNER_BRACKET_MANUSCRIPT)).toEqual({ kind: "cornerBracket" });
    expect(inferPasteSeparator(SPREADSHEET_PASTE)).toEqual({ kind: "tab" });
  });

  it("takes a spaced dash but never a hyphenated word", () => {
    expect(inferPasteSeparator(DASH_SCRIPT)).toEqual({ kind: "dash" });
    expect(inferPasteSeparator(HYPHENATED_PROSE)).toEqual({ kind: "none" });
  });

  /**
   * The two directions the scorer used to get wrong, and they are the same mistake: the label rules
   * were crude enough to condemn real names, and repetition was only a weak damping rather than the
   * signal that actually separates a cast list from prose.
   */
  it("takes a script whose names carry honorifics", () => {
    expect(inferPasteSeparator(HONORIFIC_SCRIPT)).toEqual({ kind: "colon" });
    const split = splitPastedText(HONORIFIC_SCRIPT, inferPasteSeparator(HONORIFIC_SCRIPT));
    expect(split.speakers.map((tally) => tally.label)).toEqual(["Mrs. Hudson", "Dr. Watson"]);
  });

  it("takes a screenplay parenthetical as a stage direction rather than as part of the name", () => {
    expect(inferPasteSeparator(PARENTHETICAL_SCRIPT)).toEqual({ kind: "colon" });
    const split = splitPastedText(PARENTHETICAL_SCRIPT, { kind: "colon" });
    expect(split.speakers).toEqual([
      { label: "ALICE", count: 3, lineIndices: [0, 2, 4] },
      { label: "BOB", count: 3, lineIndices: [1, 3, 5] }
    ]);
    // Folded into the line rather than dropped: nothing the author pasted may disappear silently.
    expect(split.lines[0].text).toBe(
      "(whispering, to herself) I should never have come back here."
    );
  });

  it("answers `none` for a short prose excerpt whose clause labels never repeat", () => {
    expect(inferPasteSeparator(EM_DASH_EXCERPT)).toEqual({ kind: "none" });
  });

  /** ...but two lines are a real exchange. Repetition needs a sample before it can mean anything. */
  it("keeps a two-line exchange, where there is nothing to repeat yet", () => {
    expect(inferPasteSeparator("A: hi\nB: yo")).toEqual({ kind: "colon" });
  });

  it("rejects a separator whose labels never repeat, and keeps one whose labels do", () => {
    // 200 lines, 200 "speakers": a numbered prose dump, not a cast list.
    const numbered = Array.from(
      { length: 200 },
      (_, index) => `第${index + 1}节：他继续往前走了很久`
    ).join("\n");
    expect(inferPasteSeparator(numbered)).toEqual({ kind: "none" });

    const cast = ["林", "早苗", "老板", "女孩"];
    const conversation = Array.from(
      { length: 200 },
      (_, index) => `${cast[index % cast.length]}：还没到时候`
    ).join("\n");
    expect(inferPasteSeparator(conversation)).toEqual({ kind: "fullwidthColon" });
  });

  it("answers `none` for an empty paste rather than dividing by no lines", () => {
    expect(inferPasteSeparator("")).toEqual({ kind: "none" });
    expect(inferPasteSeparator("\n\n   \n")).toEqual({ kind: "none" });
  });
});

describe("splitPastedText", () => {
  it("splits at the first separator only", () => {
    const split = splitPastedText(CHINESE_MANUSCRIPT, { kind: "fullwidthColon" });
    const line = split.lines.find((entry) => entry.text.startsWith("他说"));
    expect(line?.speaker).toBe("林");
    expect(line?.text).toBe("他说：「走吧」");
  });

  it("tallies speakers in first-appearance order, collapsing spellings that differ only in case", () => {
    const split = splitPastedText("Alice: one\nBOB: two\nalice: three", { kind: "colon" });
    expect(split.speakers).toEqual([
      { label: "Alice", count: 2, lineIndices: [0, 2] },
      { label: "BOB", count: 1, lineIndices: [1] }
    ]);
    expect(split.narrationCount).toBe(0);
  });

  it("counts unmatched lines as narration and leaves their text as pasted", () => {
    const split = splitPastedText(CHINESE_MANUSCRIPT, { kind: "fullwidthColon" });
    expect(split.lines).toHaveLength(7);
    expect(split.narrationCount).toBe(3);
    expect(split.lines[0]).toEqual({ index: 0, raw: "第一章 雨", text: "第一章 雨" });
  });

  it("never matches a line with a label but no text", () => {
    const split = splitPastedText(RENPY_SCRIPT, { kind: "colon" });
    expect(split.lines[0]).toEqual({
      index: 0,
      raw: "label chapter_one:",
      text: "label chapter_one:"
    });
    expect(split.lines[1].speaker).toBe("alice");
  });

  it("collapses blank runs, strips CRLF and edge whitespace, and ignores a single trailing newline", () => {
    const split = splitPastedText("\r\n第一行\r\n\r\n\r\n  \t第二行  \r\n", { kind: "none" });
    expect(split.lines.map((line) => line.raw)).toEqual(["第一行", "第二行"]);
    expect(split.lines.map((line) => line.index)).toEqual([0, 1]);
    expect(split.narrationCount).toBe(2);
  });

  it("returns an empty split for an empty paste", () => {
    expect(splitPastedText("", { kind: "fullwidthColon" })).toEqual({
      lines: [],
      speakers: [],
      narrationCount: 0
    });
  });

  it("applies a custom pattern with both named groups", () => {
    const split = splitPastedText("[林] 走吧。\n外面还在下雨。\n[早苗] 等我一下。", {
      kind: "regex",
      source: "^\\[(?<speaker>[^\\]]+)\\]\\s*(?<text>.+)$"
    });
    expect(split.problem).toBeUndefined();
    expect(split.speakers.map((tally) => tally.label)).toEqual(["林", "早苗"]);
    expect(split.lines[0].text).toBe("走吧。");
    expect(split.narrationCount).toBe(1);
  });

  it("reports a half-typed pattern instead of throwing, and falls back to no separator", () => {
    const half = splitPastedText(CHINESE_MANUSCRIPT, { kind: "regex", source: "^(?<speaker>[" });
    expect(half.problem).toBe("invalidRegex");
    expect(half.lines).toHaveLength(7);
    expect(half.narrationCount).toBe(7);
    expect(half.speakers).toEqual([]);

    const unnamed = splitPastedText(CHINESE_MANUSCRIPT, { kind: "regex", source: "^(.+)：(.+)$" });
    expect(unnamed.problem).toBe("missingGroups");
    expect(unnamed.narrationCount).toBe(7);
  });
});

describe("planPastedRows", () => {
  it("defaults an unmapped label to a temp speaker", () => {
    const plan = planFor(CHINESE_MANUSCRIPT);
    expect(plan.charactersToCreate).toEqual([]);
    expect(plan.counts).toEqual({ dialogue: 4, narration: 3 });
    expect(plan.rows[2]).toEqual({ kind: "dialogue", text: "他说：「走吧」", speakerName: "林" });
  });

  it("resolves a mapped character and collects the ones still to create, once each", () => {
    const plan = planFor(CHINESE_MANUSCRIPT, {
      林: { kind: "character", characterId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1" },
      早苗: { kind: "createCharacter" }
    });
    expect(plan.charactersToCreate).toEqual(["早苗"]);
    expect(plan.rows[2]).toEqual({
      kind: "dialogue",
      text: "他说：「走吧」",
      characterId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
    });
    expect(plan.rows[3]).toEqual({
      kind: "dialogue",
      text: "我还没准备好。",
      speakerName: "早苗",
      pendingCharacterName: "早苗"
    });
  });

  it("uses the tally's spelling, so one mapping decision cannot create two characters", () => {
    const plan = planPastedRows({
      split: splitPastedText("Alice: one\nALICE: two", { kind: "colon" }),
      mappings: mappings({ Alice: { kind: "createCharacter" } })
    });
    expect(plan.charactersToCreate).toEqual(["Alice"]);
    expect(
      plan.rows.map((row) => (row.kind === "dialogue" ? row.pendingCharacterName : null))
    ).toEqual(["Alice", "Alice"]);
  });

  it("restores the pasted line verbatim when a label turns out not to be a speaker", () => {
    // The spacing around the separator is the point: a re-join would hand back `林：他说：「走吧」`.
    const text = "林 ：  他说：「走吧」\n早苗：好。";
    const plan = planPastedRows({
      split: splitPastedText(text, { kind: "fullwidthColon" }),
      mappings: mappings({ 林: { kind: "notASpeaker" } })
    });
    expect(plan.rows[0]).toEqual({ kind: "narration", text: "林 ：  他说：「走吧」" });
    expect(plan.counts).toEqual({ dialogue: 1, narration: 1 });
  });
});

describe("planPlainPaste", () => {
  it("carries the anchor's speaker onto every line and parses nothing", () => {
    const plan = planPlainPaste("林：走吧。\n外面还在下雨。", {
      kind: "dialogue",
      characterId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      speakerName: "林"
    });
    expect(plan.counts).toEqual({ dialogue: 2, narration: 0 });
    // `林：走吧。` stays whole - a plain paste that split it would be the wizard with no undo.
    expect(plan.rows[0]).toEqual({
      kind: "dialogue",
      text: "林：走吧。",
      characterId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      speakerName: "林"
    });
    expect(plan.charactersToCreate).toEqual([]);
  });

  it("turns every other anchor into narration", () => {
    for (const kind of ["narration", "note", "none"] as const) {
      const plan = planPlainPaste(RENPY_SCRIPT, { kind });
      expect(plan.counts).toEqual({ dialogue: 0, narration: 5 });
      expect(plan.rows[1]).toEqual({ kind: "narration", text: 'alice: "You\'re late again."' });
    }
  });
});

describe("materializePastedRows", () => {
  it("builds narration and dialogue blocks with fresh UUID v4 ids and one textId each", () => {
    const plan = planFor(CHINESE_MANUSCRIPT, { 林: { kind: "createCharacter" } });
    const { blocks } = materializePastedRows(plan, {
      generateId: makeIdFactory(),
      createdCharacterIds: { 林: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1" }
    });

    expect(blocks).toHaveLength(7);
    const textIds: string[] = [];
    for (const block of blocks) {
      expect(block.kind).toBe("nodeAction");
      expect(block.parentId).toBeNull();
      expect(block.childrenIds).toEqual([]);
      expect(isValidStoryEntityId(block.id)).toBe(true);
      const payload = block.payload as { text: { textId: string } };
      expect(isValidStoryEntityId(payload.text.textId)).toBe(true);
      textIds.push(payload.text.textId);
    }
    expect(new Set([...textIds, ...blocks.map((block) => block.id)]).size).toBe(14);

    expect(blocks[0].payload).toEqual({
      action: "narration",
      text: { textId: expect.any(String), role: "narration", value: "第一章 雨" }
    });
    expect(blocks[2].payload).toEqual({
      action: "dialogue",
      characterId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      text: { textId: expect.any(String), role: "dialogue", value: "他说：「走吧」" }
    });
  });

  it("falls back to the bare name when a pending character was never created", () => {
    const plan = planFor(CHINESE_MANUSCRIPT, { 林: { kind: "createCharacter" } });
    const { blocks } = materializePastedRows(plan, {
      generateId: makeIdFactory(),
      createdCharacterIds: {}
    });
    expect(blocks[2].payload).toEqual({
      action: "dialogue",
      speakerName: "林",
      text: { textId: expect.any(String), role: "dialogue", value: "他说：「走吧」" }
    });
  });

  it("refuses an id factory that does not mint UUID v4, at paste time rather than at next load", () => {
    const plan = planFor(CHINESE_MANUSCRIPT);
    let issued = 0;
    expect(() =>
      materializePastedRows(plan, {
        generateId: () => `block-${(issued += 1)}`,
        createdCharacterIds: {}
      })
    ).toThrow(/UUID v4/);
  });
});

describe("routeStoryPaste", () => {
  const blocksPayload = JSON.stringify({
    version: 1,
    kind: "narraleaf.story.actions",
    roots: [{ block: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" }, children: [] }]
  });

  it("prefers Studio's own block payload over the text beside it", () => {
    expect(
      routeStoryPaste({
        storyBlocksPayload: blocksPayload,
        plainText: CHINESE_MANUSCRIPT,
        plainRequested: true
      })
    ).toEqual({ kind: "blocks" });
  });

  it("ignores a payload that is absent, unparseable or empty", () => {
    for (const payload of [
      "",
      "{not json",
      JSON.stringify({ kind: "narraleaf.story.actions", roots: [] })
    ]) {
      expect(
        routeStoryPaste({
          storyBlocksPayload: payload,
          plainText: CHINESE_MANUSCRIPT,
          plainRequested: false
        })
      ).toEqual({
        kind: "wizard",
        text: CHINESE_MANUSCRIPT
      });
    }
  });

  it("sends a Story Script file to Import Script, ahead of both the single-line and wizard paths", () => {
    const file = ["#nlscript v1", "#story Story", "#scene 第一场", "林：走吧。"].join("\n");
    expect(
      routeStoryPaste({ storyBlocksPayload: "", plainText: file, plainRequested: false })
    ).toEqual({ kind: "scriptFile" });
    expect(
      routeStoryPaste({ storyBlocksPayload: "", plainText: "#nlscript v1", plainRequested: false })
    ).toEqual({ kind: "scriptFile" });
  });

  it("takes a single line straight in, wizard or not", () => {
    expect(
      routeStoryPaste({
        storyBlocksPayload: "",
        plainText: "  林：走吧。  \n",
        plainRequested: false
      })
    ).toEqual({ kind: "single" });
    expect(
      routeStoryPaste({ storyBlocksPayload: "", plainText: "", plainRequested: false })
    ).toEqual({ kind: "single" });
  });

  it("honours an explicit plain paste, and otherwise opens the wizard", () => {
    expect(
      routeStoryPaste({
        storyBlocksPayload: "",
        plainText: CHINESE_MANUSCRIPT,
        plainRequested: true
      })
    ).toEqual({
      kind: "plain",
      text: CHINESE_MANUSCRIPT
    });
    expect(
      routeStoryPaste({
        storyBlocksPayload: "",
        plainText: CHINESE_MANUSCRIPT,
        plainRequested: false
      })
    ).toEqual({
      kind: "wizard",
      text: CHINESE_MANUSCRIPT
    });
  });
});
