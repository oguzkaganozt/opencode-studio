import { randomUUID } from "node:crypto"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { canonicalExistingDirectory } from "../../core/paths"
import { generateImage, type ImageGenerateDeps } from "./generate"
import { prepareNewOutput, readSecureFile, verifyOutputParent, writeNewFileAtomic } from "./path"

export function createImageGeneratePlugin(deps?: ImageGenerateDeps): Plugin {
  return async (context) => {
    const workspaceRoot = await canonicalExistingDirectory(context.directory, "workspace")

    return {
      tool: {
        image_generate: tool({
          description:
            "Generate or edit one still image. Uses ChatGPT OAuth, then xAI Grok Imagine quality, then fal Nano Banana 2. Pass local image paths in images to edit. Writes a new file and never overwrites.",
          args: {
            prompt: tool.schema.string().min(1).describe("What to generate, or how to edit the attached images"),
            outputPath: tool.schema
              .string()
              .optional()
              .describe("Workspace-relative output path. Defaults to image-<id>.<ext> in the workspace root"),
            images: tool.schema
              .array(tool.schema.string())
              .max(10)
              .optional()
              .describe("Optional local reference image paths under the workspace. When set, the request is an edit"),
          },
          async execute(args, toolContext) {
            const reserved = args.outputPath
              ? await prepareNewOutput({ root: workspaceRoot, outputPath: args.outputPath, ask: toolContext.ask })
              : undefined
            const references: Buffer[] = []
            for (const filePath of args.images ?? []) {
              const file = await readSecureFile({
                root: workspaceRoot,
                filePath,
                maxBytes: 20 * 1024 * 1024,
                signal: toolContext.abort,
                ask: toolContext.ask,
              })
              references.push(file.bytes)
            }
            const image = await generateImage({
              prompt: args.prompt,
              referenceImages: references,
              signal: toolContext.abort,
              deps,
            })
            const target =
              reserved ??
              (await prepareNewOutput({
                root: workspaceRoot,
                outputPath: `image-${Date.now()}-${randomUUID().slice(0, 8)}${image.extension}`,
                ask: toolContext.ask,
              }))
            await verifyOutputParent(workspaceRoot, target.outputPath)
            await writeNewFileAtomic(target.outputPath, image.bytes)
            return {
              title: target.relativePath,
              output: `Wrote ${image.provider} image to ${target.relativePath}`,
              metadata: {
                filePath: target.outputPath,
                relativePath: target.relativePath,
                mime: image.mime,
                bytes: image.bytes.length,
                width: image.width,
                height: image.height,
                provider: image.provider,
                mode: references.length > 0 ? "edit" : "generate",
              },
            }
          },
        }),
      },
    }
  }
}
