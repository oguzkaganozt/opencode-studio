import { mkdir, readdir, writeFile } from "node:fs/promises"
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
  const mainDir = path.join(directory, "main")
  await mkdir(mainDir, { recursive: true })
  const manifest: FwProjectManifest = { id, name: id, chip }
  await writeFile(projectJsonPath(directory), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(path.join(directory, "CMakeLists.txt"), CMAKE_ROOT)
  await writeFile(path.join(directory, "sdkconfig.defaults"), "")
  await writeFile(path.join(mainDir, "CMakeLists.txt"), CMAKE_MAIN)
  await writeFile(path.join(mainDir, "main.c"), MAIN_C)
  return { id, directory, chip }
}
