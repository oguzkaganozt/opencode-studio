import type { Plugin } from "@opencode-ai/plugin"
import { loadMediaGoProviderPlugin } from "../studios/media/plugin"
import { loadPackageMeta } from "./core/package-meta"
import { packageRootFrom } from "./core/paths"

/** Auxiliary Media plugin export for the opencode-go native-media provider hook. */
const MediaGoPlugin: Plugin = async (context, rawOptions) => {
  const packageRoot = packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const providerPackage =
    typeof rawOptions?.providerPackage === "string" && rawOptions.providerPackage.length > 0
      ? rawOptions.providerPackage
      : meta.mediaProviderSpecifier
  const plugin = loadMediaGoProviderPlugin({
    libraryRoot: context.directory,
    providerPackage,
  })
  return plugin(context, { providerPackage })
}

export default MediaGoPlugin
