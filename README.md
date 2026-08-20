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
