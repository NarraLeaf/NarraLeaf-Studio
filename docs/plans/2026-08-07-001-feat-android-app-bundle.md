# Android App Bundle output

Studio's Android target produced only a signed `.apk`, and the build dialog told
authors that Google Play accepts only AABs "which this pipeline does not
produce" — a warning with no way out. It now produces the AAB.

## The decision: a format, not a target

**AAB is a format of the `android` platform, alongside `apk`** — the same shape
Windows already has with `nsis` / `zip` / `dir`. It is not a second build
target.

The two packages share everything upstream: one compiled site, one shell
template, one application id, one version code, one icon set, and **one signing
credential**. They diverge only in the container and the signature scheme. A
second platform would have forked the Android identity block and, because
`SIGNING_CREDENTIAL_PLATFORM` keys credentials by platform, forced an author to
register the same keystore twice. "Play or sideload" is a distribution channel,
and the platform field everywhere else means "what hardware".

`DEFAULT_FORMATS.android` stays `["apk"]`. Building both deflates a whole game
payload twice (the encryption pass is shared — payload entries are built once,
before the per-platform branch), and the preflight warning is what points an
author at the AAB.

**One keystore serves both.** Under Play App Signing the author holds only an
upload key, and the keystore they already configured *is* that upload key. The
APK carries the identity as an APK Signature Scheme v2 block, the AAB as a JAR
signature — different encodings of the same key, not different keys.

## Mechanism: pure TypeScript, no Gradle and no toolchain

There is no Gradle project in this product, and none was added. The APK is built
by repacking a prebuilt template APK from `@narraleaf/studio-shell`; the AAB is
built the same way, by converting that template's compiled resources into the
protobuf forms a bundle requires. Nothing is downloaded and no JDK, aapt2 or
bundletool ships or runs at build time.

| Module | Job |
|---|---|
| `protobufWriter.ts` | wire-format writer (varint / length-delimited / fixed32 / nested) |
| `axmlProto.ts` | binary `AndroidManifest.xml` → `aapt.pb.XmlNode` |
| `arscProto.ts` | `resources.arsc` → `aapt.pb.ResourceTable` |
| `aabBundle.ts` | path mapping + `BundleConfig.pb` / `native.pb` / `assets.pb` |
| `buildAab.ts` | orchestrator; returns an **unsigned** bundle |
| `jarSigning.ts` | JAR v1 signing (`MANIFEST.MF` / `.SF` / PKCS#7 `.RSA`) + verifier |

`runMobileRepack.ts` composes the last two: `signJar(await buildAab(shell), identity)`.

Bundle layout, module-relative under `base/`: `manifest/AndroidManifest.xml`,
`resources.pb`, `dex/`, `res/`, `lib/`, `assets/`, and everything else under
`root/`.

## Traps that cost real time — do not "fix" these back

- **`assets.pb` lists only directories that DIRECTLY contain a file.** bundletool's
  `AssetsTargetingValidator` rejects the bundle with `Targeted directory '<path>'
  is empty` when a listed directory holds only subdirectories, failing both
  `validate` and `build-apks`. A payload with nothing directly in `assets/www`
  declares `assets/www/js`, not `assets/www`. This only bites on a real bundler-
  produced site, which is why it survived the synthetic fixtures and was caught
  by an end-to-end build of the skeleton template.
- **`Bundletool.version` is field 2 in `BundleConfig.pb`, not field 1.**
- **Do not point `signJar` at an APK.** It prepends entries, which shifts every
  offset and destroys zipalign. Harmless for a bundle (never installed;
  bundletool re-emits the APKs), fatal for an APK.
- **JAR manifest lines wrap at 72 *bytes*** with single-space continuations. Long
  asset paths exceed it on every real build, so this path is always exercised.
- **`.SF` per-entry digests cover the manifest section text**, not the file
  contents. Getting this wrong yields a signature that verifies against nothing.
- **`SignerInfo.signatureAlgorithm` is `rsaEncryption`**, per RFC 3370 §3.2 and
  what `jarsigner` writes — not `sha256WithRSAEncryption`.

## Verification recipe

None of this is provable from inside Studio, so the oracles are external. On
this machine: Java 17 (Temurin JRE), `bundletool` 1.18.1 and `aapt2` 2.19 were
fetched to a scratch dir; the authoritative `Resources.proto`, `Configuration.proto`
and `config.proto` come out of `bundletool.jar` itself, so no field number is
guessed.

- `bundletool validate --bundle=x.aab` — structural legality.
- `bundletool build-apks --mode=universal` — the strong one: bundletool converts
  our protobuf back to binary `AndroidManifest.xml` + `resources.arsc`. If the
  conversion lost anything, the round trip shows it.
- `bundletool dump manifest` / `dump resources --values` — compare against
  `aapt2 convert --output-format proto` on the same template.
- `keytool -printcert -jarfile x.aab` — reads every entry through OpenJDK's own
  `JarVerifier`, the implementation family that checks an uploaded bundle. This
  is the closest available proxy for Play's ingestion; bundletool does **not**
  verify JAR signatures.

`androidBundleOracle.test.ts` wires the first three in as an opt-in suite
(`BUNDLETOOL_JAR`, `AAPT2`, `REQUIRE_ANDROID_BUNDLE_ORACLE=1`), skipping cleanly
when the tools are absent, mirroring `androidSdkOracle.test.ts`. The JRE-gated
`keytool` block lives in `jarSigning.test.ts`.

Every assertion is paired with a reverse control: a flipped byte must fail.

## Known gaps

- **Nothing has been uploaded to Google Play.** The evidence is Google's own
  tooling plus OpenJDK's verifier, not an accepted upload.
- **`base/resources.pb` is smaller than aapt2's** (446 B vs 570 B for the
  template) because provenance-only fields — `source_pool`, `tool_fingerprint`,
  and the empty `Source`/`Visibility` submessages aapt2 stamps everywhere — are
  omitted. The oracle asserts semantic equivalence by decoding both.
- **`res/**.xml` is unsupported.** The current shell template carries only PNGs
  under `res/`; a compiled binary XML resource would need proto conversion too,
  and `buildAab` fails loudly rather than shipping binary XML into a bundle.
- **No splits.** One `base` module, no ABI/density/language splits.
