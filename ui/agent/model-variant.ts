const VARIANT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "thinking"]

export function availableModelVariants(variants: Record<string, unknown> | undefined): string[] {
  return Object.entries(variants ?? {})
    .filter(([, config]) => !(config && typeof config === "object" && "disabled" in config && config.disabled === true))
    .map(([id]) => id)
    .sort((a, b) => {
      const aIndex = VARIANT_ORDER.indexOf(a)
      const bIndex = VARIANT_ORDER.indexOf(b)
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b)
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })
}

export function modelVariantLabel(variant: string): string {
  if (variant === "xhigh") return "X-high"
  return variant ? `${variant[0]!.toUpperCase()}${variant.slice(1)}` : "Default"
}
