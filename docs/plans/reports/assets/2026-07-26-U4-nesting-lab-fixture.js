/*
 * Add a "Nesting Lab" scene to the ISOLATED project copy.
 *
 * Why this exists: demo3 contains zero container blocks (no choice / condition / repeat / parallel /
 * nvl), so the Dev Mode Stack tab is literally unreachable there — its root stack is empty for the
 * whole of every scene. Any acceptance of "the execution-context tab tells you where you are" on
 * demo3 alone would be a criterion that cannot fail, which is the exact failure mode §6.5 names.
 *
 * Writes ONLY to D:/Temp/nls-u4-proj/demo3 (a copy). The real demo3 is never opened by this script.
 */

const fs = require('fs');

const DOC = 'D:/Temp/nls-u4-proj/demo3/editor/story/stories/85b21d0a-5fe6-48d1-9326-0b03b5cb7ed4/storydoc.json';
const SCENE_ID = 'u4f1x7e0-0000-4000-8000-000000000001';
const CHAPTER_ID = '06e4e4e8-e121-4714-95f5-b937b32592b2'; // Chapter 2

let n = 0;
const id = () => `u4f1x7e0-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const tid = () => `u4f1x7e0-1111-4000-8000-${String(n).padStart(12, '0')}`;

const blocks = {};
const put = (block) => { blocks[block.id] = block; return block.id; };

function narration(value, parentId) {
    return put({
        id: id(), parentId: parentId ?? null, childrenIds: [], kind: 'nodeAction',
        payload: { action: 'narration', text: { textId: tid(), role: 'narration', value } },
    });
}
function container(payload, parentId, buildChildren) {
    const self = { id: id(), parentId: parentId ?? null, childrenIds: [], kind: 'control', payload };
    put(self);
    self.childrenIds = buildChildren(self.id);
    return self.id;
}
function choiceOption(text, parentId, buildChildren) {
    const self = {
        id: id(), parentId, childrenIds: [], kind: 'nodeAction',
        payload: { action: 'choiceOption', text: { textId: tid(), role: 'choiceOption', value: text } },
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
root.push(narration('Nesting lab: entering.'));

// repeat ×3 — exercises the loop counter
root.push(container({ control: 'repeat', times: 3 }, null, parent => [
    narration('Inside the repeat body.', parent),
]));

// parallel > sequence > line — a two-level chain AND "who is running in the parallel"
root.push(container({ control: 'parallel', mode: 'all' }, null, parent => [
    container({ control: 'sequence' }, parent, p => [narration('Parallel branch A.', p)]),
    container({ control: 'sequence' }, parent, p => [narration('Parallel branch B.', p)]),
]));

// a menu with two options, one of which nests a further container. Nothing asserted needs it to be
// clicked; it is here so the executor (and a human doing a manual pass) has a menu to look at.
root.push((() => {
    const self = {
        id: id(), parentId: null, childrenIds: [], kind: 'nodeAction',
        payload: { action: 'choice', prompt: { textId: tid(), role: 'choice', value: 'Which way?' } },
    };
    put(self);
    self.childrenIds = [
        choiceOption('Left', self.id, p => [
            narration('You went left.', p),
            container({ control: 'sequence' }, p, q => [narration('Left, deeper still.', q)]),
        ]),
        choiceOption('Right', self.id, p => [narration('You went right.', p)]),
    ];
    return self.id;
})());

root.push(narration('Nesting lab: done.'));

const scene = {
    id: SCENE_ID,
    name: 'Nesting Lab',
    runtimeName: 'nesting_lab',
    description: '',
    rootBlockIds: root,
    blocks,
    meta: { createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z' },
    sceneVariables: {},
};

const doc = JSON.parse(fs.readFileSync(DOC, 'utf8'));
doc.scenes[SCENE_ID] = scene;
const chapter = doc.chapters.find(c => c.id === CHAPTER_ID);
if (!chapter.sceneIds.includes(SCENE_ID)) chapter.sceneIds.push(SCENE_ID);
fs.writeFileSync(DOC, JSON.stringify(doc, null, 1));

console.log('scene blocks:', Object.keys(blocks).length, 'roots:', root.length);
console.log('scene id:', SCENE_ID);
