/**
 * The document specs a team project's authority reads, each from its own module so that the kernel
 * bundle takes only what it needs (the barrel at `documents/specs` also carries the project file,
 * whose binary encoder must not reach the Team server).
 */
export { appTagsSpec } from "@shared/documents/specs/appTags";
export { assetGroupsSpec } from "@shared/documents/specs/assetGroups";
export { assetSetsSpec } from "@shared/documents/specs/assetSets";
export { assetsMetadataSpec } from "@shared/documents/specs/assetsMetadata";
export { audioTracksSpec } from "@shared/documents/specs/audioTracks";
export { brandSpec } from "@shared/documents/specs/brand";
export { charactersSpec } from "@shared/documents/specs/characters";
export { dictionarySpec } from "@shared/documents/specs/dictionary";
export { dlcSpec } from "@shared/documents/specs/dlc";
export { localizationDocumentSpec } from "@shared/documents/specs/localization";
export { localizationKeysSpec } from "@shared/documents/specs/localizationKeys";
export { uiDocumentSpec } from "@shared/documents/specs/uiDocument";
export { uiGraphsSpec } from "@shared/documents/specs/uiGraphs";
export { variableRegistrySpec } from "@shared/documents/specs/variables";
export { voiceDocumentSpec } from "@shared/documents/specs/voice";
