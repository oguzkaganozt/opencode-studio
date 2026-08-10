export function ToolIcon({ tool }: { tool: string }) {
  const path =
    tool === "bash" ? (
      <path d="M4 5.5 7.5 8 4 10.5M9 10.5h4" />
    ) : tool === "read" || tool === "glob" ? (
      <>
        <path d="M5 3h4.5L12 5.5V13H5z" />
        <path d="M9.5 3v2.5H12" />
      </>
    ) : tool === "edit" || tool === "write" ? (
      <path d="M10.8 3.6 12.4 5.2M3.5 12.5l.6-2.2L11 3.4l1.6 1.6-6.9 6.9z" />
    ) : tool === "grep" || tool === "websearch" ? (
      <>
        <circle cx="7" cy="7" r="3.5" />
        <path d="m9.8 9.8 3 3" />
      </>
    ) : tool === "webfetch" ? (
      <>
        <circle cx="8" cy="8" r="5" />
        <path d="M3 8h10M8 3c-1.6 1.6-2.4 3.2-2.4 5s.8 3.4 2.4 5c1.6-1.6 2.4-3.2 2.4-5S9.6 4.6 8 3z" />
      </>
    ) : tool === "task" || tool === "todowrite" || tool === "todoread" ? (
      <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5.5" />
    ) : (
      <>
        <circle cx="8" cy="8" r="1.75" />
        <path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2" />
      </>
    )
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

export function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function IconHome() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 6.25 7 2l5 4.25v5.25H8.75V8.25h-3.5v3.25H2V6.25Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  )
}

export function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 12.5V3.5M8 3.5L4 7.5M8 3.5L12 7.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconStop() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  )
}

export function IconChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconFolder() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 5.25V12a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1H8.2L6.9 4H3.5a1 1 0 0 0-1 1.25Z" />
    </svg>
  )
}

/** Host status / health (not settings). */
export function IconStatus() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.25 8.1 7.1 9.9 10.85 5.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
