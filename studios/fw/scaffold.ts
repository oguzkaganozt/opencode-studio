import { randomUUID } from "node:crypto"
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { type FwChip, fwChipSpec } from "./chips"
import { FW_PROJECT_ID, type FwProjectManifest, projectJsonPath } from "./workspace"

const CMAKE_ROOT = `cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(fw_studio)
`

const CMAKE_MAIN = `idf_component_register(SRCS "main.c" INCLUDE_DIRS ".")
`

const MAIN_C = `#include <stdio.h>

void app_main(void)
{
    printf("Hello from Firmware Studio\\n");
}
`

export async function scaffoldFwProject(root: string, id: string, chip: FwChip) {
  if (!FW_PROJECT_ID.test(id)) throw new Error("Invalid Firmware project id")
  fwChipSpec(chip)
  const directory = path.join(root, id)
  try {
    const entries = await readdir(directory)
    if (entries.length > 0) throw new Error(`Firmware project already exists: ${id}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const staging = path.join(root, `.${id}.${randomUUID()}.tmp`)
  try {
    const mainDir = path.join(staging, "main")
    await mkdir(mainDir, { recursive: true })
    const manifest: FwProjectManifest = { id, name: id, chip }
    await writeFile(projectJsonPath(staging), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(path.join(staging, "CMakeLists.txt"), CMAKE_ROOT)
    await writeFile(path.join(staging, "sdkconfig.defaults"), "")
    await writeFile(path.join(mainDir, "CMakeLists.txt"), CMAKE_MAIN)
    await writeFile(path.join(mainDir, "main.c"), MAIN_C)
    try {
      await rename(staging, directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOTEMPTY" || (error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Firmware project already exists: ${id}`)
      }
      try {
        const entries = await readdir(directory)
        if (entries.length === 0) {
          await rm(directory, { recursive: true, force: true })
          await rename(staging, directory)
        } else {
          throw error
        }
      } catch (inner) {
        if (inner === error) throw error
        throw inner
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
  return { id, directory, chip }
}
