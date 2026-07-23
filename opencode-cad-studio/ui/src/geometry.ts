export type NormalVector = { x: number; y: number; z: number }

export function dominantDirection(normal: NormalVector): "right" | "left" | "top" | "bottom" | "front" | "back" {
  const axes = [
    { key: "x" as const, positive: "right" as const, negative: "left" as const },
    { key: "y" as const, positive: "top" as const, negative: "bottom" as const },
    { key: "z" as const, positive: "front" as const, negative: "back" as const },
  ]
  const dominant = axes.reduce((current, candidate) =>
    Math.abs(normal[current.key]) >= Math.abs(normal[candidate.key]) ? current : candidate,
  )
  return normal[dominant.key] >= 0 ? dominant.positive : dominant.negative
}
