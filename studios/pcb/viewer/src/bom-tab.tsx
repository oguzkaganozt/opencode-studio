import { useQuery } from "@tanstack/react-query"
import { api, type BomEntry } from "./api"

function BomRow({ entry }: { entry: BomEntry }) {
  return (
    <tr className="border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors">
      <td className="px-4 py-2.5 font-mono text-sm text-emerald-400 whitespace-nowrap">{entry.mpn ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-zinc-300">{entry.refdes.join(", ")}</td>
      <td className="px-4 py-2.5 text-sm text-zinc-300 text-center">{entry.quantity}</td>
      <td className="px-4 py-2.5 text-sm text-zinc-400">{entry.manufacturer ?? "—"}</td>
      <td className="px-4 py-2.5 text-sm text-zinc-400 max-w-xs truncate" title={entry.description ?? ""}>
        {entry.description ?? "—"}
      </td>
      <td className="px-4 py-2.5 text-sm">
        {entry.datasheet && (
          <a href={entry.datasheet} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs">
            Datasheet ↗
          </a>
        )}
      </td>
    </tr>
  )
}

export default function BomTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pcb", "bom", projectId],
    queryFn: () => api.bom(projectId),
  })

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-zinc-500 text-sm">Loading BOM…</div>
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-center py-24 text-red-400 text-sm">BOM not available. Run pcb_circuit_build first.</div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        <span>
          {data.totalComponents} component{data.totalComponents !== 1 ? "s" : ""}
        </span>
        <span className="text-zinc-700">·</span>
        <span>
          {data.listedCount} listed{data.unlistedCount > 0 ? `, ${data.unlistedCount} unlisted` : ""}
        </span>
        <span className={data.bomComplete ? "text-emerald-400" : "text-amber-400"}>
          {data.bomComplete ? "Assembly identities complete" : "Assembly blocked: missing part identities"}
        </span>
        <span className="ml-auto">
          <a
            href={api.bomCsvUrl(projectId)}
            download
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
          >
            Download CSV ↓
          </a>
        </span>
      </div>
      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-zinc-900 border-b border-zinc-800">
              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">MPN</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Refdes</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider text-center">Qty</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Manufacturer</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Description</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider" />
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, index) => (
              <BomRow key={entry.mpn ?? `unlisted-${index}`} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
