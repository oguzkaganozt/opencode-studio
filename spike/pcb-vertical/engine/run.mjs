import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runAllNetlistChecks, runAllPlacementChecks } from "@tscircuit/checks"

const projectDir = process.argv[2]
if (!projectDir) {
  console.error("usage: node run.mjs <projectDir>")
  process.exit(2)
}

const engineRoot = path.dirname(fileURLToPath(import.meta.url))
const tsci = path.join(engineRoot, "node_modules", "tscircuit", "cli.mjs")
const circuitJsonPath = path.join(projectDir, "dist", "src", "circuit", "circuit.json")

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: error.message })
    })
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

const bun = process.env.BUN_BIN || "bun"
const built = await run(bun, [tsci, "build", "src/circuit.tsx"], {
  ...process.env,
  NODE_PATH: path.join(engineRoot, "node_modules"),
})
if (built.code !== 0) {
  process.stdout.write(
    JSON.stringify({
      engine: "tscircuit",
      status: "fail",
      findings: [{ severity: "error", message: (built.stderr || built.stdout || "tsci build failed").trim() }],
    }),
  )
  process.exit(0)
}

const circuitJson = JSON.parse(await readFile(circuitJsonPath, "utf8"))
const issues = [...(await runAllNetlistChecks(circuitJson)), ...(await runAllPlacementChecks(circuitJson))]
const findings = issues.map((issue) => ({
  severity: "error",
  message: String(issue?.message || issue?.type || "drc"),
}))

process.stdout.write(
  JSON.stringify({
    engine: "tscircuit",
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    circuitJsonPath,
  }),
)
