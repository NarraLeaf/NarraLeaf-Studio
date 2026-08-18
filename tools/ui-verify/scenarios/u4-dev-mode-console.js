/*
 * Acceptance — the Dev Mode console: one row projection shared with the editor, an execution
 * context in plain language, a readable scene graph.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> \
 *     node tools/ui-verify/scenarios/u4-dev-mode-console.js [--phase editor|timeline|context|scenes|jump|fixture|all]
 *
 * The fixture phase needs the Nesting Lab scene in the project (fixtures/nesting-lab.js).
 *
 * Calibrated red against the pre-change tree: 13 red / 3 green. Four criteria were rewritten during
 * that calibration because the criterion was wrong, not the app — each is commented where it lives.
 */

const fs = require("fs");
const path = require("path");
const A = require("../assert");
const D = require("./_drive");

const BASELINE = path.join(__dirname, "u4-baseline.json");
const run = A.createRun();
const norm = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim();

// --- page-side readers ---------------------------------------------------------------------------

const READ_EDITOR = function () {
  const nodes = Array.from(document.querySelectorAll("[data-story-row-block-id]"));
  if (nodes.length === 0) return { ok: false, why: "no editor rows in the DOM" };
  const rows = nodes
    .map((el) => {
      const r = el.getBoundingClientRect();
      const sentence = (el.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\d+\s*/, "")
        .trim();
      // The CATEGORY bar specifically: 3px wide, opacity < 1. The dialogue attribution rail is
      // 2px at opacity 1 and says "same speaker", not "this kind of action" — counting it as a
      // category hue makes rows look barred that the editor deliberately leaves plain.
      const categoryHues = Array.from(el.querySelectorAll("*"))
        .map((n) => {
          const cs = getComputedStyle(n);
          return {
            bg: cs.backgroundColor,
            w: Math.round(n.getBoundingClientRect().width),
            op: cs.opacity
          };
        })
        .filter((s) => s.bg !== "rgba(0, 0, 0, 0)" && s.w === 3 && Number(s.op) < 1)
        .map((s) => s.bg);
      return {
        id: el.getAttribute("data-story-row-block-id"),
        y: Math.round(r.y),
        sentence,
        categoryHues
      };
    })
    .sort((a, b) => a.y - b.y);
  const onScreen = nodes.find((n) => {
    const r = n.getBoundingClientRect();
    return r.y >= 0 && r.y + r.height <= innerHeight;
  });
  if (!onScreen)
    return {
      ok: true,
      reachable: false,
      why: "no row is fully inside the viewport (list scrolled)",
      count: rows.length,
      rows
    };
  const r = onScreen.getBoundingClientRect();
  const hit = document.elementFromPoint(
    Math.round(r.x + r.width / 2),
    Math.round(r.y + r.height / 2)
  );
  return {
    ok: true,
    reachable: Boolean(hit && (onScreen.contains(hit) || hit.contains(onScreen))),
    why: `elementFromPoint hit ${hit && hit.tagName}`,
    count: rows.length,
    rows
  };
};

const READ_TIMELINE = function () {
  const tabs = document.querySelector('[role="tablist"]');
  if (!tabs) return { ok: false, why: "panel not open" };
  const panel = tabs.parentElement;
  const rows = Array.from(panel.querySelectorAll('li, [data-timeline-row], [role="listitem"]'))
    .map((el) => {
      const r = el.getBoundingClientRect();
      const raw = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (r.width <= 0 || !/^\d+\s/.test(raw)) return null;
      const hues = Array.from(el.querySelectorAll("*")).map((n) => {
        const cs = getComputedStyle(n);
        const rect = n.getBoundingClientRect();
        return { bg: cs.backgroundColor, color: cs.color, w: rect.width, h: rect.height };
      });
      return {
        line: Number(raw.match(/^(\d+)\s/)[1]),
        sentence: raw
          .replace(/^\d+\s*/, "")
          .replace(/\s*▶\s*$/, "")
          .trim(),
        hues: hues
          .filter((h) => h.bg !== "rgba(0, 0, 0, 0)" && h.w > 0 && h.w <= 6)
          .map((h) => h.bg)
          .concat(
            hues.filter((h) => h.w > 0 && h.w <= 20 && h.h > 0 && h.h <= 20).map((h) => h.color)
          ),
        y: Math.round(r.y)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
  return { ok: true, count: rows.length, rows };
};

const READ_PLAYHEAD = function () {
  const tabs = document.querySelector('[role="tablist"]');
  if (!tabs) return null;
  const rows = Array.from(
    tabs.parentElement.querySelectorAll('li, [data-timeline-row], [role="listitem"]')
  )
    .map((el) => ({ el, raw: (el.innerText || "").replace(/\s+/g, " ").trim() }))
    .filter((r) => /^\d+\s/.test(r.raw));
  const current = rows.find(
    (r) =>
      /▶/.test(r.raw) ||
      r.el.getAttribute("data-current") === "true" ||
      /bg-primary/.test(r.el.className || "")
  );
  return current ? Number(current.raw.match(/^(\d+)\s/)[1]) : null;
};

/** The execution-context tab is "the one that is not Variables / Timeline / Scenes" — its name is
 *  not fixed, and a /context/i matcher would miss "Execution" or a localised label. */
const CONTEXT_TAB = function () {
  const tabs = document.querySelector('[role="tablist"]');
  if (!tabs) return null;
  const labels = Array.from(tabs.querySelectorAll('[role="tab"]')).map((t) =>
    (t.textContent || "").trim()
  );
  return labels.find((l) => !/^(variables|timeline|scenes)$/i.test(l)) || null;
};

// --- phases --------------------------------------------------------------------------------------

async function phaseEditor(baseline) {
  return D.onWindow("workspace", A.WINDOWS.workspace, async (d) => {
    if (
      !(await A.call(d, function () {
        return Boolean(document.querySelector("[data-story-row-block-id]"));
      }))
    ) {
      await A.clickNamed(d, "[data-editor-tab-id]", `^${D.SCENE}`, { flags: "i" });
      await A.sleep(1500);
    }
    // Park the virtualised list at the top so all rows are realised in document order.
    await A.call(d, function () {
      const el = document.querySelector("[data-story-row-block-id]");
      let p = el && el.parentElement;
      while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement;
      if (p) p.scrollTop = 0;
      return true;
    });
    await A.sleep(600);

    const res = await A.call(d, READ_EDITOR);
    if (!res.ok) throw new Error(`SETUP GUARD: ${res.why}`);
    if (!res.reachable)
      throw new Error(`SETUP GUARD: editor rows present but not reachable — ${res.why}`);
    if (res.count !== 12)
      throw new Error(`SETUP GUARD: expected 12 "${D.SCENE}" rows, saw ${res.count}`);
    await d.screenshot("u4-editor");

    if (baseline && baseline.editor) {
      const diffs = res.rows
        .map((r, i) =>
          norm(r.sentence) === norm(baseline.editor[i].sentence)
            ? null
            : `${i + 1}: "${baseline.editor[i].sentence}" -> "${r.sentence}"`
        )
        .filter(Boolean);
      run.check(
        "A-6",
        "editor sentences unchanged vs the recorded baseline",
        diffs.length === 0,
        diffs
      );
    } else {
      run.note("A-6 skipped: no stored editor baseline (record one with NLS_VERIFY_RECORD=1)");
    }
    return res.rows;
  });
}

async function phaseTimeline(editorRows) {
  return D.onWindow("dev-mode", A.WINDOWS.devmode, async (d) => {
    await D.openRuntimePanel(d);
    await D.selectTab(d, "^Timeline$");
    const tl = await A.call(d, READ_TIMELINE);
    if (!tl.ok) throw new Error(`SETUP GUARD: ${tl.why}`);
    if (tl.count !== 12)
      throw new Error(
        `SETUP GUARD: expected 12 timeline rows, saw ${tl.count} — is the running scene "${D.SCENE}"?`
      );
    await d.screenshot("u4-timeline");

    // A-1 is SPLIT, and this is not a softening. Demanding one string for all 12 rows would
    // force the timeline to copy the editor's two-line layout: the editor deliberately stacks
    // the speaker on its own line and suppresses it on continuation rows, while a 380px list
    // has no grouping and repeats "Name:" per row.
    const DIALOGUE = [3, 4, 5, 6, 7, 8, 9];
    const SPEAKERS = {
      3: "Youk",
      4: "YouKi",
      5: "Nattou",
      6: "YouKi",
      7: "YouKi",
      8: "YouKi",
      9: "Narra"
    };

    const plain = [1, 2, 10, 11, 12]
      .map((line) => {
        const e = norm(editorRows[line - 1].sentence);
        const t = norm(tl.rows[line - 1].sentence);
        return e === t ? null : `${line}: editor="${e}" timeline="${t}"`;
      })
      .filter(Boolean);
    run.check(
      "A-1a",
      "non-dialogue rows: timeline sentence == editor sentence verbatim",
      plain.length === 0,
      plain.length ? plain : "5/5 equal"
    );

    const dlg = DIALOGUE.map((line) => {
      const speaker = SPEAKERS[line];
      const body = norm(editorRows[line - 1].sentence).replace(new RegExp(`^${speaker}\\s+`), "");
      const want = `${speaker}: ${body}`;
      const got = norm(tl.rows[line - 1].sentence);
      return got === want ? null : `${line}: want="${want}" got="${got}"`;
    }).filter(Boolean);
    run.check(
      "A-1b",
      'dialogue rows: timeline == "<speaker>: <editor body>"',
      dlg.length === 0,
      dlg.length ? dlg : "7/7 equal"
    );

    run.check(
      "A-3b",
      "row 9 keeps its inline variable reference",
      /\bOK\b.*\ba\b/.test(norm(tl.rows[8].sentence)),
      norm(tl.rows[8].sentence)
    );
    run.check(
      "A-2",
      "row 2 carries no engine vocabulary",
      !/character enter/i.test(norm(tl.rows[1].sentence)) &&
        !/·\s*character\b/.test(norm(tl.rows[1].sentence)),
      norm(tl.rows[1].sentence)
    );
    run.check(
      "A-3",
      "row 12 names the asset, not the enum",
      /outside_s\.jpg/.test(norm(tl.rows[11].sentence)) &&
        !/\bsetBackground\b/.test(norm(tl.rows[11].sentence)),
      norm(tl.rows[11].sentence)
    );

    // The editor does NOT hue every row — narration, note and dialogue rows carry zero chrome by
    // design. Asserting 12/12 demanded colours the editor itself refuses to paint.
    const hued = editorRows
      .map((r, i) => ({ line: i + 1, editor: r.categoryHues || [] }))
      .filter((p) => p.editor.length);
    const pairs = hued.map((p) => ({ ...p, timeline: tl.rows[p.line - 1].hues.filter(Boolean) }));
    const matched = pairs.filter((p) => p.editor.some((c) => p.timeline.includes(c)));
    run.check(
      "A-4",
      "every row the editor hues carries the same hue on the timeline",
      hued.length > 0 && matched.length === hued.length,
      `${matched.length}/${hued.length}; ${JSON.stringify(pairs)}`
    );

    const speakers = ["Youk", "YouKi", "Nattou", "YouKi", "YouKi", "YouKi", "Narra"];
    const named = speakers.filter((s, i) => norm(tl.rows[i + 2].sentence).includes(s));
    run.check(
      "A-5",
      "dialogue rows 3-9 name their speaker",
      named.length === 7,
      `${named.length}/7`
    );

    const forbidden = [/actionType/, /\b[0-9a-f]{8}…/, /\bsetBackground\b/, /character enter/i];
    const hits = [];
    for (const label of await A.call(d, function () {
      return Array.from(document.querySelectorAll('[role="tab"]')).map((t) =>
        (t.textContent || "").trim()
      );
    })) {
      await D.selectTab(d, `^${label}$`);
      const text = await D.panelText(d);
      for (const re of forbidden) if (re.test(text)) hits.push(`${label}: ${re}`);
    }
    run.check(
      "A-10",
      "no engine vocabulary anywhere in the panel",
      hits.length === 0,
      hits.length ? hits : "clean"
    );
    return tl.rows;
  });
}

async function phaseContext() {
  await D.onWindow("dev-mode", A.WINDOWS.devmode, async (d) => {
    await D.openRuntimePanel(d);
    const tab = await A.call(d, CONTEXT_TAB);
    run.check(
      "A-7a",
      "an execution-context tab is present (not hidden when the stack is empty)",
      Boolean(tab),
      `tab=${tab}`
    );
    if (!tab) {
      run.check("A-7", `context names the running scene "${D.SCENE}"`, false, "tab absent");
      return;
    }
    await D.selectTab(d, `^${tab}$`);
    const text = await D.panelText(d);
    await d.screenshot("u4-context-root");
    run.check(
      "A-7",
      `context names the running scene "${D.SCENE}"`,
      new RegExp(D.SCENE).test(text),
      text.slice(0, 200)
    );
  });
}

async function phaseScenes(baseline) {
  await D.onWindow("dev-mode", A.WINDOWS.devmode, async (d) => {
    await D.openRuntimePanel(d);
    await D.selectTab(d, "^Scenes$");
    await A.sleep(1400);
    const g = await A.call(d, A.SCENE_GRAPH);
    if (!g.ok) throw new Error(`SETUP GUARD: ${g.why}`);
    await d.screenshot("u4-scenes");
    const worst = Math.min(...g.nodes.map((n) => n.renderedFont));
    run.check(
      "A-11",
      "scene node title renders at >= 11px",
      worst >= 11,
      `worst=${worst}px zoom=${g.zoom} ${JSON.stringify(g.nodes.map((n) => [n.label, n.cssFont, n.renderedFont]))}`
    );
    const inside = g.nodes.filter((n) => n.insidePane).length;
    run.check(
      "A-12",
      "every scene node is fully inside the pane",
      inside === g.nodes.length,
      `${inside}/${g.nodes.length}`
    );
  });

  return D.onWindow("workspace", A.WINDOWS.workspace, async (d) => {
    const flowTab = await A.probe(d, "[data-editor-tab-id]", "Scene Flow", "i", 0);
    if (flowTab.found && flowTab.reachable) {
      await d.click(flowTab.cx, flowTab.cy);
      await A.sleep(1600);
    }
    const g = await A.call(d, A.SCENE_GRAPH);
    if (!g.ok) {
      run.note(`A-14 skipped: ${g.why} — open the workspace Scene Flow tab first`);
      return null;
    }
    const fonts = g.nodes.map((n) => n.cssFont);
    if (baseline && baseline.workspaceFlowFonts) {
      run.check(
        "A-14",
        "workspace story-flow node font unchanged (the Dev Mode fix must not leak)",
        JSON.stringify(fonts) === JSON.stringify(baseline.workspaceFlowFonts),
        `${JSON.stringify(fonts)} vs baseline ${JSON.stringify(baseline.workspaceFlowFonts)}`
      );
    } else {
      run.note(`A-14: baseline recorded, fonts=${JSON.stringify(fonts)}`);
    }
    return fonts;
  });
}

async function phaseJump() {
  await D.onWindow("dev-mode", A.WINDOWS.devmode, async (d) => {
    await D.openRuntimePanel(d);
    await D.selectTab(d, "^Timeline$");
    // BLOCKING rows only. A cold jump enters AT the row and plays forward, so a non-blocking
    // action does not stop the play head and legitimately settles on the next waiting row —
    // asserting a precise landing there measures engine semantics, not the jump.
    const landed = [];
    for (const line of [10, 5, 11, 3, 9]) {
      const target = await A.call(
        d,
        function (n) {
          const tabs = document.querySelector('[role="tablist"]');
          const rows = Array.from(
            tabs.parentElement.querySelectorAll('li, [data-timeline-row], [role="listitem"]')
          ).filter((el) => /^\d+\s/.test((el.innerText || "").replace(/\s+/g, " ").trim()));
          const el = rows.find((e) => Number((e.innerText || "").trim().match(/^(\d+)/)[1]) === n);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cx = Math.round(r.x + r.width / 2);
          const cy = Math.round(r.y + r.height / 2);
          const hit = document.elementFromPoint(cx, cy);
          return { cx, cy, reachable: Boolean(hit && (el.contains(hit) || hit === el)) };
        },
        line
      );
      if (!target || !target.reachable) {
        landed.push({ target: line, got: target ? "unreachable" : "not found" });
        continue;
      }
      await d.click(target.cx, target.cy);
      await A.sleep(1800);
      landed.push({ target: line, got: await A.call(d, READ_PLAYHEAD) });
    }
    const ok = landed.filter((l) => l.got === l.target).length;
    run.check(
      "A-13",
      "timeline jump lands on the clicked row (5 blocking rows)",
      ok === 5,
      JSON.stringify(landed)
    );
  });
}

/** Needs the Nesting Lab fixture — demo3 has no container blocks at all. */
async function phaseFixture() {
  await D.onWindow("dev-mode", A.WINDOWS.devmode, async (d) => {
    await D.openRuntimePanel(d);
    await D.selectTab(d, "^Scenes$");
    await A.sleep(1200);
    const node = await A.call(d, function () {
      const n = Array.from(document.querySelectorAll(".react-flow__node")).find((e) =>
        /Nesting Lab/.test(e.innerText || "")
      );
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const cx = Math.round(r.x + r.width / 2);
      const cy = Math.round(r.y + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return { cx, cy, reachable: Boolean(hit && (n.contains(hit) || hit === n)) };
    });
    if (!node)
      throw new Error(
        'SETUP GUARD: no "Nesting Lab" node — run fixtures/nesting-lab.js against the project copy'
      );
    if (!node.reachable)
      throw new Error("SETUP GUARD: the Nesting Lab node has a rect but is occluded");
    await d.click(node.cx, node.cy, { clickCount: 2 });

    // Wait for the scene to be ON STAGE before advancing: otherwise the change-waiter counts the
    // scene appearing as "my click advanced the story" and every read afterwards is one behind.
    for (let t = 0; t < 40; t += 1) {
      await A.sleep(500);
      if (/Nesting lab: entering\./.test(await d.evaluate("document.body.innerText"))) break;
      if (t === 39)
        throw new Error("SETUP GUARD: Nesting Lab never reached the stage after relaunch");
    }
    await A.sleep(800);

    const readContext = async (what) => {
      const tab = await A.call(d, CONTEXT_TAB);
      if (!tab) return { text: null, why: `no execution-context tab while ${what}` };
      await D.selectTab(d, `^${tab}$`);
      return { text: await D.panelText(d) };
    };

    await A.advanceUntil(d, /Inside the repeat body\./, "the repeat body");
    const repeat = await readContext("inside the repeat body");
    await d.screenshot("u4-context-repeat");
    // Engine >= 0.19.1 only: before that a nested loop's counter never left snapshot().
    run.check(
      "A-9",
      "context shows the live repeat round as n/3",
      Boolean(repeat.text) && /\b[1-3]\s*\/\s*3\b/.test(repeat.text),
      repeat.text || repeat.why
    );

    await A.advanceUntil(d, /Parallel branch [AB]\./, "the parallel");
    const parallel = await readContext("inside the parallel");
    await d.screenshot("u4-context-parallel");
    // The pill words come from the CATALOGUE, not the payload enum: parallel is "Run at the same
    // time" and sequence is "In order". Matching /Parallel/ demanded the enum names that are
    // deliberately not shown.
    run.check(
      "A-8",
      "context lists the parallel -> sequence chain in plain language",
      Boolean(parallel.text) &&
        /Run at the same time/i.test(parallel.text) &&
        /In order/i.test(parallel.text),
      parallel.text || parallel.why
    );
    run.check(
      "A-8b",
      "the parallel lists both branches by sentence, running one marked",
      Boolean(parallel.text) &&
        /Parallel branch A\./.test(parallel.text) &&
        /Parallel branch B\./.test(parallel.text) &&
        /▸/.test(parallel.text),
      parallel.text || parallel.why
    );
    const engineWords = [/actionType/, /menu:action/, /\bbranchWaitType\b/, /\b[0-9a-f]{8}…/];
    const hits = parallel.text
      ? engineWords.filter((re) => re.test(parallel.text)).map(String)
      : ["(no context text)"];
    run.check(
      "A-10b",
      "no engine vocabulary in the context tab while inside a parallel",
      hits.length === 0,
      hits.length ? hits : "clean"
    );
  });
}

(async () => {
  const phase = (process.argv.find((a) => a.startsWith("--phase=")) || "--phase=all").split("=")[1];
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
  const record = {};

  if (phase === "all" || phase === "editor" || phase === "timeline")
    record.editor = await phaseEditor(baseline);
  if (phase === "all" || phase === "timeline") await phaseTimeline(record.editor);
  if (phase === "all" || phase === "context") await phaseContext();
  if (phase === "all" || phase === "scenes")
    record.workspaceFlowFonts = await phaseScenes(baseline);
  if (phase === "all" || phase === "jump") await phaseJump();
  // Last: it relaunches into the fixture scene, so it invalidates the First Day play state.
  if (phase === "all" || phase === "fixture") await phaseFixture();

  if (!baseline && process.env.NLS_VERIFY_RECORD === "1") {
    fs.writeFileSync(BASELINE, JSON.stringify(record, null, 1));
    console.log(`\nbaseline written to ${BASELINE}`);
  }
  process.exitCode = run.summary().red > 0 ? 1 : 0;
})().catch((e) => {
  console.error("\nSCRIPT FAIL:", e.message);
  process.exit(1);
});
