import { AudioLines, Film, ImageIcon } from "lucide-react"
import type { Asset } from "../api"
import { cn } from "../lib/utils"

export function MediaPreview({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  if (asset.modality === "image") {
    return (
      <img
        className={cn(
          "block bg-[var(--osc-canvas-bg)] object-contain",
          compact ? "h-full w-full object-cover" : "max-h-[76vh] w-full",
        )}
        src={asset.mediaUrl}
        alt={asset.path}
        loading="lazy"
      />
    )
  }
  if (asset.modality === "video") {
    return compact ? (
      <div className="grid h-full w-full place-items-center bg-[var(--osc-bg-subtle)]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--osc-primary)] px-2.5 py-1 text-[10px] font-medium tracking-wide text-[var(--osc-primary-fg)] uppercase">
          <Film size={14} /> Video
        </span>
      </div>
    ) : (
      <video className="block max-h-[76vh] w-full bg-[var(--osc-canvas-bg)] object-contain" src={asset.mediaUrl} controls playsInline preload="metadata" />
    )
  }
  return compact ? (
    <div className="grid h-full w-full place-items-center bg-[var(--osc-bg-subtle)]">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--osc-primary)] px-2.5 py-1 text-[10px] font-medium tracking-wide text-[var(--osc-primary-fg)] uppercase">
        <AudioLines size={14} /> Audio
      </span>
    </div>
  ) : (
    <div className="flex w-full max-w-lg items-center gap-4 rounded-[var(--osc-radius-lg)] border border-[var(--osc-border)] bg-[var(--osc-bg-elevated)] p-6">
      <AudioLines size={36} strokeWidth={1.25} className="text-[var(--osc-accent)]" />
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-[13px] text-[var(--osc-text-muted)]">Audio asset</p>
        <audio className="w-full" src={asset.mediaUrl} controls preload="metadata" />
      </div>
    </div>
  )
}

export function ModalityIcon({ modality }: { modality: Asset["modality"] }) {
  if (modality === "video") return <Film size={14} />
  if (modality === "audio") return <AudioLines size={14} />
  return <ImageIcon size={14} />
}
