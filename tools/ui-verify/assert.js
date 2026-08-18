/*
 * Acceptance assertions and setup guards for UI verification runs.
 *
 * `drive.js` is mechanical — connect, click, screenshot, evaluate — and decides nothing. This layer
 * is the part that decides, and everything in it exists because a measurement lied at least once
 * during an earlier acceptance round. The comments say which, because the shape of each mistake is more useful
 * than the rule it produced.
 *
 * The rules, in short:
 *  - find controls by ACCESSIBLE NAME, never by coordinate;
 *  - before measuring anything, prove the thing under test is on screen AND reachable, and throw
 *    rather than return a clean bill of health from a probe that looked at nothing;
 *  - `document.hidden` must be false, or every layout and timing read is fiction;
 *  - when a check fails, suspect the check first — every assertion prints what it actually saw.
 */

const path = require("path");
const { execFileSync } = require("child_process");

const FOCUS_PS1 = path.join(__dirname, "focus.ps1");

/** Window titles the Electron app uses, for `raiseWindow` / `assertVisible`. */
const WINDOWS = {
  launcher: "NarraLeaf - launcher",
  workspace: "NarraLeaf - workspace",
  devmode: "NarraLeaf - dev-mode"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- running the checks --------------------------------------------------------------------------

/**
 * A run of assertions. `check` records and prints; `summary` reports green/red counts and exits
 * non-zero when anything is red, so a scenario is a command whose exit code means something.
 */
function createRun() {
  const results = [];
  const notes = [];
  return {
    results,
    notes,
    /** @param {string} id @param {string} description @param {boolean} pass @param {unknown} saw */
    check(id, description, pass, saw) {
      results.push({ id, description, pass: Boolean(pass), saw });
      const shown = typeof saw === "string" ? saw : JSON.stringify(saw);
      console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${description}\n        saw: ${shown}`);
    },
    note(message) {
      notes.push(message);
    },
    summary() {
      const red = results.filter((r) => !r.pass);
      console.log("\n--- summary ---");
      console.log(`${results.length - red.length} green / ${red.length} red`);
      for (const r of red) console.log(`  RED  ${r.id}  ${r.description}`);
      for (const n of notes) console.log(`  note ${n}`);
      return { total: results.length, red: red.length, results, notes };
    }
  };
}

// --- the window has to actually be visible --------------------------------------------------------

/**
 * The launch switch that makes all of this cheap. Part of the recipe in `scenarios/_drive.js`.
 *
 * Chromium's Windows occlusion calculator is what turns a covered window into `document.hidden`.
 * Measured on this machine: a fully covered window flips to hidden at ~2.1s without the switch and
 * stays visible for the whole probe with it. So an instance launched with it can be measured while
 * it sits behind the operator's editor, and acceptance never has to touch the foreground.
 */
const OCCLUSION_SWITCH = "--disable-features=CalculateNativeWinOcclusion";

/** Set once we force-foreground anything, so the z-order side effects get swept on the way out. */
let forcedAnything = false;

/**
 * Ask the OS to make a window measurable.
 *
 * Default mode un-minimizes WITHOUT activating and unpins anything an older run left in the
 * always-on-top band; it cannot move the foreground. `force: true` additionally raises and takes
 * the foreground, for scenarios that need real physical input — it is not needed to measure, and
 * the PowerShell side refuses it outright when the window sits on another virtual desktop.
 *
 * `windowsHide` is load-bearing: without it the spawned console takes the foreground itself and
 * undoes the raise it was spawned to perform, which is what made the old retry loop strictly worse
 * than a single attempt.
 *
 * Scoped by pid AND exact title on purpose — this machine routinely has another session's Studio
 * running, all of them titled `NarraLeaf - workspace`. Without a pid the script does the one thing
 * that is safe on a stranger's window (drop it out of the topmost band) and refuses the rest.
 */
function raiseWindow(
  title,
  procId,
  { force = false, off = false, allowDesktopSwitch = false } = {}
) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    FOCUS_PS1,
    "-Title",
    title
  ];
  if (procId) args.push("-ProcId", String(procId));
  if (force) args.push("-Force");
  if (allowDesktopSwitch) args.push("-AllowDesktopSwitch");
  if (off) args.push("-Off");
  if (force) forcedAnything = true;
  return execFileSync("powershell.exe", args, { encoding: "utf8", windowsHide: true }).trim();
}

/**
 * Drop every window of the instance out of the always-on-top band.
 *
 * Registered on `exit` the moment anything is forced, because the failure that made this necessary
 * was not a bug in a scenario: it was scenarios ending — normally, or by throwing — and leaving a
 * Studio window pinned over the operator's work with nothing left running to unpin it.
 */
function releaseWindows(procId = process.env.NLS_VERIFY_PID) {
  // `-Off` unpins every window of the process regardless of title, so one call covers all three.
  try {
    return raiseWindow(WINDOWS.workspace, procId, { off: true });
  } catch {
    return null;
  }
}

process.on("exit", () => {
  if (forcedAnything) releaseWindows();
});

/**
 * Hard guard: refuse to measure a backgrounded window.
 *
 * The cheap path is the whole point — with `OCCLUSION_SWITCH` on the launch line `document.hidden`
 * is already false and nothing is spawned, nothing is raised, and the operator's foreground is left
 * alone. Only a MINIMIZED window still reports hidden with the switch on, and un-minimizing needs
 * no foreground, so that is all the fallback does. It runs ONCE: re-running it cannot help, and the
 * old `i % 4` loop meant up to six foreground grabs per call across a dozen calls per scenario.
 *
 * Set `NLS_VERIFY_ALLOW_FOCUS=1` to let the guard escalate to a real raise. That is for driving
 * physical input, not for measuring, and it will still refuse to switch virtual desktops.
 */
async function assertVisible(driver, windowTitle, procId = process.env.NLS_VERIFY_PID) {
  if (!(await driver.evaluate("document.hidden"))) return true;
  if (!windowTitle) {
    throw new Error(
      "document.hidden === true and no window title was given — refusing to measure a backgrounded window"
    );
  }

  for (const force of process.env.NLS_VERIFY_ALLOW_FOCUS === "1" ? [false, true] : [false]) {
    try {
      raiseWindow(windowTitle, procId, { force });
    } catch {
      /* best effort */
    }
    for (let i = 0; i < 8; i += 1) {
      await sleep(500);
      if (!(await driver.evaluate("document.hidden"))) return true;
    }
  }

  const lines = [
    `document.hidden === true for "${windowTitle}" — refusing to measure a backgrounded window.`,
    `        Launch the instance with ${OCCLUSION_SWITCH} so a covered window stays measurable,`,
    "        or un-minimize it. Acceptance deliberately no longer steals the foreground to fix this."
  ];
  if (!procId) {
    lines.push(
      "        NLS_VERIFY_PID is unset, so the un-minimize fallback refused to act: with no pid it" +
        " would have matched another session's Studio by title."
    );
  }
  throw new Error(lines.join("\n"));
}

// --- finding and reaching controls ---------------------------------------------------------------

/** Evaluate a function in the page with JSON-serialisable arguments. */
function call(driver, fn, ...args) {
  return driver.evaluate(`(${fn.toString()}).apply(null, ${JSON.stringify(args)})`);
}

/**
 * Rect + reachability of the nth element whose accessible-ish name matches.
 *
 * `reachable` is the part that matters: a rect can be perfectly normal while the element sits under
 * a floating panel, or scrolled out of a virtualised list. `elementFromPoint` is the only way to
 * tell, and the two causes are reported separately — conflating "scrolled past" with "covered"
 * produced a guard failure that read as an occlusion bug for half an hour.
 */
const PROBE = function (selector, nameRe, flags, nth) {
  const re = new RegExp(nameRe, flags || "");
  const matches = [];
  document.querySelectorAll(selector).forEach((el) => {
    const name =
      el.getAttribute("aria-label") ||
      el.getAttribute("data-tip") ||
      el.getAttribute("title") ||
      (el.textContent || "").trim().replace(/\s+/g, " ");
    if (re.test(name)) matches.push(el);
  });
  const el = matches[nth || 0];
  if (!el) return { found: false, count: matches.length };
  const r = el.getBoundingClientRect();
  const onScreen = r.y >= 0 && r.y + r.height <= innerHeight && r.width > 0;
  const cx = Math.round(r.x + r.width / 2);
  const cy = Math.round(r.y + r.height / 2);
  const hit = onScreen ? document.elementFromPoint(cx, cy) : null;
  return {
    found: true,
    count: matches.length,
    x: r.x,
    y: r.y,
    w: r.width,
    h: r.height,
    cx,
    cy,
    onScreen,
    reachable: onScreen && Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el))),
    why: onScreen
      ? `elementFromPoint hit ${hit && hit.tagName}`
      : "outside the viewport (scrolled, not covered)"
  };
};

function probe(driver, selector, nameRe, flags, nth) {
  return call(driver, PROBE, selector, nameRe, flags || "", nth || 0);
}

/**
 * Click the nth control matching selector + accessible name.
 *
 * Waits for the rect to be identical on two consecutive reads (no tween in flight) and refuses to
 * click something it cannot reach, with the reason. Never falls back to a coordinate.
 */
async function clickNamed(driver, selector, nameRe, options = {}) {
  const { flags = "", nth = 0, tries = 25, dx = 0, dy = 0 } = options;
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    const now = await probe(driver, selector, nameRe, flags, nth);
    if (!now.found) {
      last = now;
      await sleep(200);
      continue;
    }
    if (last && last.found && last.x === now.x && last.y === now.y && last.w === now.w) {
      if (!now.reachable) throw new Error(`unreachable: "${nameRe}" — ${now.why}`);
      await driver.click(now.cx + dx, now.cy + dy);
      return now;
    }
    last = now;
    await sleep(150);
  }
  throw new Error(
    `clickNamed timed out for "${nameRe}" (${selector}); last=${JSON.stringify(last)}`
  );
}

/** Scroll a virtualised list so the nth matching row is centred, then confirm it is reachable. */
async function scrollIntoViewAndProbe(driver, selector, nth) {
  await call(
    driver,
    function (sel, i) {
      const rows = Array.from(document.querySelectorAll(sel)).sort(
        (a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y
      );
      if (rows[i]) rows[i].scrollIntoView({ block: "center" });
      return true;
    },
    selector,
    nth
  );
  await sleep(700);
  return call(
    driver,
    function (sel, i) {
      const rows = Array.from(document.querySelectorAll(sel)).sort(
        (a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y
      );
      const el = rows[i];
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.x + r.width * 0.6);
      const cy = Math.round(r.y + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return { found: true, cx, cy, reachable: Boolean(hit && el.contains(hit)) };
    },
    selector,
    nth
  );
}

// --- advancing a running story --------------------------------------------------------------------

/**
 * Click the stage until `pattern` shows on it.
 *
 * Never advance by a fixed click count: how many clicks it takes to leave a `/repeat` depends on how
 * many of its rounds the run has already consumed, and a guessed count silently reads the wrong
 * state. Waiting for the scene to be ON STAGE before the first click matters too — otherwise the
 * change-waiter counts the scene appearing as "my click advanced the story" and every later step is
 * one behind.
 */
async function advanceUntil(driver, pattern, what, options = {}) {
  const { maxClicks = 12, at = [500, 500], settleMs = 1100 } = options;
  const stage = () =>
    call(driver, function () {
      const tabs = document.querySelector('[role="tablist"]');
      const panelText = tabs ? tabs.parentElement.innerText || "" : "";
      return (document.body.innerText || "")
        .replace(panelText, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
    });
  for (let i = 0; i < maxClicks; i += 1) {
    if (pattern.test(await stage())) return;
    await driver.click(at[0], at[1]);
    await sleep(settleMs);
  }
  if (!pattern.test(await stage())) {
    throw new Error(
      `SETUP GUARD: never reached ${what} after ${maxClicks} clicks; stage="${await stage()}"`
    );
  }
}

// --- style measurements ---------------------------------------------------------------------------

/** WCAG relative luminance of an `rgb()` / `rgba()` string. */
function luminance(color) {
  const m = String(color).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1]
    .split(",")
    .slice(0, 3)
    .map((v) => Number(v.trim()) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, or null when either cannot be parsed. */
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Alpha of a CSS colour string; a bare `rgb()` is opaque, an unparseable one is transparent. */
function alphaOf(color) {
  const m = String(color).match(/rgba?\(([^)]+)\)/);
  if (!m) return 0;
  const parts = m[1].split(",");
  return parts.length === 4 ? parseFloat(parts[3]) : 1;
}

/**
 * The reading surface of a panel identified by its header text.
 *
 * Three versions of this were wrong before it settled, and all three passed or failed for reasons
 * that had nothing to do with the app:
 *  - climbing a fixed number of parents lands on the whole window, so "the panel does not contain X"
 *    became "the entire app does not contain X";
 *  - anchoring on the panel's body text cannot measure a panel that is legitimately EMPTY, and
 *    "nothing to measure" is not the same answer as "opaque";
 *  - walking up to the nearest opaque ancestor finds the panel's own HEADER strip, which is opaque
 *    while the body it heads is transparent.
 * So: find the rail by SHAPE, then measure the `.nl-editor-surface` inside it if there is one —
 * that inner element is what actually paints; the outer wrapper can carry `bg-surface` in its class
 * list and still compute to rgba(0,0,0,0).
 */
const PANEL_SURFACE = function (headerText, surfaceSelector) {
  const header = Array.from(document.querySelectorAll("*")).find(
    (e) => (e.textContent || "").trim() === headerText && e.children.length === 0
  );
  if (!header) return { ok: false, why: `no panel headed "${headerText}" is open` };
  let rail = null;
  let n = header;
  for (let i = 0; i < 12 && n; i += 1) {
    const r = n.getBoundingClientRect();
    if (
      r.width >= 220 &&
      r.width <= 760 &&
      r.height > innerHeight * 0.4 &&
      r.x > innerWidth * 0.45
    ) {
      rail = n;
      break;
    }
    n = n.parentElement;
  }
  if (!rail) return { ok: false, why: `could not identify the rail around "${headerText}"` };
  const surface = rail.querySelector(surfaceSelector) || rail;
  const cs = getComputedStyle(surface);
  const r = surface.getBoundingClientRect();
  return {
    ok: true,
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    cls: String(surface.className).slice(0, 70),
    viaSurface: surface !== rail,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    text: (rail.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600)
  };
};

function panelSurface(driver, headerText, surfaceSelector = ".nl-editor-surface") {
  return call(driver, PANEL_SURFACE, headerText, surfaceSelector);
}

/** Visible leaf elements whose text does not fit its own box (`scrollWidth > clientWidth`). */
const TRUNCATED_LABELS = function () {
  return Array.from(document.querySelectorAll("*"))
    .filter((e) => {
      if (e.children.length) return false;
      if (!(e.textContent || "").trim()) return false;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.y < 0 || r.y > innerHeight) return false;
      return e.scrollWidth > e.clientWidth + 1;
    })
    .map((e) => ({
      text: (e.textContent || "").trim().slice(0, 40),
      width: Math.round(e.getBoundingClientRect().width)
    }));
};

/**
 * Visible buttons with no accessible name.
 *
 * A `role="switch"` or `role="checkbox"` wrapped in its own `<label>` is named by that label — the
 * correct pattern, not the icon-button-with-no-name this is looking for. Counting those kept an
 * assertion permanently red against a control that was already accessible.
 */
const NAMELESS_CONTROLS = function () {
  return Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter((b) => {
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const role = b.getAttribute("role");
      if (b.closest("label") && (role === "switch" || role === "checkbox")) return false;
      return !(
        b.getAttribute("aria-label") ||
        b.getAttribute("data-tip") ||
        b.getAttribute("title") ||
        b.getAttribute("aria-labelledby") ||
        (b.textContent || "").trim()
      );
    })
    .map((b) => {
      const r = b.getBoundingClientRect();
      return {
        cls: String(b.className).slice(0, 50),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
      };
    });
};

/** Scene-flow graph readings: per-node CSS font, the viewport zoom, and the effective rendered size. */
const SCENE_GRAPH = function () {
  const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
  const viewport = document.querySelector(".react-flow__viewport");
  const pane = document.querySelector(".react-flow__pane") || document.querySelector(".react-flow");
  if (!nodes.length || !viewport || !pane) {
    return {
      ok: false,
      why: `nodes=${nodes.length} viewport=${Boolean(viewport)} pane=${Boolean(pane)}`
    };
  }
  const m = getComputedStyle(viewport).transform.match(/matrix\(([^,]+)/);
  const zoom = m ? Number(m[1]) : null;
  const pr = pane.getBoundingClientRect();
  return {
    ok: true,
    zoom,
    nodes: nodes.map((node) => {
      const r = node.getBoundingClientRect();
      const runs = Array.from(node.querySelectorAll("*")).filter((e) =>
        (e.textContent || "").trim()
      );
      const cssFont = runs.length
        ? Math.max(...runs.map((e) => parseFloat(getComputedStyle(e).fontSize) || 0))
        : 0;
      return {
        label: (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
        cssFont,
        // What the eye gets: the graph is inside a scaled viewport, so CSS px is not px.
        renderedFont: zoom ? Math.round(cssFont * zoom * 10) / 10 : null,
        insidePane:
          r.x >= pr.x - 2 &&
          r.y >= pr.y - 2 &&
          r.x + r.width <= pr.x + pr.width + 2 &&
          r.y + r.height <= pr.y + pr.height + 2
      };
    })
  };
};

module.exports = {
  WINDOWS,
  OCCLUSION_SWITCH,
  sleep,
  createRun,
  raiseWindow,
  releaseWindows,
  assertVisible,
  call,
  probe,
  clickNamed,
  scrollIntoViewAndProbe,
  advanceUntil,
  luminance,
  contrastRatio,
  alphaOf,
  panelSurface,
  // page-side readers, for scenarios that want them raw
  PROBE,
  PANEL_SURFACE,
  TRUNCATED_LABELS,
  NAMELESS_CONTROLS,
  SCENE_GRAPH
};
