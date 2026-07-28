import { createOpenCodeStudioPlugin } from "./plugin-factory"

/** OpenCode server entry — default export only (OpenCode 1.18 legacy loader rejects extra function/object exports). */
export default createOpenCodeStudioPlugin()
