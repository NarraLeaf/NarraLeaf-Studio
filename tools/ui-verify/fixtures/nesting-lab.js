/*
 * Generate the "Nesting Lab" scene into a project, for verifying anything about containers.
 *
 *   node tools/ui-verify/fixtures/nesting-lab.js <projectPath>
 *
 * Why it exists: demo3 — the project every acceptance run uses — contains ZERO container blocks. No
 * choice, condition, repeat, parallel or nvl anywhere in its three scenes, so the execution stack is
 * empty for the whole of every scene and the Dev Mode context tab is literally unreachable. Any
 * assertion about containers written against demo3 alone cannot fail, which is the most expensive
 * kind of green there is.
 *
 * What it contains and why each piece is there:
 *   - `repeat ×3`      the loop counter (engine >= 0.19.1 reports the live round through it)
 *   - `parallel` > two `sequence` branches, BEFORE the menu — a two-level container chain plus
 *                      "who is running in the parallel", reachable by plain advancing
 *   - a two-option menu, one option nesting a further container — for a human to look at. Nothing
 *                      asserted depends on picking an option: a synthesized CDP click does not
 *                      select one (the click lands on the option, elementFromPoint confirms it, and
 *                      the menu simply stays up), the same family as the HTML5-drag lesson
 *   - an EMPTY narration row — without one, "the timeline must not show the editor's
 *                      'Double-click to enter narration' placeholder" holds on every scene in demo3
 *                      and therefore proves nothing
 *
 * ALWAYS run this against a COPY of a project, never a shared fixture: it rewrites storydoc.json.
 */

const fs = require("fs");
const path = require("path");

const projectPath = process.argv[2];
if (!projectPath) {
  console.error("usage: node tools/ui-verify/fixtures/nesting-lab.js <projectPath>");
  process.exit(1);
}

const storiesDir = path.join(projectPath, "editor", "story", "stories");
const storyId = fs.readdirSync(storiesDir)[0];
const DOC = path.join(storiesDir, storyId, "storydoc.json");
const SCENE_ID = "u4f1x7e0-0000-4000-8000-000000000001";

let n = 0;
const id = () => `u4f1x7e0-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const tid = () => `u4f1x7e0-1111-4000-8000-${String(n).padStart(12, "0")}`;

const blocks = {};
const put = (block) => {
  blocks[block.id] = block;
  return block.id;
};

function narration(value, parentId) {
  return put({
    id: id(),
    parentId: parentId ?? null,
    childrenIds: [],
    kind: "nodeAction",
    payload: { action: "narration", text: { textId: tid(), role: "narration", value } }
  });
}
function container(payload, parentId, buildChildren) {
  const self = { id: id(), parentId: parentId ?? null, childrenIds: [], kind: "control", payload };
  put(self);
  self.childrenIds = buildChildren(self.id);
  return self.id;
}
function choiceOption(text, parentId, buildChildren) {
  const self = {
    id: id(),
    parentId,
    childrenIds: [],
    kind: "nodeAction",
    payload: { action: "choiceOption", text: { textId: tid(), role: "choiceOption", value: text } }
  };
  put(self);
  self.childrenIds = buildChildren(self.id);
  return self.id;
}

/*
 * Order matters. The menu is LAST, and nothing asserted depends on picking one of its options:
 * a synthesized CDP click on a choice option does not select it (verified — the click lands on the
 * option element, elementFromPoint confirms it, and the menu just stays up), the same family as the
 * HTML5-drag lesson. So every container the assertions read has to be reachable by plain advancing.
 */
const root = [];
root.push(narration("Nesting lab: entering."));

// repeat ×3 — exercises the loop counter
root.push(
  container({ control: "repeat", times: 3 }, null, (parent) => [
    narration("Inside the repeat body.", parent)
  ])
);

// parallel > sequence > line — a two-level chain AND "who is running in the parallel"
root.push(
  container({ control: "parallel", mode: "all" }, null, (parent) => [
    container({ control: "sequence" }, parent, (p) => [narration("Parallel branch A.", p)]),
    container({ control: "sequence" }, parent, (p) => [narration("Parallel branch B.", p)])
  ])
);

// a menu with two options, one of which nests a further container. Nothing asserted needs it to be
// clicked; it is here so the executor (and a human doing a manual pass) has a menu to look at.
root.push(
  (() => {
    const self = {
      id: id(),
      parentId: null,
      childrenIds: [],
      kind: "nodeAction",
      payload: { action: "choice", prompt: { textId: tid(), role: "choice", value: "Which way?" } }
    };
    put(self);
    self.childrenIds = [
      choiceOption("Left", self.id, (p) => [
        narration("You went left.", p),
        container({ control: "sequence" }, p, (q) => [narration("Left, deeper still.", q)])
      ]),
      choiceOption("Right", self.id, (p) => [narration("You went right.", p)])
    ];
    return self.id;
  })()
);

// An EMPTY narration row. Without one, "the timeline must not show the editor's
// 'Double-click to enter narration' placeholder" is unfalsifiable — it passes on any scene
// whose text rows all have text, which is every scene in demo3.
root.push(narration(""));

root.push(narration("Nesting lab: done."));

const scene = {
  id: SCENE_ID,
  name: "Nesting Lab",
  runtimeName: "nesting_lab",
  description: "",
  rootBlockIds: root,
  blocks,
  meta: { createdAt: "2026-07-26T00:00:00.000Z", updatedAt: "2026-07-26T00:00:00.000Z" },
  sceneVariables: {}
};

const doc = JSON.parse(fs.readFileSync(DOC, "utf8"));
doc.scenes[SCENE_ID] = scene;
const chapter = doc.chapters[doc.chapters.length - 1];
if (chapter && !chapter.sceneIds.includes(SCENE_ID)) chapter.sceneIds.push(SCENE_ID);
fs.writeFileSync(DOC, JSON.stringify(doc, null, 1));

console.log(
  `wrote "${scene.name}" (${Object.keys(blocks).length} blocks, ${root.length} roots) into ${DOC}`
);
