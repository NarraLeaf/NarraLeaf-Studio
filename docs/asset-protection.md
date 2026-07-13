# Asset protection

NarraLeaf Studio can optionally protect the files in a packaged game.

Asset protection is provided by a component that is **not** open source, even
though NarraLeaf Studio itself is. Only this protection layer is kept closed.

## What it does

- When you enable protection, your game's files are encrypted at the moment the
  game is **packaged** (and during preview, which uses the same runtime).
- The packaged game can read its own files while it runs, but there is **no
  officially supported way** to turn the packaged files back into the originals.
- The files inside your Studio project are **never changed**. Protection applies
  only to the output that ships to players.

## Why it exists

The goal is modest and practical: to reduce the cases where a game's assets (art,
audio, script, and so on) are casually extracted from a shipped build and
redistributed.

It is not meant to be unbreakable. Like any client-side protection, someone who
fully reverse-engineers a shipped game can still recover its content. 

## Turning it on or off

Protection is **optional** and **off by default**. You can change it per project
in Studio under **Project Settings**. Dev Mode is never affected.
