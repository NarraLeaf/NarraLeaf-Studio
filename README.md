<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/banner-md-transparent.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/banner-md-light.png">
  <img alt="narraleaf banner" src="https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/banner-md-light.png">
</picture>

# NarraLeaf-Studio

Current release line: `2.0.0-TeamBeta3`.

[![NarraLeaf Studio video](https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/studio-video.jpg)](https://www.youtube.com/watch?v=pLx5T0AdRHA)

<p align="center"><a href="https://www.youtube.com/watch?v=pLx5T0AdRHA">Watch on YouTube (2:48)</a></p>

![NarraLeaf Studio preview](https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/studio-preview-wide.png)

![NarraLeaf Studio screenshots](https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/screenshots-grid.png)

The development of visual novel engines has often been hampered by clunky interactive experiences and limited team collaboration capabilities; NarraLeaf Studio offers a more intuitive solution.

NarraLeaf Studio is an IDE designed for creating visual novels within the NarraLeaf ecosystem. It integrates story writing, UI editing, asset management, and team collaboration into a unified desktop workspace, moving the development process away from a reliance on scattered scripts, configuration files, and manual debugging workflows.

Unlike traditional lightweight editors, NarraLeaf Studio does not require users to write code or adhere to rigid interface templates to create a game. Instead, it features:
- An interface editor similar to prototyping tools, paired with a visual logic system
- An easy-to-learn, command-based story editing system that requires no knowledge of external programming languages
- WYSIWYG application previews, along with cross-platform production and packaging capabilities

## Features

- **Story editor.** A scene is a list of rows. Typing writes dialogue, a slash at the start of a row opens the command catalogue, and every value is checked as the row is typed. The flow view draws the paths the story can take. Chinese spellings of the commands parse, and plugins can contribute their own.
- **Review and placement.** The stage timeline shows the stage after every row and follows menu branches. Characters and images can be moved and resized from the story preview. Local scene snapshots and line history sit outside version control, while row comments travel with the script.
- **Script documents.** Import Word, Fountain, CSV, TSV or XLSX scenes through the paste wizard, and export a readable PDF or Word script.
- **Screens and blueprints.** The game's own screens are built by placing widgets on a surface, and over six hundred blueprint nodes decide what they do. Widgets can be saved as reusable components, and their properties bound to values that change while the game runs.
- **Version control.** History is kept inside the project folder, and differences are reported as content rather than as files: which scenes, rows, characters and assets changed. Built on [Lore](https://github.com/EpicGames/lore), with Studio's own difference view and conflict interface.
- **[NarraLeaf Team](https://github.com/NarraLeaf/NarraLeaf-Team).** A collaboration server deployed on your own network or a remote container. It holds a team project's current documents, versions, comments, reviews, to-dos and production records, gives each project owners, editors, reviewers and viewers, and serves its own web console. Studio sends edits through the server's document kernel, keeps work made offline, and reports conflicts instead of silently replacing it.
- **Asset sets.** One library entry standing for several files that differ by language or by build variant. A story row names the set, and the game uses the file that matches.
- **Build variants.** One project, several editions. A cut point row ends a variant's story there, and everything written after it, including the assets only those rows used, is left out of that variant's package.
- **Patches.** Later changes to the story, the pages, the translations, the voice lines and the assets, delivered to an installed game without reinstalling it.
- **Builds.** Windows, macOS, Linux, Web, Android and iOS, in eight formats, with each platform's icons generated from one image. Studio also builds [without an interface](#building-from-the-command-line).
- **Plugins.** Story commands, blueprint nodes, widgets, inline text effects, tests and panels, appearing in the same places as the built-in equivalents. What a plugin needs is approved when it is installed.

## Studio

### Game Compatibility

For game compatibility, see [docs/game-compatibility.md](docs/game-compatibility.md).

### Building from the command line

Studio builds a project without an interface, for a machine that has nobody at the keyboard:

```bash
narraleaf-studio --build <project>   --build-variant main   --build-target windows   --build-format nsis   --build-output ./out   --build-report ./out/build-report.json
```

`--build` takes a project folder, or a name from the recent list. One invocation produces one
variant for one platform, in one format. The window never appears and never takes focus.

| Flag | Default |
| --- | --- |
| `--build <project>` | required |
| `--build-variant <name>` | `main`, the release variant |
| `--build-target <platform>` | the host platform |
| `--build-format <format>` | the platform's first format |
| `--build-arch <arch>` | the host's architecture for a host build, `x64` for a cross build |
| `--build-output <folder>` | `<project>/dist` |
| `--build-report <file>` | no report file |
| `--build-allow-unsigned` | off |

The exit code is the contract:

| Code | Meaning |
| --- | --- |
| `0` | The build wrote its artifacts. |
| `1` | The build failed. |
| `2` | The command line could not be acted on. Nothing was opened. |
| `3` | A check refused the project, so the build never started. |
| `4` | Studio could not run the build. This says nothing about the project. |

Standard output carries the build console, in English. `--build-report` writes a JSON file holding
the outcome, the exit code, every finding, the artifacts and their sizes, and the whole log; its
values are fixed identifiers, so nothing that reads it depends on a language.

A target that can carry a code signature and has no signing credential configured is refused, and
`--build-allow-unsigned` is how a caller states that it accepts an unsigned artifact. The report's
`signing` block says whether the platform can carry a signature at all and whether this build did.

The report's `experimental` block answers the same way for experimental mode, which a development
launch enters with `--experimental` and one `--x-<id>` flag per condition. `state` is `off`, `on` or
`refused`, and `conditions` lists what the mode changed about this build — a build whose list holds
`debuggable-build` ships without asar integrity validation and is not one to distribute. Nothing
about the artifact records this, so the report is where a job finds out which kind it has.

A launch that asks for the mode and cannot have it is refused rather than built: a packaged Studio
never enters experimental mode, a `--x-` flag without `--experimental` applies to nothing, and a
`--x-` flag that names no condition asked for something that was never going to happen. All three
would otherwise hand back the opposite of what was asked for, with nobody there to read the warning.
The exit code is `2` and the report's `experimental.refusal` says which of the three it was.

## Asset protection

NarraLeaf Studio is open source, with one exception: an optional asset-protection component that is **not** open source. For details, see [docs/asset-protection.md](docs/asset-protection.md).

## Licensing and privacy

NarraLeaf Studio is licensed under the [Mozilla Public License 2.0](LICENSE). Games made with Studio belong to their authors and may be released and sold commercially at no cost; see [LICENSING.md](LICENSING.md) ([中文](LICENSING.zh-CN.md)) for what an exported game contains and what to keep when distributing it.

Studio has no telemetry. [PRIVACY.md](PRIVACY.md) ([中文](PRIVACY.zh-CN.md)) lists every connection it makes and what stays on your computer.

## Development

### Setup

Studio is developed with Node.js 22 and Yarn 4. Enable Corepack, then install the workspace dependencies:

```bash
corepack enable
yarn install
```

`@narraleaf/encryption` is published to GitHub Packages. The install needs a `read:packages` credential for the `@narraleaf` scope in `~/.yarnrc.yml`; the repository's `.yarnrc.yml` holds only the registry address.

### Running

```bash
yarn dev
yarn dev --cdp --cdp-port=9222
yarn stop
```

`--cdp` enables the Electron Chrome DevTools Protocol endpoint during development. `--cdp-port` is optional and defaults to `9222`; the main process ignores CDP flags outside development mode.

```bash
yarn dev --agent
yarn dev --agent-port=47300
```

In development, agent access follows these flags instead of Settings: `--agent` serves the agent MCP endpoint for this launch, on `--agent-port` (which implies `--agent`) or on `47219`. Without either, the endpoint stays off whatever the profile remembers, and Settings shows the switch and the port held still. A port another program holds is reported as an error; the endpoint does not move to another one. Whether agents may change projects, and full access, still come from Settings.

`yarn stop` ends the session `yarn dev` started — the dev server on port `5588` and the Electron app it spawned. Only this checkout's processes are stopped; anything else holding those ports is reported instead of killed (`--force` overrides, `--dry-run` previews). Reach for it when `yarn dev` reports that another session owns the port, which it refuses to start alongside.

### Checks

```bash
yarn verify            # everything CI's verify gate checks, then the whole test suite
yarn verify --checks   # everything but the tests, in under a minute
```

`yarn verify` runs `scripts/verify.mjs`, which is also what CI runs its checks through, so
the two cannot drift apart: the five typechecks (`yarn lint`), oxlint (`yarn lint:oxc`), the
design-system debt counter (`yarn style:ratchet`), the generated script and plugin API
declarations, the starter-template translations and the game runtime bundle, then `yarn test`.
Each of those still runs on its own by the name in brackets.

`yarn lint:oxc` runs the same type-check `yarn lint` does, through the TypeScript 7
preview oxlint type-checks with, and adds the lint rules on top. Everything in the
correctness category is a warning today and there are a few hundred of them, almost
all React effect and ref rules — so the step fails only on a type error. Raising them
to errors is a decision for when that backlog is worked down.

`yarn format` runs oxfmt over the whole repository, which currently rewrites nearly
every file: the style in `.oxfmtrc.json` is agreed but has never been applied. Do not
run it as part of ordinary work — the reformat is meant to land as one mechanical
commit, at a moment when little else is in flight, together with a
`.git-blame-ignore-revs` entry. `yarn format:check` reports the same thing without
writing.
