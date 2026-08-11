/** UI permission model — v1 (permission/patterns) and v2 (action/resources) normalized. */
export type UiPermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  /** OpenCode permission API generation; reply path differs for v2. */
  api: "v1" | "v2"
}

export function normalizePermissionProperties(type: string, properties: unknown): UiPermissionRequest | null {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null
  const props = properties as Record<string, unknown>
  if (typeof props.id !== "string" || !props.id) return null
  const sessionID = typeof props.sessionID === "string" ? props.sessionID : ""
  const metadata =
    props.metadata && typeof props.metadata === "object" && !Array.isArray(props.metadata)
      ? (props.metadata as Record<string, unknown>)
      : {}

  if (type === "permission.v2.asked") {
    const action = typeof props.action === "string" && props.action ? props.action : "permission"
    const resources = Array.isArray(props.resources) ? props.resources.map(String) : []
    const save = Array.isArray(props.save) ? props.save.map(String) : []
    return {
      id: props.id,
      sessionID,
      permission: action,
      patterns: resources,
      metadata,
      always: save,
      api: "v2",
    }
  }

  if (type === "permission.asked") {
    const permission = typeof props.permission === "string" && props.permission ? props.permission : "permission"
    const patterns = Array.isArray(props.patterns) ? props.patterns.map(String) : []
    const always = Array.isArray(props.always) ? props.always.map(String) : []
    return {
      id: props.id,
      sessionID,
      permission,
      patterns,
      metadata,
      always,
      api: "v1",
    }
  }

  return null
}

export function PermissionRequestBar({
  permission,
  onReply,
}: {
  permission: UiPermissionRequest
  onReply: (response: "once" | "always" | "reject") => void
}) {
  const patterns = Array.isArray(permission.patterns) ? permission.patterns : []
  return (
    <div className="oc-permission" role="alertdialog" aria-label="Permission required">
      <p className="oc-permission__kicker">Permission required</p>
      <p className="oc-permission__title">{permission.permission}</p>
      <p className="oc-permission__meta">{patterns.join(", ") || "OpenCode requests permission to continue."}</p>
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
