import { loadPackageMeta } from "./core/package-meta"
import { packageRootFrom } from "./core/paths"
import { checkNpmUpdate } from "./core/update-check"

export const PACKAGE_NAME = "@oguzkaganozt/opencode-studio"

const OPENCODE_RESTART_HINT = "Restart OpenCode so its unversioned plugin registration resolves the new package."

export type UpgradeOptions = {
  packageRoot?: string
}

export async function checkPackageUpgrade(options: UpgradeOptions = {}) {
  const packageRoot = options.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const info = await checkNpmUpdate({ packageName: meta.name, current: meta.version })
  if (info.error && !info.latest) {
    return {
      action: "check" as const,
      packageName: meta.name,
      current: meta.version,
      latest: undefined as string | undefined,
      updateAvailable: false,
      error: info.error,
      message: `Could not check registry: ${info.error}`,
    }
  }
  if (info.updateAvailable && info.latest) {
    return {
      action: "check" as const,
      packageName: meta.name,
      current: meta.version,
      latest: info.latest,
      updateAvailable: true,
      message: info.message ?? `Update available: ${meta.version} → ${info.latest}. Run: opencode-studio upgrade`,
    }
  }
  return {
    action: "check" as const,
    packageName: meta.name,
    current: meta.version,
    latest: info.latest ?? meta.version,
    updateAvailable: false,
    message: `Up to date (${meta.version}).`,
  }
}

/** bun add -g @latest. Restart OpenCode after. */
export async function upgradePackage(options: UpgradeOptions = {}): Promise<{
  action: "upgrade"
  packageName: string
  installOutput: string
  message: string
  restartOpenCode: true
}> {
  const packageRoot = options.packageRoot ?? packageRootFrom(import.meta.dir)
  const meta = await loadPackageMeta(packageRoot)
  const packageName = meta.name || PACKAGE_NAME
  const bun = Bun.which("bun")
  if (!bun) throw new Error("bun not found on PATH (required to install/upgrade opencode-studio)")
  const install = Bun.spawn([bun, "add", "-g", `${packageName}@latest`], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(install.stdout).text(), new Response(install.stderr).text(), install.exited])
  if (code !== 0) throw new Error(err.trim() || out.trim() || "bun add -g failed")
  const installOutput = (out.trim() || err.trim()).trim()
  return {
    action: "upgrade",
    packageName,
    installOutput,
    restartOpenCode: true,
    message: [`Updated ${packageName}.`, installOutput, "", OPENCODE_RESTART_HINT].filter(Boolean).join("\n").trim(),
  }
}
