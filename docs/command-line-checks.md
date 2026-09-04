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
| `--test-report` | Where to write the JSON report | no report file |
| `--test-user-data-dir` | A profile folder for this run | the machine's own profile |
| `--lint` | A project folder, or the name of a recently-opened project | — (required for a sweep) |
| `--lint-report` | Where to write the JSON report | no report file |
| `--lint-user-data-dir` | A profile folder for this run | the machine's own profile |

Every value-taking flag accepts both `--flag value` and `--flag=value`.

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

One line per test: the id, the mode, the category, the title, whether it can run right now (and why
not when it cannot), and the parameters it takes with the values each accepts. With `--test-report`
the same rows are written to the report as structured data, which is what a script assembling a
command line reads.

The registry is populated by Studio's own modules **and by every installed plugin**, so the listing
is a property of the Studio and the profile the run uses — not of the project alone. A run in a
scratch profile lists the tests Studio ships and none a plugin contributes.

### Running one

```sh
narraleaf-studio --test /srv/projects/my-game \
  --test-id narraleaf-studio:reachable-endings \
  --test-parameter ending=good \
  --test-report /srv/artifacts/test.json
```

`--test-parameter` names one value the test declared. A `select` parameter accepts its option
**values**, never the labels — a label follows the editor's language, and a line written against one
would stop working when somebody changed it. A `boolean` accepts `true`/`false`, `yes`/`no`,
`on`/`off`, `1`/`0`. Anything the test does not declare, a `select` value it does not offer, or one
id given twice is refused as a bad invocation rather than falling back on the default: a run that
quietly walked to a different ending than the line named would report a green verdict about
something nobody asked for.

Parameters the line does not name fall to the test's own default, which is what the picker would
have started on.

### What counts as a pass

Only `passed`. `skipped` is the test declining to answer and `cancelled`/`errored` are verdicts the
host reached about it — none of them is the project having passed a check, and a job that read them
as a green tick would ship on a check that never ran. The report carries the exact status, so a job
that wants to treat `skipped` as acceptable can.

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

Unlike a build, a check reads nothing else out of the profile — no signing vault, no packager
mirrors — so there is no `--test-setting` to put anything back and no reason for one. What a scratch
profile does change is the plugin list, and with it the test registry: see above.

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
