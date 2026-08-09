export function formatToolJson(
  value: unknown,
  options?: {
    maxBytes?: number
    /** Suffix after the truncated prefix. Receives characters omitted and maxBytes. */
    truncateSuffix?: (omitted: number, maxBytes: number) => string
  },
): string {
  const output = JSON.stringify(value, null, 2)
  const maxBytes = options?.maxBytes
  if (maxBytes === undefined || output.length <= maxBytes) return output
  const omitted = output.length - maxBytes
  const suffix = options?.truncateSuffix?.(omitted, maxBytes) ?? `\n\n[truncated at ${maxBytes} bytes]`
  return `${output.slice(0, maxBytes)}${suffix}`
}
