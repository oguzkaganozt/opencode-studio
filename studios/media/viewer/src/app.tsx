import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useState } from "react"
import { Link, Navigate, Route, Routes, useParams } from "react-router"
import { claimAgentContext } from "@ui/agent-context"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { EmptyState } from "@ui/components/empty-state"
import { ErrorState } from "@ui/components/error-state"
import { StudioHomeHeader } from "@ui/components/studio-home"
import { StudioShell } from "@ui/components/studio-shell"
import { FilesExplorer, type FilesPreviewRenderContext } from "@ui/files-explorer"
import { listProjects, projectFilesBase, readProject, readWorkspace, studioHref } from "./api"
import { AudioWorkspace } from "./audio-workspace"
import { ImageWorkspace } from "./image-workspace"
import { createMediaSelection, createMediaSelectionHandoff, type MediaSelection } from "./selection"
import { MediaSelectionBar } from "./selection-bar"
import { VideoWorkspace } from "./video-workspace"

function ProjectsPage() {
  const projects = useQuery({ queryKey: ["media", "projects"], queryFn: listProjects })
  const workspace = useQuery({ queryKey: ["media", "workspace"], queryFn: () => readWorkspace() })

  useEffect(() => {
    if (!workspace.data?.root) return
    return claimAgentContext("media-root", {
      key: "media-root",
      kind: "media-root",
      studioId: "media",
      label: "Media Studio",
      directory: workspace.data.root,
      historicalDirectory: workspace.data.root,
      status: "available",
    })
  }, [workspace.data?.root])

  return (
    <StudioShell studioId="media" label="Media">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <StudioHomeHeader title="Projects" count={projects.data ? `${projects.data.length} project${projects.data.length === 1 ? "" : "s"}` : undefined} />
        {projects.isLoading ? <div className="osc-skeleton h-24 w-full" role="status" aria-label="Loading Media projects" /> : null}
        {projects.error ? <ErrorState title="Failed to load Media projects" description={String(projects.error)} /> : null}
        {projects.data?.length === 0 ? (
          <EmptyState
            title="No Media projects yet"
            description="Create a project directory in Media Studio, then open it to generate and manage assets."
            action={
              <button
                type="button"
                className="osc-chip"
                onClick={() =>
                  requestAgentHandoff({
                    text: "Create a new lowercase Media project directory here with a media/ folder.",
                    source: "media",
                    open: true,
                  })
                }
              >
                Draft project request
              </button>
            }
          />
        ) : null}
        {projects.data?.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.data.map((project) => (
              <Link key={project.id} to={studioHref(`projects/${encodeURIComponent(project.id)}`)} className="media-project-card">
                <span className="media-project-card__rail" aria-hidden />
                <p className="truncate text-[14px] font-semibold">{project.id}</p>
                <p className="mt-1 truncate font-mono text-[11px] text-[var(--osc-text-muted)]">{project.path}</p>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </StudioShell>
  )
}

function ProjectPage() {
  const { projectId = "" } = useParams()
  const project = useQuery({ queryKey: ["media", "project", projectId], queryFn: () => readProject(projectId), enabled: Boolean(projectId) })
  const [selection, setSelection] = useState<MediaSelection | null>(null)

  useEffect(() => {
    if (!project.data) return
    return claimAgentContext(`media:${project.data.id}`, {
      key: `media:${project.data.id}`,
      kind: "media-project",
      studioId: "media",
      projectId: project.data.id,
      relativePath: project.data.path,
      label: `Media · ${project.data.id}`,
      directory: project.data.directory,
      historicalDirectory: project.data.directory,
      status: "available",
    })
  }, [project.data])

  const onSelectionChange = useCallback((next: MediaSelection | null) => {
    setSelection(next)
  }, [])

  if (project.isLoading) return <div className="osc-skeleton m-4 min-h-48 flex-1" role="status" aria-label="Loading Media project" />
  if (project.error || !project.data) {
    return <ErrorState className="m-4 flex-1" title="Media project unavailable" description={String(project.error ?? "Not found")} />
  }

  const directory = project.data.directory

  const requestAsset = (assetPath: string) => {
    if (selection && selection.path === assetPath) {
      requestAgentHandoff(createMediaSelectionHandoff(directory, selection))
      return
    }
    requestAgentHandoff({ text: "", source: "media", directory, paths: [assetPath], open: true })
  }

  const renderFilePreview = (ctx: FilesPreviewRenderContext) => {
    if (ctx.preview === "image") {
      return <ImageWorkspace path={ctx.selected.path} src={ctx.rawHref} onSelectionChange={onSelectionChange} onError={ctx.onMediaError} />
    }
    if (ctx.preview === "video") {
      return <VideoWorkspace path={ctx.selected.path} src={ctx.rawHref} onSelectionChange={onSelectionChange} onError={ctx.onMediaError} />
    }
    if (ctx.preview === "audio") {
      return <AudioWorkspace path={ctx.selected.path} src={ctx.rawHref} onSelectionChange={onSelectionChange} onError={ctx.onMediaError} />
    }
    return undefined
  }

  return (
    <StudioShell studioId="media" label="Media" fill>
      <FilesExplorer
        apiBase={projectFilesBase(project.data.id)}
        rootLabel={project.data.id}
        studioId="media"
        onRequestAgent={requestAsset}
        renderFilePreview={renderFilePreview}
        previewFooter={
          <MediaSelectionBar
            selection={selection}
            emptyText="Select a region (image) or in/out range (video/audio), then send to agent."
            onClear={() => setSelection(null)}
            onSend={() => {
              if (!selection) return
              requestAgentHandoff(createMediaSelectionHandoff(directory, selection))
            }}
          />
        }
      />
    </StudioShell>
  )
}

export function App() {
  return (
    <Routes>
      <Route index element={<ProjectsPage />} />
      <Route path="projects/:projectId" element={<ProjectPage />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  )
}
