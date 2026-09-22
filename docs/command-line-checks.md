# Command-line checks

`narraleaf-studio --test <project>` runs one test against a project. `narraleaf-studio --lint
<project>` sweeps the project's lint rules. Both run with no interface at all and exit with a code.
They exist for the same machine [command-line builds](command-line-builds.md) exist for: a build
agent, a Mac reached over SSH, a scheduled job, a script an author wrote for themselves.

Neither is a second test runner or a second linter. `--test` starts the test the **Run ▸ Test**
picker starts, through the same run controller, with the same gates in front of it; `--lint` runs
the sweep the **Lint** tab runs and the build gate reads. A check that answered differently
depending on whether a person or a script started it would be worse than having no script at all.

The implementation is `src/main/app/application/commandLineCheck.ts`; the flags are parsed in
`commandLine.ts`, and the workspace halves are `src/renderer/lib/testing/runCommandLineTest.ts` and
`src/renderer/lib/lint/runCommandLineLint.ts`.

## One invocation, one question

A launch answers one question, so `--test` and `--lint` on one line are refused, and so is either of
them beside `--build`. One exit code leaves the process, and any rule for combining two results
would report a verdict about something the caller did not ask about.

## The flags

| Flag | What it takes | Default |
| --- | --- | --- |
| `--test` | A project folder, or the name of a recently-opened project | — (required for a test) |
| `--test-id` | The id of a registered test | — (required unless `--test-list`) |
| `--test-list` | — | reports the registry instead of running anything |
| `--test-parameter` | `id=value`, repeatable | each parameter's own default |
| `--test-as-shipped` | — (or `=true` / `=false`) | loose files; see [below](#loose-files-or-the-shipped-form) |
| `--test-variant=` | A build variant's name | `main`, the release build; see [below](#which-variant-which-dlc) |
| `--test-dlc=` | DLC names or ids, comma-separated; repeatable | no DLC |
| `--test-report` | Where to write the JSON report | no report file |
| `--test-user-data-dir` | A profile folder for this run | the machine's own profile |
| `--lint` | A project folder, or the name of a recently-opened project | — (required for a sweep) |
| `--lint-report` | Where to write the JSON report | no report file |
| `--lint-user-data-dir` | A profile folder for this run | the machine's own profile |

Every value-taking flag accepts both `--flag value` and `--flag=value`, except `--test-variant` and
`--test-dlc`, which take only `--flag=value`. `--test-list` and `--test-as-shipped` take no separate
value; the second also accepts `=true` or `=false` for a job that states it from a variable.

> **On Windows, write any value with a colon in it as `--flag=value`.** A launch dies before Studio
> writes anything when a separate argument looks like `scheme:rest`: `--test-id
> narraleaf-studio:walkthrough` exits with no output and no report, while
> `--test-id=narraleaf-studio:walkthrough` — or the short `--test-id walkthrough` — is read normally.
> That is why the two flags that carry names an author typed accept only the `=` form: a variant
> called `Next Fest: Demo` cannot be told apart from that shape. The separate form is refused with
> the spelling that works.

A companion flag given without `--test` or `--lint` is refused rather than ignored, exactly as a
`--build-*` flag without `--build` is: the alternative is a launch that opens the editor while the
script that wrote the line believes it is checking something.

## Exit codes

| Code | Outcome | What it means |
| --- | --- | --- |
| 0 | `success` | The check ran and the project passed it. |
| 1 | `check-failed` | The check ran and the project did not pass. |
| 2 | `invocation` | The command line could not be acted on. Nothing was opened. |
| 3 | `refused` | The check exists and was not allowed to run. Says nothing about the project. |
| 4 | `studio-failed` | Studio could not get far enough to answer. Says nothing about the project. |

The numbers are the build's numbers, position for position, so a job that runs all three does not
need three tables.

`studio-failed` also covers a profile that cannot run the project: a plugin the project declares is
not installed, switched off, or will not start ([Plugins](#plugins)), or something in the run asked
a question nobody was there to answer ([Nothing is asked](#nothing-is-asked)). Both are a machine to
look at, not a project to change.

`refused` is the one worth reading carefully. A windowed test on a frozen workspace, or one asked
for while another run holds the slot, is refused — that is the host declining for a reason that may
pass, and retrying later is reasonable. `check-failed` will not change until the project does.

## Tests

### Both modes, and why the mode is visible

A test declares itself `headless` or `windowed`, and that declaration is the test's, not the
caller's. A `headless` test computes over what it was given and can run while anything else is going
on; a `windowed` one launches a game process and puts a window on screen. `--test-list` prints the
mode for every test, which is the whole point of the listing: a job on a machine with no display can
see which tests it must not start before it starts one.

There is no flag to ask for a mode. A test that says `headless` and opens a window is a host error,
and letting a command line overrule the declaration would make that error reachable on purpose.

### Finding out what a project's Studio has

```sh
narraleaf-studio --test /srv/projects/my-game --test-list
```

One line per test: the id, the mode, the category, the title, and whether it can run right now (and
why not when it cannot). Under it, one line per parameter and one per value that parameter accepts,
each with the label the picker would have shown for it. With `--test-report` the same rows are
written to the report as structured data, which is what a script assembling a command line reads.

**No value in the listing is a generated id.** The walkthrough's endings are stored as a pair of ids,
so each ending is listed — and taken on the line — by a name: the ending's own name when no other
ending shares it, with its story put in front where two do, and its scene as well where that is
still not enough. An ending with no name yet is listed as its story and scene.

```text
[info] Test: narraleaf-studio:walkthrough  [windowed]  [runtime]  Ending walkthrough
[info] Test:     --test-parameter ending=<value>   Ending
[info] Test:         Same time tomorrow   Skeleton / Last light / Same time tomorrow   (default)
```

The registry is populated by Studio's own modules **and by every plugin the profile has switched
on** ([Plugins](#plugins)), so the listing is a property of the Studio and the profile the run uses —
not of the project alone. A run in a scratch profile lists the tests Studio ships and none a plugin
contributes.

### Running one

```sh
narraleaf-studio --test /srv/projects/my-game \
  --test-id=narraleaf-studio:walkthrough \
  --test-parameter "ending=Same time tomorrow" \
  --test-report /srv/artifacts/test.json
```

`--test-parameter` names one value the test declared. A `select` parameter accepts exactly what
`--test-list` prints for it — an option's name where it has one (matched without regard to case),
its value where it has none — and never the labels: a label follows the editor's language, and a
line written against one would stop working when somebody changed it. The id an ending is stored
under is refused, and the refusal says the ending's name to write instead. A `boolean` accepts
`true`/`false`, `yes`/`no`, `on`/`off`, `1`/`0`. Anything the test does not declare, a `select` value it does not offer, or one
id given twice is refused as a bad invocation rather than falling back on the default: a run that
quietly walked to a different ending than the line named would report a green verdict about
something nobody asked for.

Parameters the line does not name fall to the test's own default, which is what the picker would
have started on.

### Loose files or the shipped form

A project with asset protection on ships its content sealed in a protected store. A game a test
launches does not have to: by default it runs the project's content as loose files, and
`--test-as-shipped` makes it hold that content the way the release build does.

```sh
narraleaf-studio --test /srv/projects/my-game --test-id=walkthrough --test-as-shipped
```

Loose is the default because sealing is paid on every run. A store is written whole — it has no way
to replace one entry, and a story edit changes the pack inside it — so a sealed run seals every
asset again, every time. On a real-size project that was measured at around 14 seconds for the first
sealed run and 6 seconds after, against under 2 seconds loose.

It is still worth a job asking for, because the sealed form behaves differently by construction, and
only a shipped build otherwise ever meets it: an asset has no file path on disk, a runtime file
outside the store's allowed names cannot be read, and there is no manifest, so everything resolves
by id. A nightly job that runs the walkthrough both ways covers the path the players get.

**The line is the only thing asked.** Studio's **Preview as shipped** setting is not read by a
command-line run at all, whichever way it is set on the machine the run happens on. That setting is
the habit of an author at that machine; a run with nobody at the screen has no habit to inherit, and
the same line has to exercise the same path on a build agent that never set it and on a developer's
machine that did. Nothing is written back either — neither to the machine's settings nor to the
project.

The run says which path it took. When the test launches its game, the log carries one line about the
content, then two about which build the game is ([below](#which-variant-which-dlc)), then how long
the compile took, which is the step whose cost depends on the path:

```text
[info] Test: assets: sealed in a protected store, as this project's release build holds them (--test-as-shipped)
[info] Test: variant: main, the release build
[info] Test: DLC: none
[verbose] Test: game compiled: 11 asset(s) in 0.5 s
```

```text
[info] Test: assets: loose files; this project's release build seals them, which --test-as-shipped would test
[info] Test: variant: main, the release build
[info] Test: DLC: none
[verbose] Test: game compiled: 11 asset(s) in 0.4 s
```

Two cases where the flag changes nothing, and the log says so rather than leaving a job to believe
the sealed path ran:

- **A project with asset protection off** ships loose files, so loose files are the shipped form:
  `assets: loose files - asset protection is off, so that is how this project ships and
  --test-as-shipped has nothing to seal`.
- **A headless test** launches no game at all, so there is no content to hold either way. The run
  ends with a warning naming the test.

`--lint` has no counterpart and needs none. A lint sweep reads the project; it never compiles or
launches the game, so there is no content form for it to choose. `--test-as-shipped` beside `--lint`
is refused as a bad invocation, as every other `--test` flag is.

### Which variant, which DLC

A game a test launches is one build of the project: one [build variant](command-line-builds.md), and
whichever of the project's DLC is installed beside it. By default it is the release build — the
variant called `main` — with no DLC, which is the game a player who bought only the game has.
`--test-variant` and `--test-dlc` name another:

```sh
narraleaf-studio --test /srv/projects/my-game --test-id=walkthrough \
  --test-variant=Demo --test-dlc="Summer Route,voice_pack"
```

**Names, the way the project's author wrote them.** A variant is named by its name — `main`, or
whatever the author called theirs in **Project ▸ App** — matched without regard to case, as
`--build-variant` names one. The id a variant is stored under is refused, with the name to write
instead. A DLC is
named by its name or by its id, the author-chosen word the DLC's file is named after; a name wins
when both would match, and a DLC whose name has a comma in it is named by its id. `--test-dlc` takes
a comma-separated list and may also be given more than once.

**The line is the only thing asked**, as it is for `--test-as-shipped`. Studio's **Run as** and **Run
with DLC** choices are an author's habits at one machine and are not read by a command-line run at
all: the same line tests the same build on an agent that never chose anything and on a developer's
machine that chose a demo with every DLC ticked. Nothing is written back to the machine's settings
or to the project.

**A name the project does not have is refused** with exit code 2 before anything is opened, and the
refusal lists the ones it does have:

```text
[error] Test: The project has no build variant "Dmeo". It has: main, Demo.
[error] Test: invocation (exit 2)
```

So is a DLC made for a different variant than the one the run is. A build refuses a DLC sealed for
another variant, so no player of this one can install it, and a green run on that pair would be about
a game nobody can have. The refusal names the variant the DLC belongs to and the DLC this one can
take.

The run says which build it was, on the two lines after the one about the content:

```text
[info] Test: variant: "Demo" (--test-variant)
[info] Test: DLC: "Summer Route", "Voice pack" (--test-dlc)
```

A **headless** test launches no game and reads the project's documents as they stand — every story,
every row — so naming a variant or DLC for one changes nothing it looks at. The names are still
checked, and the run ends with a warning saying the build it named was not the one read. Beside
`--lint` both flags are refused, as every other `--test` flag is.

### What counts as a pass

Only `passed` exits 0. The other four are not one bucket:

| Status | Exit | Why |
| --- | --- | --- |
| `passed` | 0 `success` | The test answered, and the answer was yes. |
| `failed` | 1 `check-failed` | The test answered, and the project has to change. |
| `skipped` | 3 `refused` | The test ran and declined to answer. |
| `cancelled` | 3 `refused` | Something stopped it. No verdict was reached. |
| `errored` | 4 `studio-failed` | The test itself threw. Studio or a plugin is at fault, not the project. |

`skipped` is the one worth knowing about: the route-coverage and reachable-endings tests skip on a
project whose entry scene is chosen at run time, because there is no static answer to give. Calling
that a failure would have a nightly job reporting a broken project every night for a shape the
project is allowed to have — and calling it a pass would ship on a check that never ran. The report
carries the exact status either way.

## Lint

```sh
narraleaf-studio --lint /srv/projects/my-game --lint-report /srv/artifacts/lint.json
```

The sweep is the project's own: a rule the project turned off in **Project ▸ Project** is skipped
here too, and a finding carries the severity the project configured for its rule. Nothing about the
line changes either.

**What fails the run is the build gate's own predicate.** An error always fails it, and a warning
fails it exactly on the projects whose `failBuildOn` is set to `warning`. Inventing a second
threshold here would hand an operator a green sweep and a refused build from one project on one day.
The `runOnBuild` setting is deliberately not consulted: that one says whether a *build* stops to
lint, and this launch asked for a sweep outright.

Every finding is printed as one line — location, message, rule id — in the words the Build console
uses, because it is the same function that writes them there.

## The report

`--test-report <file>` and `--lint-report <file>` write a JSON document for **every** outcome,
including the ones that never opened a window, so a job that reads the report always finds one. It
carries the resolved project, the outcome and its exit code, the whole console with timestamps and
levels, and one of three result blocks:

- `test` — the test's id, title, **mode**, terminal status, its summary, and every finding it
  reported.
- `lint` — the counts by severity, every finding with its rule id and location, and which rules ran
  and which were skipped.
- `tests` — for `--test-list`: the registry, as described above.

The shape is `CommandLineCheckReport` in `src/shared/types/commandLineCheck.ts`. Fields are added
without a schema bump; `schema` changes only when one changes meaning.

Findings carry both an identifier and a sentence. The identifier is what a job counts or greps; the
sentence is what a person reads when the job fails at three in the morning. A report with only one
of the two is either unreadable or unusable.

## Running on a machine somebody else is using

Electron keys its single-instance lock on the profile directory, so a second Studio on the same
profile is refused and exits. A check refuses with `studio-failed` rather than handing over to the
running Studio, for the reason a build does: the run would happen inside somebody's session, against
a project they have open, while this process reported a result it has no way to know about.

`--test-user-data-dir` / `--lint-user-data-dir` give the run a profile of its own and, with it, a
lock of its own. A dedicated agent does not need one. A machine that is both an agent and somebody's
computer does.

Unlike a build, a check needs nothing else out of the profile — no signing vault, no packager
mirrors — so there is no `--test-setting` to put anything back. What a scratch profile does change is
the plugin list, and with it the test registry and whether the project can be answered for at all:
see [Plugins](#plugins). It changes nothing about the game a test
launches: whether it is sealed, which variant it is and which DLC it has are `--test-as-shipped`,
`--test-variant` and `--test-dlc`, and nothing else — never the profile's own **Preview as
shipped**, **Run as** or **Run with DLC**.

## Plugins

A run loads **the plugins the author's workspace loads for the project**, the same way: every plugin
the profile has switched on and whose permissions were approved, less any the project's own
dependency table holds back because the installed one is a different major version. So a sweep sees
the plugin nodes, widgets and story rows the **Lint** tab sees, and a test the plugins contribute is
in the registry. The run says what it loaded, on one line before the check starts:

```text
[info] Plugins: loaded "Gallery" 3.1.0, "Quick Save" 1.0.0
```

Deliberately not "only the plugins the project declares". The project's dependency table is written
when it is saved, scanned or exported, while the editor loads the profile's list; a run that loaded
less than the editor would call a node unknown that the **Lint** tab can see.

**A plugin the project declares that this profile cannot run ends the run with `studio-failed`
(exit 4)** before the check starts, and names each such plugin by its name and the version the
project was made with:

```text
[error] Plugins: this project needs "Gallery" 3.1.0, which is switched off in this profile
[error] Lint: This profile cannot run a plugin this project needs: "Gallery" 3.1.0. Install or switch it on in Studio's plugin list with this profile, or run with a profile that has it.
[error] Lint: studio-failed (exit 4)
```

"Cannot run" is the state the editor warns about when it opens the project — not installed, switched
off, or held back for its version — and two more in which a plugin is installed and on and still
contributes nothing: its permissions were never approved, or it failed to start. The editor warns and
lets the author carry on, because somebody is there to decide; a run has nobody, and carrying on
would answer about a project that is missing part of itself on this machine — a sweep full of
unknown nodes, a build without the plugin's runtime. A plugin the project does not declare that fails
to start is logged as an error and does not stop the run, as it does not stop the editor.

This matters most for a **scratch profile**: it has every plugin Studio ships, with **Gallery** and
**Menu Bar** switched off, and a project made from the starter template declares Gallery. Such a
project exits 4 in a fresh profile until Gallery is switched on in it.

`--test-list` is the one exception: it answers what this Studio and this profile have, and a plugin
the project needs but cannot have is part of that answer — so each one is logged as a warning and the
tests are listed anyway, exit 0.

A plugin that has not finished starting after sixty seconds ends the run the same way, naming the
plugin, rather than leaving it to the thirty-minute silence deadline.

## Trust

A project Studio did not create cannot run anything until it is trusted. Naming a project to
`--test` or `--lint` counts as trusting it, exactly as naming one to `--build` does: the folder is
recorded on that profile as trusted by the operator and appears under Trusted projects in Settings,
where it can be returned to waiting.

Without that, a windowed test would be refused on every project an agent had not been walked through
by hand — and the operator writing the line is the same person the Settings page would have asked.

## Nothing appears on screen

The same four things a build had to be told, told in the same place: the workspace window is created
hidden and never focused, a failed load does not reveal the home screen, nothing is opened in the
file manager, and the window may not put up a native dialog when its page stops answering. The GPU
is off for a check for the same reason it is off for a build — a machine reached over SSH has no
window server for a GPU process to attach to.

A **windowed** test is the exception, and it is an exception by definition: it launches a game
process, and that process draws. Use `--test-list` to see which tests those are before running one
on a host with no display.

That window does not have to stay in view. A game a test launches keeps drawing and keeping time
when it is minimized, moved off screen or covered by another window, so a run on a machine somebody
is using is not failed by whatever they bring to the front. Only the games tests launch behave this
way; a player's game, and a preview an author starts, pause their drawing when hidden, as Chromium
does by default.

## Nothing is asked

A question needs somebody to answer it, and a run has nobody: a file picker, a plugin asking for a
permission, one of the workspace's own dialogs, or a page's `alert()`, `confirm()` or `prompt()`
would each wait for an answer that never comes. So none of them opens. The first one asked **ends the
run with `studio-failed` (exit 4)**, on a line saying who asked for what:

```text
[error] Lint: The plugin "Cloud Sync" 1.2.0 asked for permission to use network, and a command-line run has nobody at the screen to answer it. The run stops here rather than waiting for an answer that will not come.
[error] Lint: studio-failed (exit 4)
```

Ended rather than merely refused, because whatever asked may carry on without its answer, and a run
that could not ask what the person at a screen would have been asked has not answered the question
it was run for. A permission a plugin was already granted in this profile is not asked again, so it
does not stop the run; one it has never been granted has to be granted once, in Studio, with the
profile the run uses.
