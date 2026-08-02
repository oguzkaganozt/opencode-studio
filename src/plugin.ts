import { createOpenCodeStudioPlugin } from "./plugin-factory"
import { scheduleServeBootstrap } from "./serve-bootstrap"

// When OpenCode loads this module (config plugin list / first Instance), start host
// as soon as parent serve is reachable — fixed Studio Home, independent of active projects.
scheduleServeBootstrap()

/** OpenCode server entry — default export only (OpenCode 1.18 legacy loader rejects extra function/object exports). */
export default createOpenCodeStudioPlugin()
