# Plugin test protocol

Normative contract for tests contributed by a plugin. Intended to be folded into the plugin spec.

Types: `narraleaf-studio/plugin`. Source of truth: `src/renderer/lib/testing/types.ts`.
Current protocol version: **1**.

The key words MUST, MUST NOT, SHOULD and MAY are used in their usual normative sense.

## 1. What a test is

A **test** is a check the author runs against **their game** from Run ▸ Test: does the story reach an
ending, does the game survive with no network, does this plugin's feature still behave. It is
started by a human, it observes one project, and it ends in a verdict plus findings that Studio
renders in a Test Report tab.

A test is **not**:

- a unit test of the plugin's own code (that is the plugin author's own toolchain; Studio never runs it);
- a lint rule — a lint rule is static, configurable per project, and defers its severity to the
  project's config table. A test runs, states its own verdict, and each finding carries its own
  severity;
- a background task. Nothing runs unless the author picked it and pressed Start. Consequently
  declaring a test derives **no install permission**: there is no ambient capability to consent to.

A test MUST be a read-only observer of the project. There is no write half of any handle it is
given, and a test MUST NOT reach around them (for example through the privileged facade) to mutate
project content.

## 2. Manifest declaration

```json
"contributes": {
    "tests": ["acme.qa-pack.scene-names", "acme.qa-pack.offline-launch"]
}
```

- Every id the plugin registers MUST appear here. Registering an undeclared id **throws at load**,
  failing the whole `setup()`.
- Every id MUST be prefixed `<pluginId>.`. The registry is one flat id space shared with Studio's
  own tests (which are spelled `narraleaf-studio:<slug>`), so an unprefixed id could shadow them.
- Duplicates are collapsed. Order is not meaningful.
- The key is declarative so the Launcher can list what a plugin checks **before any of its code
  runs**. A test that exists only at registration time is one the author learns about only after
  installing.

## 3. Registration

```ts
app.services.tests.register(definition): PluginCleanup
app.services.tests.registerMany(definitions): PluginCleanup
app.services.tests.protocolVersion: number
```

- `register` returns a cleanup removing exactly that test; `registerMany` returns one cleanup
  removing all of them. The host also tracks every registration, so unloading the plugin reclaims
  them even if the cleanup is never called.
- `registerMany` validates the whole batch before registering any of it.
- Ownership (`ownerPluginId`) is assigned by the host from the registering plugin's identity. It is
  never read off the definition.
- Re-registering an id the same plugin already owns replaces it. Re-registering an id owned by
  someone else is refused.
- Registration SHOULD happen in `setup()`. `checkAvailability` — not registration — is the place to
  express "this project cannot run me".

## 4. `TestDefinition`

| Field                                           | Required | Contract                                                                         |
| ----------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `id: TestId`                                    | yes      | `<pluginId>.<slug>`, declared in `contributes.tests`.                            |
| `title: TestText`                               | yes      | Row label in the picker and the report tab.                                      |
| `description?: TestText`                        | no       | One line under the title.                                                        |
| `category?: TestCategory`                       | no       | `integrity` \| `runtime` \| `compatibility` \| `custom`. Omitted means `custom`. |
| `presentation: TestPresentation`                | yes      | `headless` \| `windowed`. See §6.                                                |
| `requires?: readonly TestCapability[]`          | no       | See §5. Omitted means the test is a pure computation over what it was given.     |
| `checkAvailability?(ctx)`                       | no       | Synchronous, cheap, side-effect free. Runs on **every** picker open.             |
| `run(ctx): Promise<TestVerdict> \| TestVerdict` | yes      | See §7.                                                                          |

`TestText` is either `{ key, params? }` (an i18n key in Studio's own catalogue) or `{ text }` (a
literal). A plugin has no keys in Studio's catalogue and MUST use `{ text }`, producing the string
with its own translator (`app.services.i18n.createTranslator`).

`checkAvailability` returns `{ available: true }` or `{ available: false, reason: TestText }`. An
unavailable test is greyed out with its reason shown; it is a normal state, not an error. The host
applies its own gates on top of whatever it returns — a `windowed` test is unavailable on a frozen
workspace regardless.

## 5. Capabilities

| Capability     | Grants                                   | Handle                           |
| -------------- | ---------------------------------------- | -------------------------------- |
| `project.read` | Read the project's stories and scenes.   | `ctx.project: TestProjectHandle` |
| `game.launch`  | Launch, observe and stop a game process. | `ctx.game: TestGameHandle`       |

**Undeclared is absent, not throwing.** `ctx.game` is `undefined` unless `game.launch` was declared;
`ctx.project` is `undefined` unless `project.read` was. What the picker lists and what the test can
reach are the same set by construction, and a test MUST read the handle rather than assume it.

`TestProjectHandle` is deliberately thin: `projectPath`, `listStories()`, `listScenes(storyId)`. It
is the read half of the story catalogue and no more. A test needing the scene _graph_ needs a
protocol addition and a version bump (§9) — that is the designated extension point, not something to
reach around.

## 6. Presentation

`presentation` is a **declaration, not a mechanism**. A window appears because a test asked the host
for a game session; the field is what the picker badges and what warns the author a window is about
to open.

- `headless`: no window. Runs while the author keeps working, and is the only kind that runs on a
  frozen workspace.
- `windowed`: a game window will appear. Refused while the workspace is frozen, because Preview is —
  a test MUST NOT be a way around that gate.

A `headless` test that calls `ctx.game.launch()` is a host error, not a silent success. Declare
`windowed` if you launch.

## 7. Verdicts

`run` MUST return one of:

```ts
{ status: "passed";  summary?: TestText }
{ status: "failed";  summary:  TestText }
{ status: "skipped"; summary:  TestText }
```

and nothing else. `cancelled` and `errored` are verdicts the **host** reaches _about_ a test:

| Status                          | Claimed by | Meaning                                                                   |
| ------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `passed` / `failed` / `skipped` | the test   | Its own conclusion.                                                       |
| `cancelled`                     | the host   | The author aborted the run.                                               |
| `errored`                       | the host   | `run` threw or rejected. The thrown value is stringified onto the record. |

A test that could claim `cancelled` could lie about having been killed, which is why it cannot.

- **Cancellation** arrives as `ctx.signal`. A test that ignores it is killed once its promise
  settles, but its findings are kept — a cancelled run is still evidence. A test whose contract is
  "the author closes the window when satisfied" expresses author-termination by catching the abort
  and returning `failed`.
- **`skipped`** is for a reason discovered _while running_ (no localisation configured, say). A test
  that can tell before it starts MUST say so from `checkAvailability` instead, so the picker greys
  it out rather than pretending to run.

### Findings and live output

```ts
ctx.log(level, message)      // "verbose" | "info" | "success" | "warning" | "error"
ctx.progress({ completed, total?, label? } | null)
ctx.report({ severity, message, target? })
```

A finding is **evidence for a verdict the test has already reached**, and carries its own
`severity` (`error` \| `warning` \| `info`) — unlike a lint rule, which defers severity to the
project's config. Reporting an `error` finding does not by itself fail the run; the verdict does.

`target` is a `SearchJumpTarget` (exported from `narraleaf-studio/plugin`), so the report tab's
click-to-jump is existing machinery rather than anything a test has to draw. Omit it when the
finding does not point anywhere; do not invent a shape.

`progress(null)` returns the bar to indeterminate. `total` is optional because most interesting
tests do not know it up front; omitting it renders an indeterminate bar rather than a fake fraction.

## 8. Game sessions

Requires `game.launch` and `presentation: "windowed"`.

```ts
const session = await ctx.game.launch({ network: "blocked" });
const off = session.onEvent((event) => {
  /* … */
});
const exit = await session.waitForExit();
await session.stop();
```

- **One session at a time per run.** A second `launch()` while one is alive is refused: two game
  processes contend for the same compiled artifact directory and the second would silently win.
- `network: "blocked"` starts the game with **no network access at all**, applied by the host to the
  launched process — a game that reaches for the network fails where a player's would, not in a mock.
- `onEvent` returns an unsubscribe. Events emitted before the first listener are replayed to it, so
  a listener attached after `launch()` resolves misses nothing.
- `waitForExit()` resolves once the process is gone, whatever the reason, and is safe to call more
  than once. `stop()` is graceful-then-force and resolves when the process is gone.
- A session never outlives its run. The host stops any surviving session when `run` settles.

Events (`TestGameEvent`), in one ordered stream because the ordering between "the game logged this"
and "the game then died" is load-bearing evidence:

| `kind`          | Payload                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `console`       | `level`, `source`, `message` — a line the game logged.                                              |
| `runtime-error` | `scope: "renderer" \| "main"`, `message`, `stack?` — an **uncaught** error inside the running game. |
| `game-end`      | The engine reached an ending.                                                                       |
| `exit`          | `exit: TestGameExit` — terminal.                                                                    |

### Exit reasons

`TestGameExit` is `{ reason, code, signal }`. The four reasons are exhaustive and a test SHOULD
handle each explicitly:

| `reason`          | Means                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `closed-by-user`  | Closed from inside the game: the window's own close, or the engine quitting itself.      |
| `stopped-by-host` | The host asked — an explicit `stop()`, or the run being cancelled.                       |
| `crashed`         | Non-zero exit code, a fatal signal, or an uncaught exception in the game's main process. |
| `failed-to-start` | Never got far enough to run: compile failed, or the runner would not spawn.              |

Do not infer a reason from `code`. `code` and `signal` are diagnostics for the finding message;
`reason` is the classification, and only the host can make it.

## 9. Versioning

`TEST_PROTOCOL_VERSION` is bumped **when a change here would break an already-published plugin** —
a removed or narrowed field, a changed meaning, a new required member. Purely additive changes (a
new optional field, a new event kind, a new capability) do **not** bump it: a plugin that does not
name them is unaffected.

- The version is recorded on every run record, so a report kept across a Studio upgrade still says
  which contract produced it.
- Read the host's version at `app.services.tests.protocolVersion`, and compare it against the
  `TEST_PROTOCOL_VERSION` your plugin compiled against. A definition needing a newer contract SHOULD
  refuse in `setup()`, where it can still decline to register, rather than half-way through a run.
- `TEST_PROTOCOL_VERSION` is a **compile-time** constant. Studio's host module for
  `narraleaf-studio/plugin` re-exports only `definePlugin` and the enums, so import it with
  `import type` (or read `ctx.protocolVersion`) rather than as a value.

## 10. Complete example

`manifest.json`:

```json
{
  "manifestVersion": 2,
  "id": "acme.qa-pack",
  "name": "QA Pack",
  "version": "1.0.0",
  "entries": { "studio": "dist/studio.js" },
  "contributes": {
    "tests": ["acme.qa-pack.scene-names", "acme.qa-pack.offline-launch"]
  }
}
```

`src/studio.ts`:

```ts
import { definePlugin, type TestDefinition } from "narraleaf-studio/plugin";

/** Headless: every scene the author can jump to should have a name. */
const sceneNames: TestDefinition = {
  id: "acme.qa-pack.scene-names",
  title: { text: "Scenes are named" },
  description: { text: "Flags scenes left with a generated name." },
  category: "integrity",
  presentation: "headless",
  requires: ["project.read"],
  async run(ctx) {
    const project = ctx.project;
    if (!project) {
      // Cannot happen while `requires` lists project.read - but the handle is
      // optional by construction, so read it rather than assume it.
      return { status: "skipped", summary: { text: "No project access" } };
    }

    const stories = await project.listStories();
    let checked = 0;
    let unnamed = 0;

    for (const story of stories) {
      if (ctx.signal.aborted) {
        break;
      }
      const scenes = await project.listScenes(story.id);
      ctx.progress({ completed: ++checked, total: stories.length, label: { text: story.name } });

      for (const scene of scenes) {
        if (scene.name && scene.name !== scene.id) {
          continue;
        }
        unnamed += 1;
        ctx.report({
          severity: "warning",
          message: { text: `Unnamed scene in "${story.name}": ${scene.id}` }
        });
      }
    }

    ctx.log("info", { text: `Checked ${checked} stor${checked === 1 ? "y" : "ies"}.` });
    return unnamed === 0
      ? { status: "passed" }
      : { status: "failed", summary: { text: `${unnamed} scene(s) have no name.` } };
  }
};

/**
 * Windowed: launch with the network cut and let the author play.
 *
 * The pass condition is "the author closed the window": anything else - a crash, a failure to
 * start, or the author cancelling the run - is a failure. Cancellation is expressed by catching
 * the abort and returning `failed`, because a test may not claim `cancelled` itself.
 */
const offlineLaunch: TestDefinition = {
  id: "acme.qa-pack.offline-launch",
  title: { text: "Plays with no network" },
  description: { text: "Starts the game offline. Close the window when you are satisfied." },
  category: "runtime",
  presentation: "windowed",
  requires: ["game.launch"],
  checkAvailability(ctx) {
    return ctx.frozen
      ? { available: false, reason: { text: "Unfreeze the project to launch a game." } }
      : { available: true };
  },
  async run(ctx) {
    const game = ctx.game;
    if (!game) {
      return { status: "skipped", summary: { text: "No game access" } };
    }

    const session = await game.launch({ network: "blocked" });
    const abort = () => void session.stop();
    ctx.signal.addEventListener("abort", abort, { once: true });

    let errors = 0;
    const off = session.onEvent((event) => {
      if (event.kind === "runtime-error") {
        errors += 1;
        ctx.report({
          severity: "error",
          message: { text: `Uncaught ${event.scope} error: ${event.message}` }
        });
      } else if (event.kind === "console" && event.level === "error") {
        ctx.log("error", { text: event.message });
      }
    });

    try {
      const exit = await session.waitForExit();

      switch (exit.reason) {
        case "closed-by-user":
          return errors === 0
            ? { status: "passed", summary: { text: "Closed cleanly with no network." } }
            : { status: "failed", summary: { text: `${errors} uncaught error(s) while offline.` } };
        case "crashed":
          return {
            status: "failed",
            summary: {
              text: `Crashed offline (code ${exit.code ?? "?"}, signal ${exit.signal ?? "none"}).`
            }
          };
        case "failed-to-start":
          return { status: "failed", summary: { text: "The game never started." } };
        case "stopped-by-host":
          // The author cancelled, or Studio stopped us. Not a pass: nobody saw it through.
          return {
            status: "failed",
            summary: { text: "Stopped before the author closed the window." }
          };
      }
    } finally {
      off();
      ctx.signal.removeEventListener("abort", abort);
    }
  }
};

export default definePlugin({
  setup(app) {
    return app.services.tests.registerMany([sceneNames, offlineLaunch]);
  }
});
```
