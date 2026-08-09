export function normalizeCliArgs(argv: string[]): string[] {
  return argv.length === 0 ? ["up"] : argv
}
