// Displayed application version. The value comes from package.json via the
// APP_VERSION env injected in next.config.ts, so the version is maintained in a
// single place (package.json) and inlined into both server and client bundles.
export const APP_VERSION = process.env.APP_VERSION ?? ''
