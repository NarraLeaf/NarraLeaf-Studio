# Surface layers

A layer is a Page composited over whatever is already on screen, instead of replacing it.

Before layers the app surface system was a router: `navStack` held history, and at rest exactly one
entry was on screen. Two entries coexisted only while a transition was running. A screen that had to
appear *over* another one - a confirmation, a panel raised from a settings page - had no way to say
so, and every feature that wanted one added a hard-coded z-index of its own.

## The composite

Bottom to top:

| | |
|---|---|
| stage | the NarraLeaf `Player`, engine-owned |
| plugin overlays | host-rendered, fixed |
| page lane | the whole navigation stack, occupying one slot |
| layers | in mount order |

The page lane keeps its own rules unchanged: back and forward move inside it, one entry settles at
rest. A layer replaces nothing, so it is held beside the lane rather than inside it.

## Three rules that do not bend

**Layers are never named.** Stacking order is mount order. There is no layer registry, no `onlayer`
argument, no author-visible z number. "Always on top" is a property of being mounted last, and
modality is a property of the layer, not of a stratum it was filed under.

**Every layer has an owner and dies with it.** `ownerScopeId` is the scope of the blueprint that
mounted it. When that scope closes - the page leaves, the layer that mounted it closes - its layers
go too. Forgetting to unmount cannot produce an orphan.

**Exactly one thing owns the keyboard.** It is resolved in one place, `resolveCompositeInput`, and
the Dev Mode composite panel shows which one it is. Nothing else may decide it.

## What is not a layer

The engine's Game UI - dialog, menu, notification, NVL - renders inside the `Player`, and the host
has a single injection point in there which already sits above the dialogue. There is no DOM
position under it to occupy, so those four cannot join the composite and must not be modelled as
layers.

## Input

Two questions, deliberately separate, because a single "is this the active screen" flag cannot
answer both once more than one thing is live:

- **Pointer.** The topmost modal layer is a floor. Everything below it, the whole page lane
  included, is inert; it and everything above it stay live.
- **Keyboard.** The topmost *modal* layer owns it - not the topmost layer. With a modal below a
  non-modal, both are clickable and the keys still belong to the modal underneath, because it is the
  one that asked for them.

With no layers mounted both reduce to the rule the page lane always had, and a page behaves exactly
as it did before layers existed.

### The scrim is decoration

A modal's dimming sheet does not capture pointer events. What stops a click from reaching the page
underneath is that the page is inert. A layer that covers only part of the screen is still modal in
the sense that matters; do not add a full-screen catcher and do not assume the sheet is the barrier.

## Lifetime

Layers are never serialised. A save carries none, a load lands with an empty stack, and pending
waits settle rather than stranding a graph mid-call. A HUD that must survive a load therefore
belongs to the On-Stage Game UI, not to a layer.

## Leaving the screen

A layer's departure is the only signal that frees its exclusive group, so a layer that starts
leaving must always finish. `SurfaceAnimationLayer` owns its own exit rather than delegating to the
presence group it sits in: one unreported registrant anywhere beneath it would otherwise hold the
group open forever, and a mounted-but-unrenderable layer would never report at all. A planned-end
fallback backs up the animation, so the group drains even when nothing animates.

## Author surface

| Node | |
|---|---|
| `Go Page` | replace the current page |
| `Go back` | close the top dismissible layer if there is one, otherwise step back a page |
| `Show Layer` | composite a Page over what is there; returns a handle |
| `Hide Layer` | remove one by handle |
| `Wait For Layer` | wait for it to close and read what it returned |
| `Close This Layer` | called from inside a layer, with a result |
| `Is Layer Mounted` | whether a handle still names a live layer |

One node and one wire is enough to stack a Page: `Show Layer`, pick the page, run an exec line into
it. A layer reads what it was opened with through `Get Page Prop`, exactly as a page does.
