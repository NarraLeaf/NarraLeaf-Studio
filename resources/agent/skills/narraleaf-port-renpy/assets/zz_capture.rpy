# Reference capture for porting. NOT part of the game.
#
# Copy the game to a working folder (leave game/saves and game/cache out), put this file in the
# copy's game/ folder, set CAP_DIR, and run the copy with the Ren'Py SDK:
#     <sdk>/renpy.sh <copy>          (renpy.exe / renpy.app on other systems)
# It replaces the splash screen, shows each screen in SCREENS for a moment, saves a screenshot at the
# game's resolution, optionally hovers one point and saves again, then quits. Story moments are
# captured by STORY_LABEL with auto-forward on. A window opens while it runs; keep runs short.
# If it stops, read traceback.txt in the copy.
#
# Adjust SCREENS to the screens the game defines (screens.rpy) and their arguments.

define config.save_directory = "porting-reference-capture"   # never touch the player's saves

init python:
    import os

    CAP_DIR = "/absolute/path/to/your/working/folder/reference"   # set this
    W, H = config.screen_width, config.screen_height

    # (name, screen, keyword arguments, optional (x, y) to hover for a second shot)
    SCREENS = [
        ("main_menu", "main_menu", {}, None),
        ("preferences", "preferences", {}, None),
        ("save", "save", {}, None),
        ("load", "load", {}, None),
        ("history", "history", {}, None),
        ("choice", "choice", {"items": None}, None),          # filled below
        ("confirm", "confirm", {"message": "Are you sure?", "yes_action": NullAction(), "no_action": NullAction()}, None),
        ("notify", "notify", {"message": "A notification"}, None),
        ("quick_menu", "quick_menu", {}, None),
    ]
    # Dialogue is captured from real say statements, because the say screen shown on its own lacks the
    # speaker's styles. (character variable name or None for the narrator, text, file name)
    SAY_LINES = [
        ("e", "A long line of dialogue that is long enough to show where the text wraps inside the box.", "say"),
        (None, "A line of narration with no speaker.", "say_narrator"),
    ]
    STORY_LABEL = None        # e.g. "chapter_3" to capture the first lines of a label
    STORY_SHOTS = 8

    if not os.path.isdir(CAP_DIR):
        os.makedirs(CAP_DIR)

    config.label_overrides["splashscreen"] = "zz_capture"

    def cap(name):
        data = renpy.screenshot_to_bytes((W, H))
        with open(os.path.join(CAP_DIR, name + ".png"), "wb") as f:
            f.write(data)

    class CapItem(object):
        """Stands in for a menu entry so the choice screen can be shown without a menu."""
        def __init__(self, caption):
            self.caption = caption
            self.action = NullAction()
            self.chosen = False
            self.args = ()
            self.kwargs = {}

    for i, entry in enumerate(SCREENS):
        if entry[1] == "choice":
            SCREENS[i] = (entry[0], entry[1], {"items": [CapItem("First option"), CapItem("Second option")]}, entry[3])

    def hover_at(x, y):
        # Move the pointer there and post a motion event so the screen's hover styles apply.
        import pygame_sdl2 as pg
        renpy.set_mouse_pos(x, y)
        pw, ph = renpy.get_physical_size()
        px, py = int(x * pw / float(W)), int(y * ph / float(H))
        pg.event.post(pg.event.Event(pg.MOUSEMOTION, pos=(px, py), rel=(1, 1), buttons=(0, 0, 0), touch=False, which=0, window=None))

    # Story capture: one screenshot each time a line has finished showing. The frame saved is the last
    # one drawn, so compare each shot with its line; drop a black first shot.
    zz_count = [0]
    def zz_story_cb(event, interact=True, **kwargs):
        if STORY_LABEL and event == "show_done" and interact:
            zz_count[0] += 1
            cap("story_%03d" % zz_count[0])
            if zz_count[0] >= STORY_SHOTS:
                renpy.quit()
    config.all_character_callbacks.append(zz_story_cb)

screen zz_cap_wrap(name, hx=None, hy=None):
    zorder 500
    timer 1.2 action Function(cap, name)
    if hx is not None:
        timer 1.3 action Function(hover_at, hx, hy)
        timer 2.0 action Function(cap, name + "_hover")
    timer 2.2 action Return()

label zz_capture:
    # Silence and instant text so captures are quick and deterministic.
    $ preferences.set_mixer("music", 0.0)
    $ preferences.set_mixer("sfx", 0.0)
    $ preferences.set_mixer("voice", 0.0)
    $ preferences.text_cps = 0
    python:
        for name, scr, kw, hover in SCREENS:
            if not renpy.has_screen(scr):
                continue
            renpy.show_screen(scr, _tag="zz_target", **kw)
            if hover:
                renpy.call_screen("zz_cap_wrap", name=name, hx=hover[0], hy=hover[1])
            else:
                renpy.call_screen("zz_cap_wrap", name=name)
            renpy.hide_screen("zz_target")
    python:
        # Show each line without waiting for a click, then let the timed screen capture it.
        for who, what, name in SAY_LINES:
            renpy.say(getattr(store, who) if who else None, what, interact=False)
            renpy.call_screen("zz_cap_wrap", name=name)
    # Auto-forward moves the story capture on after each screenshot.
    $ preferences.afm_time = 1
    $ preferences.afm_enable = True
    $ quick_menu = True
    if STORY_LABEL:
        $ renpy.jump(STORY_LABEL)
    $ renpy.quit()
