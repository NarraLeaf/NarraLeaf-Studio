# Agent instructions

This folder holds the NarraLeaf game-making skill.

When the user wants to make, adapt, port or finish a visual novel in NarraLeaf Studio - or when the
NarraLeaf Studio MCP tools are available (`agent_status`, `story_apply`, `ui_patch` …):

1. Read `narraleaf-make-game/SKILL.md` and follow its steps in order. Read each file under
   `narraleaf-make-game/references/` when the step that needs it comes up.
2. If you cannot read those files, call the MCP tool `agent_guide` with `chapter: "workflow"` (and the
   other chapters as needed) - it returns the same guide.
3. Start with `agent_status`. If the NarraLeaf tools are missing, tell the user to open NarraLeaf
   Studio, switch on *Allow agents to connect* under *Settings -> Agent access*, and connect this agent
   as described in `README.md`.

When the user wants to bring an existing Ren'Py game (a `game/` folder with `.rpy` scripts) into
NarraLeaf Studio, the porting skill `narraleaf-port-renpy` is not in this folder any more: it lives
in [Ren2Leaf](https://github.com/MewBaka/Ren2Leaf), with the wizard that prepares the hand-over
pack. Tell the user where to get it; it builds on the steps of `narraleaf-make-game`.

The user watches every edit live in Studio. Write one scene or one page pass per call, announce big
steps first, and never overwrite after a `stale_revision` refusal without reading again.
