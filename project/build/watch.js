const esbuild = require('esbuild');

/**
 * Generic helper to build & watch with esbuild.
 * Ensures onSuccess is called after initial build and on subsequent rebuilds.
 * @param {import('esbuild').BuildOptions} options esbuild options
 * @param {() => void} onSuccess callback when build succeeds
 * @returns {Promise<import('esbuild').BuildContext>}
 */
async function watchBuild(options, onSuccess = () => {}) {
  const ctx = await esbuild.context(options);

  // Trigger the initial build explicitly and invoke success callback
  try {
    await ctx.rebuild();
    onSuccess();
  } catch (err) {
    console.error(`[watch] initial build failed`, err);
  }

  // Start watching for file changes; callback fires on rebuilds
  await ctx.watch((err) => {
    if (err) {
      console.error(`[watch] build failed`, err);
      return;
    }
    onSuccess();
  });
  return ctx;
}

module.exports = {
  watchBuild,
};
