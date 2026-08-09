import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"

export function PermissionRequestBar({
  permission,
  onReply,
}: {
  permission: PermissionRequest
  onReply: (response: "once" | "always" | "reject") => void
}) {
  return (
    <div className="oc-permission" role="alertdialog" aria-label="Permission request">
      <p className="oc-permission__title">{permission.permission}</p>
      <p className="oc-permission__meta">{permission.patterns.join(", ") || "OpenCode requests permission to continue."}</p>
      <div className="oc-permission__actions">
        <button type="button" className="oc-chip" onClick={() => onReply("once")}>
          Allow once
        </button>
        <button type="button" className="oc-chip" onClick={() => onReply("always")}>
          Always
        </button>
        <button type="button" className="oc-chip" onClick={() => onReply("reject")}>
          Reject
        </button>
      </div>
    </div>
  )
}
