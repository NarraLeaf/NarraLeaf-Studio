# Positions and ATL

Ren'Py and NarraLeaf place things differently. Convert by **simulating Ren'Py's placement in your
converter and emitting the result**, not by mapping keywords.

## Ren'Py's model

For a displayable of drawn size `w × h` inside an area `W × H` (the screen, for the stage):

```
left = pos(xpos, W) - pos(xanchor, w) + xoffset
top  = pos(ypos, H) - pos(yanchor, h) + yoffset
pos(v, total) = v * total   if v is a float (a fraction)
              = v           if v is an int (pixels)
```

- `xalign v` sets `xpos = xanchor = v`; `align (x, y)`, `pos (x, y)`, `anchor (x, y)`, `xycenter`
  are tuple forms.
- `zoom`, `xzoom`, `yzoom` scale `w` and `h` before the anchor is applied.
- Defaults for `show` with no `at`: `xpos 0.5, xanchor 0.5, ypos 1.0, yanchor 1.0` (bottom centre).
- The game's own `transform left / center / right` etc. usually override `yanchor` (a value like
  0.6 puts tall sprites partly below the screen edge). Read the game's definitions; never assume
  Ren'Py's stock values.

Keep a per-tag transform state in the stage model; `show x at t` replaces the properties `t` sets
and keeps the rest (unless the game uses `default` transforms that reset).

## NarraLeaf's model

Check `story_command {token:"/transform"}` for the exact grammar of your Studio version. As of this
writing:

- `pos=x,y` places the object's **centre**. `x` is a share of the stage width from the left edge;
  `y` is a share of the stage height **from the bottom edge**, up. `pos=left|center|right` are
  0.25 / 0.5 / 0.75 across at mid-height. Values slightly outside 0..1 are allowed (slide-ins);
  pixel numbers are refused.
- If the catalogue lists `xoffset=` / `yoffset=`, they add design pixels on top of `pos`; otherwise
  fold offsets into the fractions yourself.
- There is no anchor: compute the centre.
- `zoom=` scales about the centre; `d=` and `ease=` animate a change.
- `/bg` draws the background at native pixels, centred, unscaled.
- A character's **entrance transform** (set with `character_upsert`) applies under every `/show`
  and `/transform` of that character.

## Converting a placement

```
w, h   = drawn size after zoom
cx     = left + w / 2
cy     = top  + h / 2
pos.x  = cx / W
pos.y  = 1 - cy / H          # y up from the bottom
```

For a character with an entrance offset, subtract it before converting (`cy - entranceYOffset`),
because Studio adds it back.

## Sprites

Find the y offset that puts a sprite exactly where Ren'Py's default sprite position puts it:

1. Compute Ren'Py's `top` for the most common sprite size at the game's default sprite transform.
2. Studio's `pos=center` puts the centre at mid-height, i.e. `top = H/2 - h/2`.
3. The entrance `yoffset` is the difference (negative = up, in the stage's y direction - verify the
   sign with one screenshot).
4. Set it once per character size class with `character_upsert` (`entranceTransform`), then
   `/show <name> <pose> pos=center` matches Ren'Py `at center`, and `pos=x,0.5` keeps the baseline.

Verify with `playtest_screenshot` against a Ren'Py capture of the same line; a correct baseline is
pixel-exact.

## Transitions

| Ren'Py | Studio |
|---|---|
| `dissolve`, `Dissolve(t)` | fade with `d=t` |
| `fade`, `Fade(out, hold, in)` | a fade through black: the background row's fade, or a black `/bg` between |
| `pixellate`, `wipeleft`, `ImageDissolve(mask)` | the closest transition `story_command /bg` lists; log the change |
| `vpunch` / `hpunch` | a camera shake: `/transform camera pos=0.5,0.52 d=0.05`, back to `0.5,0.5`, a few times |

## ATL

Turn each `transform` the game uses into Studio rows by **interpreting its ATL**, game by game:

- A static block (`xalign .3 yalign .2 zoom .8`) → initial placement (`pos`, `zoom`).
- `linear t prop v` / `ease t …` / `easein` / `easeout` → `/transform … d=t ease=…` (map Ren'Py's
  ease names: `ease` → easeInOut, `easein` → easeOut-like start, `easeout` → easeIn-like start;
  check the visual once).
- `repeat` around a back-and-forth → a repeated or looping transform if the catalogue offers one;
  otherwise unroll a small fixed count and log it.
- `parallel` blocks → the parts on one row when Studio can animate them together, else sequential
  rows.
- `alpha`, `blur`, `matrixcolor` (greyscale, tint) → Studio's opacity / filter params where they
  exist; a colour matrix on a still image is usually best **pre-rendered** offline (assets chapter).
- `on show / on hide` → put the motion on the `/show` / `/hide` row.
- Transforms on **video** cannot be expressed: Studio does not transform videos. Bake zoom and
  placement into the video file (assets chapter); `/transform camera` still moves everything.

Tabulate every transform with its use count; port the frequent ones exactly and log what the rare
ones lost.
