import type { dominantDirection } from "./geometry"

export const PART_COLORS = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0xbfef45, 0xfabed4, 0x469990, 0xdcbeff, 0x9a6324,
  0xfffac8, 0x800000, 0xaaffc3, 0x808000, 0xffd8b1, 0x000075, 0xa9a9a9,
]

export type ClickInfo = {
  position: { x: number; y: number; z: number }
  normal: { x: number; y: number; z: number }
  part: string
  direction: ReturnType<typeof dominantDirection>
  partIndex: number
}

export type LoadPart = {
  name: string
  url: string
  color: number
}

export type SceneHandle = {
  parts: Array<{ name: string; visible: boolean; origColor: number }>
  fitCamera: () => void
  setPartVisible: (index: number, visible: boolean) => void
}
