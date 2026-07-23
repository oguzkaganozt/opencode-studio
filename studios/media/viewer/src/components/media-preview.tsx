import { AudioLines, Film, ImageIcon } from "lucide-react"
import type { Asset } from "../api"
import { cn } from "../lib/utils"

export function MediaPreview({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  if (asset.modality === "image") {
    return <img className={cn("media-object", compact && "media-object-compact")} src={asset.mediaUrl} alt={asset.path} loading="lazy" />
  }
  if (asset.modality === "video") {
    return compact ? (
      <div className="media-placeholder">
        <span>
          <Film size={16} /> Video
        </span>
      </div>
    ) : (
      <video className="media-object" src={asset.mediaUrl} controls playsInline preload="metadata" />
    )
  }
  return compact ? (
    <div className="media-placeholder audio-placeholder">
      <div className="frequency-bars" aria-hidden="true">
        {Array.from({ length: 22 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <span>
        <AudioLines size={16} /> Audio
      </span>
    </div>
  ) : (
    <div className="audio-player">
      <AudioLines size={42} strokeWidth={1.25} />
      <div>
        <p>Audio asset</p>
        <audio src={asset.mediaUrl} controls preload="metadata" />
      </div>
    </div>
  )
}

export function ModalityIcon({ modality }: { modality: Asset["modality"] }) {
  if (modality === "video") return <Film size={14} />
  if (modality === "audio") return <AudioLines size={14} />
  return <ImageIcon size={14} />
}
