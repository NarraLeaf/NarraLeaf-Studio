/*
 * Acceptance — language, empty states, number tiles, reading surfaces, accessible names.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> \
 *     node tools/ui-verify/scenarios/u5-language-and-empty-states.js [--phase catalogue|inspector|dashboard|surface|names|timeline|all]
 *
 * Calibrated red against the pre-change tree (10 red / 1 green). Three of those reds were the
 * probe's fault rather than the app's, and the comments below say which — a criterion nobody has
 * seen fail is a criterion nobody has tested.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const A = require("../assert");
const D = require("./_drive");

const REPO = path.join(__dirname, "..", "..", "..");
const run = A.createRun();

/** The two sentences deliberately kept: a destructive-action warning, and a diagnostic. */
const KEEP = [
  "Removing only updates this list. Nothing on disk is deleted.",
  "Nothing on stage is named"
];

function phaseCatalog() {
  const dir = path.join(REPO, "src/shared/i18n/catalog/en");
  const hits = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    fs.readFileSync(path.join(dir, file), "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (
          /No [^"']*\byet\b/.test(line) ||
          /Nothing on /.test(line) ||
          /No item selected/.test(line)
        ) {
          hits.push({ where: `${file}:${i + 1}`, text: line.trim().slice(0, 90) });
        }
      });
  }
  const strays = hits.filter((h) => !KEEP.some((k) => h.text.includes(k)));
  run.check(
    "B-1",
    "only the two deliberate survivors remain in the en catalogue",
    strays.length === 0,
    `${hits.length} total, ${strays.length} off the keep-list: ${JSON.stringify(strays.slice(0, 8))}`
  );

  let parity = "not run";
  try {
    execFileSync("yarn", ["vitest", "run", "src/shared/i18n", "--silent"], {
      cwd: REPO,
      encoding: "utf8",
      shell: true,
      stdio: "pipe"
    });
    parity = "green";
  } catch (e) {
    parity = `RED: ${String(e.stdout || e.message)
      .split("\n")
      .filter((l) => /FAIL|✕|Error/.test(l))
      .slice(0, 4)
      .join(" | ")}`;
  }
  run.check("B-2", "en/zh key-set parity test green", parity === "green", parity);
}

async function phaseInspector() {
  await D.onWindow("workspace", A.WINDOWS.workspace, async (d) => {
    await A.clickNamed(d, "[data-editor-tab-id]", `^${D.SCENE}`, { flags: "i" });
    await A.sleep(1500);

    const select = async (index) => {
      const row = await A.scrollIntoViewAndProbe(d, "[data-story-row-block-id]", index);
      if (!row.found) throw new Error(`SETUP GUARD: story row ${index} does not exist`);
      if (!row.reachable)
        throw new Error(`SETUP GUARD: story row ${index} has a rect but is not reachable`);
      await d.click(row.cx, row.cy);
      await A.sleep(1200);
      const panel = await A.panelSurface(d, "Properties");
      if (!panel.ok) throw new Error(`SETUP GUARD: ${panel.why}`);
      return panel.text;
    };

    // Row 2 of First Day is the character row — the one that carried "Stage name".
    const character = await select(1);
    run.check(
      "B-3",
      'no "Stage name" in the story inspector',
      !/Stage name/.test(character),
      character.slice(0, 200)
    );

    // Row 9 is a dialogue — the one that carried a bare uuid as "Text ID".
    const dialogue = await select(8);
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    run.check(
      "B-4",
      "no bare uuid shown in the inspector by default",
      !uuid.test(dialogue),
      dialogue.slice(0, 200)
    );
    await d.screenshot("u5-inspector");
  });
}

async function phaseDashboard() {
  await D.onWindow("workspace", A.WINDOWS.workspace, async (d) => {
    await A.clickNamed(d, "[data-editor-tab-id]", "Dashboard", { flags: "i" });
    await A.sleep(1800);
    if (
      !(await A.call(d, function () {
        return /Scale|Writing activity/.test(document.body.innerText || "");
      }))
    ) {
      throw new Error("SETUP GUARD: the Dashboard is not the active tab");
    }

    const tiles = await A.call(d, function () {
      return Array.from(document.querySelectorAll("div"))
        .filter((e) => {
          const r = e.getBoundingClientRect();
          if (r.width < 90 || r.width > 420 || r.height < 50 || r.height > 160) return false;
          if (r.y < 0 || r.y > innerHeight) return false;
          const t = (e.innerText || "").trim();
          return /^[^\n]{2,30}\n\s*[\d.,]+/.test(t) && t.split("\n").length <= 3;
        })
        .map((e) => (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 34));
    });
    run.check(
      "B-5",
      "dashboard first screen has at most 6 one-integer tiles",
      tiles.length <= 6,
      `${tiles.length}: ${JSON.stringify(tiles)}`
    );

    const truncated = await A.call(d, A.TRUNCATED_LABELS);
    run.check(
      "B-6",
      "no label is truncated on the dashboard first screen",
      truncated.length === 0,
      `${truncated.length}: ${JSON.stringify(truncated.slice(0, 8))}`
    );

    const numbers = await A.call(d, function () {
      const body = (document.body.innerText || "").replace(/\s+/g, " ");
      const grab = (label) => {
        const m = body.match(new RegExp(`${label}\\s+([\\d.,]+)`));
        return m ? m[1] : null;
      };
      return {
        scenes: grab("Scenes"),
        assets: grab("Assets"),
        variables: grab("Variables"),
        characters: grab("Characters")
      };
    });
    run.note(
      `B-11 dashboard numbers: ${JSON.stringify(numbers)} (compare against the pre-change run)`
    );

    const surface = await A.panelSurface(d, "Properties");
    run.check(
      "B-7-dashboard",
      "dashboard right rail sits on an opaque surface",
      surface.ok && A.alphaOf(surface.backgroundColor) === 1,
      JSON.stringify(surface)
    );
    await d.screenshot("u5-dashboard");
  });
}

async function phaseSurface() {
  await D.onWindow("workspace", A.WINDOWS.workspace, async (d) => {
    // The standing ruling is that opacity is measured with the workspace background image ON.
    const background = await A.call(d, function () {
      const el = Array.from(document.querySelectorAll("*")).find((e) =>
        /url\(/.test(getComputedStyle(e).backgroundImage)
      );
      return el ? getComputedStyle(el).backgroundImage.slice(0, 60) : null;
    });
    if (!background)
      throw new Error(
        "SETUP GUARD: no workspace background image is set — this is measured with it ON"
      );
    run.note(`background image on: ${background}`);

    for (const [id, panel] of [
      ["assets", "^Assets$"],
      ["characters", "^Characters$"]
    ]) {
      await A.clickNamed(d, "[aria-label]", panel);
      await A.sleep(1600);
      const surface = await A.panelSurface(d, "Properties");
      run.check(
        `B-7-${id}`,
        `${id} inspector sits on an opaque surface`,
        surface.ok && A.alphaOf(surface.backgroundColor) === 1,
        JSON.stringify(surface)
      );
    }
    await d.screenshot("u5-surfaces");
  });
}

async function phaseNames() {
  await D.onWindow("workspace", A.WINDOWS.workspace, async (d) => {
    const seen = [];
    for (const panel of ["^Assets$", "^Characters$", "^Story$", "^Project$"]) {
      await A.clickNamed(d, "[aria-label]", panel);
      await A.sleep(1400);
      const hits = await A.call(d, A.NAMELESS_CONTROLS);
      seen.push({ panel, nameless: hits.length, hits: hits.slice(0, 4) });
    }
    const total = seen.reduce((n, s) => n + s.nameless, 0);
    run.check(
      "B-8",
      "no visible button is without an accessible name",
      total === 0,
      JSON.stringify(seen)
    );
  });
}

async function phaseTimeline() {
  await D.onWindow("dev-mode", A.WINDOWS.devmode, async (d) => {
    await D.openRuntimePanel(d);
    await D.selectTab(d, "^Timeline$");
    const text = await D.panelText(d);
    // Only meaningful against a scene that HAS an empty text row — the Nesting Lab fixture has
    // one for exactly this reason. On demo3's own scenes this check cannot fail.
    run.check(
      "B-9",
      "the editor placeholder does not appear on the read-only timeline",
      !/Double-click to enter/i.test(text),
      text.slice(0, 200)
    );
  });
}

(async () => {
  const phase = (process.argv.find((a) => a.startsWith("--phase=")) || "--phase=all").split("=")[1];
  if (phase === "all" || phase === "catalog") phaseCatalog();
  if (phase === "all" || phase === "inspector") await phaseInspector();
  if (phase === "all" || phase === "dashboard") await phaseDashboard();
  if (phase === "all" || phase === "surface") await phaseSurface();
  if (phase === "all" || phase === "names") await phaseNames();
  if (phase === "all" || phase === "timeline") await phaseTimeline();
  process.exitCode = run.summary().red > 0 ? 1 : 0;
})().catch((e) => {
  console.error("\nSCRIPT FAIL:", e.message);
  process.exit(1);
});
