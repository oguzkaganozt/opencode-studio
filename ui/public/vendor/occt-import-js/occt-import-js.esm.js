/**
 * ESM facade for the vendored UMD build of occt-import-js.
 * @tscircuit/3d-viewer dynamic-imports jsDelivr `+esm`; our Vite plugin rewrites
 * that URL here so STEP→GLB works offline/same-origin. The UMD file only sets
 * `module.exports` / a classic-script global — it has no ESM exports.
 */
const globalKey = "__opencodeStudioOcctImportJs"

function readFactory() {
  if (typeof globalThis[globalKey] === "function") return globalThis[globalKey]
  // Classic script top-level `var occtimportjs` lands on globalThis.
  if (typeof globalThis.occtimportjs === "function") {
    globalThis[globalKey] = globalThis.occtimportjs
    return globalThis.occtimportjs
  }
  return null
}

let loadPromise

function loadUmdFactory() {
  const existing = readFactory()
  if (existing) return Promise.resolve(existing)
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = new URL("./occt-import-js.js", import.meta.url).href
    script.async = true
    script.onload = () => {
      const factory = readFactory()
      if (typeof factory === "function") resolve(factory)
      else reject(new Error("occt-import-js UMD loaded without a factory export"))
    }
    script.onerror = () => reject(new Error("Failed to load occt-import-js.js"))
    document.head.appendChild(script)
  }).catch((err) => {
    loadPromise = undefined
    throw err
  })

  return loadPromise
}

const factory = await loadUmdFactory()
export default factory
