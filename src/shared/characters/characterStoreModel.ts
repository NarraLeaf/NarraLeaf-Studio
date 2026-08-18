import {
  CharacterGroup,
  CharacterPose,
  ICharacterAppearance,
  isCharacterAppearanceKind,
  PortraitCrop,
  PresetAppearance,
  StoredCharacter
} from "@shared/types/character/model";

/**
 * `editor/services/character.json` as a whole - the project's cast, and the only thing in
 * `editor/services/` that is the author's content rather than Studio's own state (see
 * `@shared/vcs/serviceStores`).
 *
 * `characters` is an ARRAY rather than a map keyed by id, and that is load-bearing rather than
 * historical: the array order is the order the cast is listed in, which the author arranges. A map
 * would have to store that order somewhere else or lose it to the canonical encoder's key sort.
 */
export type CharacterStoreDocument = {
  /** Absent on stores written before the appearance rework; see {@link migrateCharacterStore}. */
  version?: number;
  characters: StoredCharacter[];
  groups?: Record<string, CharacterGroup>;
};

/**
 * Bumped whenever the persisted character store changes shape. A store with no `version` predates
 * versioning and holds the form/group/variant model this module migrates away from.
 *
 * v1 → v2 added the `live2d` and `spine` appearance kinds. There is nothing to migrate *forward*:
 * every v1 store is a valid v2 store, and the bump exists entirely for the other direction. Reading
 * a store from the future is not a no-op here — {@link isCurrentAppearance} treats a kind it does not
 * recognise as the pre-rework model and rewrites it, so a Studio that has never heard of `live2d`
 * would silently replace those characters with empty presets. The version is what lets a reader
 * notice that before touching anything; see `isNewerCharacterStore`.
 */
export const CHARACTER_STORE_VERSION = 2 as const;

/**
 * Whether this store was written by a Studio newer than this one.
 *
 * A reader that answers yes must not migrate and must not write back. The kinds it is about to fail
 * to recognise are the author's data, and the destructive path is the *default* one — so the check
 * has to happen before `migrateCharacterStore`, not instead of trusting it.
 *
 * An absent version is not newer: that is the pre-versioning store, which is exactly what migration
 * is for.
 */
export function isNewerCharacterStore(version: unknown): boolean {
  return (
    typeof version === "number" && Number.isFinite(version) && version > CHARACTER_STORE_VERSION
  );
}

/** The shape the pre-v1 store held, read defensively — it was never validated on the way in. */
export type LegacyForm = {
  name?: unknown;
  groups?: unknown[];
  variantAssets?: Record<string, { data?: { id?: unknown } }>;
  portrait?: PortraitCrop;
};

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * The pose id a legacy `(form, variant)` pair migrates to.
 *
 * Deterministic on purpose: the story document has to rewrite its own rows from
 * `formName`/`variants` to a pose id, and deriving the id lets it do that without reading the
 * character store at all. The two migrations therefore do not have to run together, or even in the
 * same session — a row whose derived id names no pose is reported by the compiler as a missing
 * pose, which is the outcome we want anyway.
 */
export function legacyPoseId(formName: string, variantName: string): string {
  return `p${fnv1a(`${formName}\u0000${variantName}`)}`;
}

export type LegacyAppearanceMigration = {
  appearance: PresetAppearance;
  /**
   * Forms that declared two or more variant groups. Those were already broken before this
   * migration — the old resolver walked the selection and took the first variant that happened to
   * have an asset, so a two-axis differential never composed — and the flattening here cannot
   * recover an intent the data never expressed. Surfaced so the author can check the result.
   */
  multiGroupForms: string[];
};

/**
 * Flatten the form/group/variant model into a preset appearance: one pose per `(form, variant)`
 * that actually had an asset.
 *
 * Groups are dropped rather than translated. They only ever meant something as a cross product, and
 * the old store had nowhere to put a per-combination image (`variantAssets` is keyed by a single
 * variant name), so there is no combination data to preserve. The form name survives as the pose's
 * `folder`, which is all it was doing in practice.
 */
export function migrateLegacyAppearance(
  forms: readonly LegacyForm[],
  defaultFormName: string | null,
  profilePortrait: PortraitCrop | undefined
): LegacyAppearanceMigration {
  const poses: CharacterPose[] = [];
  const multiGroupForms: string[] = [];
  const named = forms.filter((form) => typeof form?.name === "string" && form.name.trim());
  const multipleForms = named.length > 1;

  for (const form of named) {
    const formName = (form.name as string).trim();
    const groups = Array.isArray(form.groups) ? form.groups : [];
    if (groups.length > 1) {
      multiGroupForms.push(formName);
    }

    // Group order, then variant order — the order the old resolver walked, so the first pose of
    // a form is the one it would have landed on.
    const ordered: string[] = [];
    for (const group of groups) {
      const variants = (group as { variants?: unknown[] })?.variants;
      if (!Array.isArray(variants)) continue;
      for (const variant of variants) {
        const name = (variant as { name?: unknown })?.name;
        if (typeof name === "string" && name.trim()) {
          ordered.push(name.trim());
        }
      }
    }
    // Assets can outlive the group that named them; keep them rather than drop the sprite.
    for (const name of Object.keys(form.variantAssets ?? {})) {
      if (!ordered.includes(name)) {
        ordered.push(name);
      }
    }

    for (const variantName of ordered) {
      const assetId = form.variantAssets?.[variantName]?.data?.id;
      if (typeof assetId !== "string" || !assetId) {
        continue;
      }
      // The two optional fields are SPREAD IN rather than assigned, and this is the shape the
      // whole store now has to keep. `folder: undefined` and "no folder" are the same value to
      // TypeScript and different documents to the canonical encoder, which throws on
      // `undefined` where `JSON.stringify` silently dropped it - so a pose built the assigning
      // way is a character store that cannot be saved at all, and it would surface as "the
      // characters spec is broken" rather than as "this file is corrupt". Inside a migration
      // it is worse still: it reaches every project that has not been opened since the
      // appearance rework, at the moment they are opened.
      const portrait = form.portrait ?? profilePortrait;
      poses.push({
        id: legacyPoseId(formName, variantName),
        name: multipleForms ? `${formName}·${variantName}` : variantName,
        ...(multipleForms ? { folder: formName } : {}),
        assetId,
        ...(portrait ? { portrait } : {})
      });
    }
  }

  // The old default was a *form*; its first pose is the sprite that form would have shown.
  const defaultForm = defaultFormName?.trim();
  const preferred = defaultForm ? poses.find((pose) => pose.folder === defaultForm) : undefined;

  return {
    appearance: {
      kind: "preset",
      poses,
      defaultPoseId: (preferred ?? poses[0])?.id ?? null
    },
    multiGroupForms
  };
}

export type CharacterMigrationReport = {
  migrated: number;
  /** `characterName › formName` for every form that was already broken. See {@link LegacyAppearanceMigration}. */
  multiGroupForms: string[];
};

type LegacyCharacterConfig = {
  profile?: {
    name?: unknown;
    defaultForm?: unknown;
    portrait?: PortraitCrop;
    appearance?: { forms?: unknown[] } | ICharacterAppearance;
  };
};

/**
 * True for anything already carrying the current model, so migration is idempotent.
 *
 * Asked of the shared kind list rather than spelled out here, because the answer for an
 * *unrecognised* kind is not "leave it alone" — it is "read it as the pre-rework store and rewrite
 * it", which discards the appearance. A kind this does not recognise is therefore deleted on the
 * next load rather than merely unsupported.
 */
function isCurrentAppearance(appearance: unknown): appearance is ICharacterAppearance {
  return isCharacterAppearanceKind((appearance as { kind?: unknown } | null)?.kind);
}

/**
 * Migrate a raw character store in place. Characters already on the two-kind model are left alone,
 * so this is safe to run on every load.
 */
export function migrateCharacterStore(characters: unknown[]): CharacterMigrationReport {
  const report: CharacterMigrationReport = { migrated: 0, multiGroupForms: [] };

  for (const entry of characters) {
    const config = entry as LegacyCharacterConfig;
    const profile = config?.profile;
    if (!profile || isCurrentAppearance(profile.appearance)) {
      continue;
    }
    const forms = Array.isArray((profile.appearance as { forms?: unknown[] })?.forms)
      ? ((profile.appearance as { forms?: unknown[] }).forms as LegacyForm[])
      : [];
    const defaultForm = typeof profile.defaultForm === "string" ? profile.defaultForm : null;
    const { appearance, multiGroupForms } = migrateLegacyAppearance(
      forms,
      defaultForm,
      profile.portrait
    );

    profile.appearance = appearance;
    delete (profile as { defaultForm?: unknown }).defaultForm;

    const characterName =
      typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : "(unnamed)";
    report.multiGroupForms.push(
      ...multiGroupForms.map((formName) => `${characterName} › ${formName}`)
    );
    report.migrated += 1;
  }

  return report;
}
