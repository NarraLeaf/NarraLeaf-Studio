<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/banner-md-transparent.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/banner-md-light.png">
  <img alt="narraleaf banner" src="https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/banner-md-light.png">
</picture>

# NarraLeaf-Studio

![NarraLeaf Studio preview](https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/studio-preview-wide.png)

![NarraLeaf Studio screenshots](https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/screenshots-grid.png)

> This project is currently in the early stages of development.

The development of visual novel engines has often been hampered by clunky interactive experiences and limited team collaboration capabilities; NarraLeaf Studio offers a more intuitive solution.

NarraLeaf Studio is an IDE designed for creating visual novels within the NarraLeaf ecosystem. It integrates story writing, UI editing, asset management, and team collaboration into a unified desktop workspace, moving the development process away from a reliance on scattered scripts, configuration files, and manual debugging workflows.

Unlike traditional lightweight editors, NarraLeaf Studio does not require users to write code or adhere to rigid interface templates to create a game. Instead, it features:
- An interface editor similar to prototyping tools, paired with a visual logic system
- An easy-to-learn, command-based story editing system that requires no knowledge of external programming languages
- WYSIWYG application previews, along with cross-platform production and packaging capabilities

## Studio

### NarraLeaf Team

[NarraLeaf Team](https://github.com/NarraLeaf/NarraLeaf-Team) is the collaboration solution for NarraLeaf Studio. It deploys easily onto a device on your own network or a remote container, and gives everyone on the team central version management and real-time collaboration (in development). With Team, creators sync the team's projects and start working right away.

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
| `--build-variant <id>` | `main`, the release variant |
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

## Development

### Setup

### Development

```bash
yarn dev
yarn dev --cdp --cdp-port=9222
yarn stop
```

`--cdp` enables the Electron Chrome DevTools Protocol endpoint during development. `--cdp-port` is optional and defaults to `9222`; the main process ignores CDP flags outside development mode.

`yarn stop` ends the session `yarn dev` started — the dev server on port `5588` and the Electron app it spawned. Only this checkout's processes are stopped; anything else holding those ports is reported instead of killed (`--force` overrides, `--dry-run` previews). Reach for it when `yarn dev` reports that another session owns the port, which it refuses to start alongside.

### Checks

```bash
yarn lint          # typecheck, five projects
yarn lint:oxc      # oxlint, type-aware
yarn style:ratchet # design-system debt counter
yarn test
```

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
