import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import path from "node:path"
import { listNotes, noteFileName, readNote, writeNote } from "./notes"
import { canonicalDataRoot } from "./studio-path"

function asJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export const ReferenceStudioPlugin: Plugin = async (context, rawOptions) => {
  const dataRootOption =
    typeof rawOptions?.dataRoot === "string" && rawOptions.dataRoot.length > 0 ? rawOptions.dataRoot : context.directory
  const dataRoot = await canonicalDataRoot(dataRootOption)

  return {
    tool: {
      reference_list: tool({
        description: "List reference notes under the Data Root (*.note.json).",
        args: {},
        async execute() {
          return asJson({ notes: await listNotes(dataRoot) })
        },
      }),
      reference_read: tool({
        description: "Read one reference note by id.",
        args: {
          id: tool.schema.string(),
        },
        async execute(args) {
          return asJson(await readNote(dataRoot, args.id))
        },
      }),
      reference_write: tool({
        description: "Create or replace a reference note. Requests edit permission for the note file.",
        args: {
          id: tool.schema.string(),
          title: tool.schema.string(),
          body: tool.schema.string(),
        },
        async execute(args, toolContext) {
          const fileName = noteFileName(args.id)
          await toolContext.ask({
            permission: "edit",
            patterns: [path.join(dataRoot, fileName)],
            always: [],
            metadata: {},
          })
          const note = await writeNote(dataRoot, {
            id: args.id,
            title: args.title,
            body: args.body,
          })
          return asJson(note)
        },
      }),
    },
  }
}

export default ReferenceStudioPlugin
