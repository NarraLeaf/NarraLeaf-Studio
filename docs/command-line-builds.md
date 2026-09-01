# Command-line builds

`narraleaf-studio --build <project>` produces one build of one project with no interface at all and
exits with a code. It exists for a machine with nobody at the keyboard: a build agent, a Mac reached
over SSH, a scheduled release job.

It is an entry point, not a second build system. Everything that decides whether a project may ship
already runs in the workspace, and this reuses it where it is — a check that answered differently
depending on whether a person or a script started the build would be worse than having no script at
all. What belongs to this entry point alone is the command line, the exit codes and the report.

The implementation is `src/main/app/application/commandLineBuild.ts`; the flags are parsed in
`commandLine.ts` and turned into one request by `commandLineBuildPlan.ts`.

## One invocation, one artifact set

`--build` is deliberately not a matrix. A run that produced several targets would have to answer
"what does the exit code mean when two of five failed", and every answer to that is worse than
running the command twice. One variant, one platform, one format, one exit code.

## The flags

| Flag | What it takes | Default |
| --- | --- | --- |
| `--build` | A project folder, or the name of a recently-opened project | — (required) |
| `--build-variant` | A build variant id | `main`, the release variant |
| `--build-target` | `windows`, `macos`, `linux`, `web`, `android`, `ios` | the host's own platform |
| `--build-format` | One format of that platform | the platform's first (`zip` for the desktops and the web, `apk`, `ipa`) |
| `--build-arch` | `x64`, `arm64`, `universal`; desktop only | the host's arch for a host build, `x64` otherwise |
| `--build-output` | Where the artifacts land; relative to the working directory | `<project>/dist` |
| `--build-report` | Where to write the JSON report | no report file |
| `--build-allow-unsigned` | — | the run stops rather than shipping unsigned |
| `--build-user-data-dir` | A profile folder for this run | the machine's own profile |
| `--build-signing` | A JSON file naming this run's signing credentials | the project's own selection, from the machine's vault |
| `--build-setting` | `key=value`, repeatable; `build.*` keys only | the profile's settings |

Every value-taking flag accepts both `--flag value` and `--flag=value`.

A companion flag given without `--build` is refused rather than ignored: the alternative is a launch
that opens the editor while the script that wrote the line believes it is building.

## Exit codes

| Code | Outcome | What it means |
| --- | --- | --- |
| 0 | `success` | The build ran and wrote its artifacts. |
| 1 | `build-failed` | The checks passed and the build did not finish. |
| 2 | `invocation` | The command line could not be acted on. Nothing was opened. |
| 3 | `gate-refused` | A check refused the project. Retrying changes nothing until the project does. |
| 4 | `studio-failed` | Studio could not get far enough to answer. Says nothing about the project. |

The distinction that matters most is between `gate-refused` and `studio-failed`. A project whose
story has an unresolved command is a project someone has to change; Studio failing to open the
project is a machine someone has to look at. Collapsing them would make "retry the job" the right
answer half the time and a waste of ten minutes the other half.

## The report

`--build-report <file>` writes a JSON document for **every** outcome, including the ones that never
opened a window, so a job that reads the report always finds one. It carries the request as it was
resolved, every preflight finding, the artifacts and their sizes, the whole build console with
timestamps, and two blocks a job would otherwise have to grep English for:

- `signing` — whether this platform *can* carry a signature, whether this build did, whether
  `--build-allow-unsigned` was passed, and (when it was signed) whether the credential came from the
  machine's vault or from `--build-signing`.
- `experimental` — what experimental mode did to this run. A debuggable build looks like any other
  build on disk, so this is the only place a job that archived one can find out.

The shape is `CommandLineBuildReport` in `src/shared/types/commandLineBuild.ts`. Fields are added
without a schema bump; `schema` changes only when one changes meaning.

## Running on a machine somebody else is using

Electron keys its single-instance lock on the profile directory, so a second Studio on the same
profile is refused and exits. That is right for a launch that wants a window — the running Studio
opens it — and useless for one that wants an exit code, so a build refuses instead, with
`studio-failed`, rather than running inside somebody's session.

`--build-user-data-dir <folder>` gives the run a profile of its own and, with it, a lock of its own.
A dedicated agent does not need it. A machine that is both an agent and somebody's computer does.

**A different profile is a different everything.** The signing vault lives under it, and so do the
machine's build settings — a scratch profile has neither. That is what the next two sections are
for.

Whether the *download* caches come with it depends on the install. `resolveCacheRoot` puts them
beside the executable where the platform allows that, and under the profile where it does not:
macOS never allows it (writing into the bundle breaks its ad-hoc signature), nor does an AppImage,
nor does a per-machine Windows install the user cannot write to. So a throwaway profile on a Mac
re-downloads the Electron distribution it needs, and one on an ordinary Windows install does not.

## Signing

Two routes, and a build agent will use one of them.

**The machine's vault.** Import the credential once through the Build dialog's Signing section; the
project stores its id and every later build on that machine picks it up. Nothing on the command line
is needed. This is per profile, so it does not survive `--build-user-data-dir`.

**`--build-signing <file>`.** A JSON document naming the credentials for this run only. Nothing is
imported, so a machine that built once is no closer to being able to sign than it was before — which
is the point, because a credential a job carried in should leave with it. What the file names
overrides the project's selection for those platforms.

```json
{
  "windows": { "kind": "windows-pfx", "file": "certs/app.pfx", "passwordEnv": "PFX_PASSWORD" },
  "macos": {
    "kind": "macos-apple",
    "p12File": "certs/developer-id.p12",
    "p12PasswordEnv": "P12_PASSWORD",
    "notaryKeyFile": "certs/notary.p8",
    "notaryKeyId": "ABCD1234",
    "notaryIssuerId": "6a0e1111-2222-3333-4444-555566667777"
  },
  "linux": { "kind": "linux-gpg", "keyId": "8A1C0000" }
}
```

One entry per signing platform, each naming a credential kind and that kind's own fields — the same
fields the vault stores. File fields are resolved against the file's own directory, so a credentials
bundle can be copied onto an agent whole and still work wherever it lands.

Every secret may be given inline or, better, as `<field>Env` naming an environment variable to read
it from. Both spellings exist because both jobs exist: a file assembled by a secret manager already
holds the value, and a file checked into a pipeline's own configuration must not. Giving both is
refused rather than resolved by precedence.

A file that holds secrets inline is a file with the same weight as the key beside it. Studio never
logs it, never copies it, and writes no part of it into the report — but it cannot enforce its
permissions, so that is the job's business.

Whichever route it came from, a target that could carry a signature and has no credential reports an
`unsigned` finding, and the run stops on it. The Build dialog shows that to an author before they
commit; a command line has nobody to show, so the acceptance has to be stated with
`--build-allow-unsigned`.

## Settings a build reads

A build reads a few machine-level settings — which Electron mirror to download from, where the
packager's own binaries come from, the Zig mirror. A run in a scratch profile has none of them.

```sh
--build-setting build.electronMirror=https://mirror.example/electron/
```

Repeatable. Restricted to the `build.` namespace: the flag exists to make a throwaway profile usable
for a build, not to be a general way of writing over whatever a person configured. The values are
read for the run and written nowhere. An empty value (`build.electronMirror=`) means the official
source, which is how a run overrides a mirror the profile has set.

The build console names the settings a run was given by key only, and the report carries none of
them. Their values are URLs a job assembled, and a mirror URL carrying an access token is a token in
a file somebody archives.

## Nothing appears on screen, and nothing needs a display

The operator may be using this machine, and an agent has no screen at all. Four separate things had
to be told: the workspace window is created hidden and never focused; a failed load does not reveal
the home screen; the output folder is never opened in the file manager; and the window may not put
up a native dialog when its page crashes, which would otherwise block the run on an answer nobody is
there to give.

Two more things make a headless host work at all:

- **The GPU is off for a build.** A machine reached over SSH has no window server for a GPU process
  to attach to; on macOS that is `GPU process isn't usable. Goodbye.` and a launch that never
  becomes ready. Software rendering costs a hidden window nothing worth measuring, so this is
  unconditional for `--build` rather than a flag somebody has to know to pass.
- **Icons are converted in-process.** Handed a PNG, electron-builder converts it to `.icns`/`.ico`
  by running its converter with `process.execPath` — which inside Studio starts a *second* Electron,
  and on a machine with no window server that Electron dies and takes the build with it
  (`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`). Studio writes the containers itself before the packager
  starts, from the project's icon, and caches them under `.nlstudio/build/desktop-icons/`. Handed a
  file that already carries the target extension, electron-builder skips its converter entirely.

## What a host can build

macOS builds require a Mac; Linux builds require a Unix host. `--build-target` refuses anything else
before opening the project, with the same sentence the Build dialog uses — it is the same fact.

## Worked example

```sh
narraleaf-studio \
  --build /srv/projects/my-game \
  --build-target macos --build-format dmg --build-arch universal \
  --build-output /srv/artifacts/my-game \
  --build-report /srv/artifacts/my-game/report.json \
  --build-user-data-dir /var/lib/narraleaf-agent/profile \
  --build-signing /run/secrets/signing.json \
  --build-setting build.electronMirror=https://mirror.example/electron/
```

How that line is delivered to the machine — SSH, a CI runner, a scheduler — is outside Studio.
