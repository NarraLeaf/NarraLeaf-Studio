/**
 * The build report: what one finished production build or patch export produced, and what it carried
 * out of the asset library.
 *
 * The run itself belongs to `BuildService` and the live output to the build console channel; nothing
 * here starts, stops or measures anything.
 */
export { BuildReportTab } from "./BuildReportTab";
export { buildReportModule, createBuildReportTab, openBuildReportTab } from "./openBuildReportTab";
export { BUILD_REPORT_TAB_ID } from "./buildReportIds";
export {
    artifactFileName,
    buildArtifactRows,
    filterShippedAssets,
    formatBuildDuration,
    groupShippedAssets,
    shippedAssetReport,
    totalArtifactBytes,
    type BuildArtifactRow,
    type ShippedAssetGroup,
} from "./buildReportModel";
