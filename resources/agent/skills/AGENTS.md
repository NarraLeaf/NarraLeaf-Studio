# Agent instructions

This folder holds the NarraLeaf game-making skill.

When the user wants to make, adapt, port or finish a visual novel in NarraLeaf Studio - or when the
NarraLeaf Studio MCP tools are available (`agent_status`, `story_apply`, `ui_patch` …):

1. Read `narraleaf-make-game/SKILL.md` and follow its steps in order. Read each file under
   `narraleaf-make-game/references/` when the step that needs it comes up.
2. If you cannot read those files, call the MCP tool `agent_guide` with `chapter: "workflow"` (and the
   other chapters as needed) - it returns the same guide.
3. Start with `agent_status`. If the NarraLeaf tools are missing, tell the user to open NarraLeaf
   Studio, switch on *Settings -> Agent access*, and connect this agent as described in `README.md`.

The user watches every edit live in Studio. Write one scene or one page pass per call, announce big
steps first, and never overwrite after a `stale_revision` refusal without reading again.
