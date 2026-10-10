# NarraLeaf Skills

This folder lets your AI agent make a complete, playable visual novel in NarraLeaf Studio, with you
watching every edit land in Studio. It works with any agent that speaks MCP (the Model Context
Protocol): Claude Code, Claude Desktop, opencode, Codex, Cursor, Gemini CLI and others.

Two pieces:

- **NarraLeaf Studio's MCP server** - built into Studio. It gives the agent tools to create projects,
  import assets, write scenes, restyle the interface, playtest and build. Studio must be open.
- **The `narraleaf-make-game` skill** - the guide the agent follows: the order of work, the text
  formats it writes, interface design rules and the traps to avoid.

```
NarraLeaf-Skills/
  README.md                  this file
  AGENTS.md                  pointer for agents that read AGENTS.md
  mcp-configs/               ready-made connection settings per agent
  narraleaf-make-game/       the skill (SKILL.md + references/ + assets/)
```

## 1. Switch on agent access in Studio

1. Open NarraLeaf Studio.
2. **Settings -> Agent access** (also in the menu bar's *Agent* menu): switch on agent access.
3. Switch on **Allow agents to change projects** when you want the agent to edit (it can read without).
4. Optional: under **Folders agents may import from**, add the folder that holds your art and audio.
   You can skip this - when the agent needs a folder outside the project, Studio asks you in a dialog
   and adds it to the list when you allow it. **Full access** lets the agent change projects and read
   any folder without asking (Studio's own folders stay closed); leave it off unless you want that.
5. **Copy configuration** gives you the address (`http://127.0.0.1:<PORT>/mcp`, usually port 47219)
   and the access token, already filled into the settings for the agent you pick. If another program
   holds that port, Studio moves to a nearby one, keeps it from then on and says so on the settings
   page; copy the configuration again for agents you set up before.

The server listens only on your own computer (127.0.0.1) and refuses any request without the token.
Treat the token like a password; you can regenerate it in the same settings page.

While the agent works, Studio's status bar shows what it is editing; **Pause agent** there stops it
at once, and **Ctrl+Z** (Cmd+Z) undoes its last edit like any of yours.

## 2. Connect your agent

Replace `<PORT>` and `<TOKEN>` with the values from *Copy configuration*. The files in `mcp-configs/`
hold the same settings.

### Claude Code

```sh
claude mcp add --scope user --transport http narraleaf http://127.0.0.1:<PORT>/mcp --header "Authorization: Bearer <TOKEN>"
```

`--scope user` makes the tools available in every folder, so you can ask for a game from wherever
your terminal happens to be. (Without it, or with `mcp-configs/claude-code.mcp.json` saved as
`.mcp.json` in a folder, they exist in that one folder only.) Check with `claude mcp list`, or `/mcp`
inside Claude Code.

Making a game takes a hundred or more tool calls, and Claude Code asks before each one by default.
Answer the first prompt with *Yes, and don't ask again* for the narraleaf tools, or allow them all
up front in `~/.claude/settings.json`:

```json
{ "permissions": { "allow": ["mcp__narraleaf"] } }
```

You can still pause the agent from Studio at any moment, and Studio's own switch decides whether it
may change anything at all.

### Claude Desktop

Claude Desktop's configuration file starts local programs, and Studio can be that program: started
with `--mcp-stdio`, it opens no window and forwards the connection to the Studio you have open
(starting Studio first if it is not running). In Studio, *Copy configuration -> stdio* gives the
entry with the path to Studio filled in; merge it, or `mcp-configs/claude-desktop.json` with
`<STUDIO_EXECUTABLE>` replaced, into `claude_desktop_config.json` (*Settings -> Developer -> Edit
Config*) and restart Claude Desktop. The path is the program itself, for example
`/Applications/NarraLeaf Studio.app/Contents/MacOS/NarraLeaf Studio` on macOS. No token goes into
this entry: the bridge reads it from Studio's settings.

If that does not work for you, `mcp-configs/claude-desktop-mcp-remote.json` does the same through
`mcp-remote`, a third-party npm package (needs Node.js; fill in `<PORT>` and `<TOKEN>`). If your
Claude Desktop offers adding a custom connector by URL, you can use the address and token there
instead.

### opencode

Merge `mcp-configs/opencode.json` into `opencode.json` in your working folder, or into
`~/.config/opencode/opencode.json` for every folder. Check with `opencode mcp list`.

### Codex CLI

Append `mcp-configs/codex.toml` to `~/.codex/config.toml`. Check with `codex mcp list`, or `/mcp`
inside Codex.

### Cursor

Copy `mcp-configs/cursor.mcp.json` to `.cursor/mcp.json` in your working folder, or to
`~/.cursor/mcp.json` for every folder. Enable the server under *Cursor Settings -> MCP*.

### Gemini CLI

Merge `mcp-configs/gemini-settings.json` into `~/.gemini/settings.json` (or `.gemini/settings.json`
in your working folder). The `context.fileName` entry makes Gemini read `AGENTS.md`. Check with
`/mcp` inside Gemini CLI.

### Any other MCP client

Streamable HTTP transport, URL `http://127.0.0.1:<PORT>/mcp`, header
`Authorization: Bearer <TOKEN>`. For a client that only starts local (stdio) programs, run Studio
itself with `--mcp-stdio` (*Copy configuration -> stdio*), or a bridge such as `mcp-remote`, as in the
Claude Desktop example.

## 3. Give your agent the skill

The skill is the folder `narraleaf-make-game/`. Copy the whole folder (not just `SKILL.md`) to where
your agent looks for skills:

| Agent | Personal (every folder) | One project |
|---|---|---|
| Claude Code | `~/.claude/skills/narraleaf-make-game/` | `.claude/skills/narraleaf-make-game/` |
| opencode | `~/.config/opencode/skill/narraleaf-make-game/` | `.opencode/skill/narraleaf-make-game/` |
| Codex CLI | `~/.codex/skills/narraleaf-make-game/` | - |
| Claude Desktop / claude.ai | zip the folder and upload it under *Settings -> Capabilities -> Skills* | - |
| Cursor, Gemini CLI, others | no skill folder needed - see below | |

**The simplest way for every agent:** start your agent *inside this folder* (`NarraLeaf-Skills`).
Agents that read `AGENTS.md` (opencode, Codex, Cursor, Gemini CLI with the setting above, and many
others) then find the pointer to the skill on their own.

**Even without any of that, the agent still gets the guide**, because Studio's MCP server serves it
itself:

- the **`make_game` prompt** - in clients that show MCP prompts (often as a slash command such as
  `/make_game`, or `/mcp__narraleaf__make_game` in Claude Code), it starts the whole workflow;
- the **`agent_guide` tool** - the agent can call it for any chapter (`workflow`, `story-format`,
  `ui-format`, `blueprint-format`, `ui-design`, `script-adaptation`, `layered-sprites`, `verify-and-ship`,
  `localization-and-voice`, `troubleshooting`);
- the same chapters as MCP resources at `narraleaf://guide/<chapter>`.

So with any MCP client, this first message works:

> Use the NarraLeaf Studio tools. Call agent_guide with chapter "workflow" and follow it to make my
> game.

## 4. Make a game

Tell your agent what you want, for example:

> Make a visual novel from the script in `~/Documents/winter-story/script.txt` with the art in
> `~/Documents/winter-story/art`. Chinese text, 1920x1080, two endings.

The agent will check the connection, go through a short brief with you, create the project from the
Skeleton template, import your assets (making labelled placeholders for anything missing), set up
characters and variables, write the story scene by scene, restyle the interface, check and playtest
every route, and build the game. You watch it happen in Studio and can step in at any point.

It can also translate a finished game into another language, scene by scene, and wire a folder of
voice recordings to the lines they belong to:

> Translate the game into English. Then link the Japanese voice recordings in
> `~/Documents/winter-story/voice-ja` and tell me which lines still have no recording.

## Troubleshooting the connection

- **The agent has no NarraLeaf tools.** Studio is closed, agent access is off, or the port/token is
  wrong. Re-copy the configuration from Studio and restart the agent.
- **"writes_disabled".** Switch on *Allow agents to change projects*.
- **"path_not_allowed" when importing.** You declined Studio's folder dialog, or have not answered it
  yet (look for it on the Studio window). Allow the folder there, or add it under *Folders agents may
  import from*.
- **The agent edits the wrong project.** With several projects open, the agent must name the project
  folder; or close the others.
