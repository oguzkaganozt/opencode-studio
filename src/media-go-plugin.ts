import type { Plugin } from "@opencode-ai/plugin"
import { loadPackageMeta } from "./core/package-meta"
import { packageRootFrom } from "./core/paths"
import { loadMediaGoProviderPlugin } from "./platform/media/plugin"

/** Auxiliary media plugin export for the opencode-go native-media provider hook. */
const MediaGoPlugin: Plugin = async (_context, rawOptions) => {
  const packageRoot = packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const providerPackage =
    typeof rawOptions?.providerPackage === "string" && rawOptions.providerPackage.length > 0
      ? rawOptions.providerPackage
      : meta.mediaProviderSpecifier
  const plugin = loadMediaGoProviderPlugin({ providerPackage })
  return plugin(_context, { providerPackage })
}

export default MediaGoPlugin
