<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/banner-md-transparent.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/banner-md-light.png">
  <img alt="narraleaf banner" src="https://raw.githubusercontent.com/NarraLeaf/.github/refs/heads/master/doc/banner-md-light.png">
</picture>

# NarraLeaf-Studio

All-in-one IDE for NarraLeaf Projects.

## Features

### Game Compatibility

For game compatibility, see [docs/game-compatibility.md](docs/game-compatibility.md).

### Planned Features

- [ ] Launcher
- [ ] Workspace
  - [x] Assets Manager
    - [x] Magic Tags
    - [x] Asset Groups
    - [x] Asset Explorer
    - [ ] Asset Compression
    - [x] Remote Assets
  - [x] Character Manager
  - [ ] Scene Editor
  - [ ] Script Editor
  - [ ] Visual Graph Manager
  - [ ] UI Editor
    - [x] Surface Manager
    - [ ] Surface Editor
      - [ ] Element Outline
      - [ ] Base Elements
        - [ ] Rectangle
          - [ ] MultiState
        - [ ] Text
        - [ ] Circle
        - [ ] Video
        - [ ] Container
          - [ ] Flex Layout
          - [ ] Grid Layout
          - [ ] Scroll View
      - [ ] Game Elements
        - [ ] List View
        - [ ] Grid View
      - [ ] Behavior Graph Editor
      - [ ] Docker Bar
    - [ ] Template
  - [ ] Dev Mode
    - [ ] Dev Mode Window (isolated, single instance)
    - [ ] Global Dev Session Task (no multi-window)
    - [ ] Launch Entry
      - [ ] Start from Surface (default: main surface)
      - [ ] Start from Story Line (script + line)
      - [ ] Extensible entry actions (future extensions/plugins)
    - [ ] Main Surface
      - [ ] Default generated App Surface with fixed id `narraleaf-studio:main-surface`
      - [ ] Not deletable / not renamable
    - [ ] Surface Rendering
      - [ ] Stage Surface can link any App Surface (shared document, shared element tree)
      - [ ] Surface link resolution by `surfaceId`
    - [ ] IPC Bridge (main-process forwarded channel)
      - [ ] Push UI document / graphs / scripts / settings bundles
      - [ ] Versioned payload revisions + reload control messages
      - [ ] Extensible payload types for future runtime features
    - [ ] Live Preview (reload on updates)
      - [ ] Reload UI document & scripts
      - [ ] Attempt to rollback story state (checkpoint-based, future)
    - [ ] nlang Compile Pipeline (extensible)
      - [ ] Compiler interface + diagnostics
      - [ ] Compile step integrated into Dev Mode launch
    - [ ] Debugger
  - [ ] Build & Publish
  - [ ] Version Control

## Development

### Setup

### Development