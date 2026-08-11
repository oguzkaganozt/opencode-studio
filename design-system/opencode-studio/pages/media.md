# Page override — Media Studio

Overrides MASTER for the Media project list and project asset browser.

## Intent

Media is a quiet project library, not a gallery product. The project list establishes scope; the project detail reuses the shared read-only Files explorer for image, audio, video, and text preview.

## Projects

- Route: `/studios/media`.
- Use the shared Studio Home heading rhythm and compact project cards.
- Purple is a narrow identity rail/accent, never a glow or large decorative field.
- Empty state drafts a project-creation request through the Media Agent.

## Project detail

- Route: `/studios/media/projects/:id`.
- Full-height shared Files explorer rooted at exactly one Media project.
- Breadcrumb root uses the project id; previews and downloads stay project-scoped.
- “Use in Agent” keeps the selected path relative to the project.

## Agent

- The shell Agent toggle resolves to `studio-media` on every prompt.
- The Media root context can create projects with standard filesystem tools.
- Media model tools require an open immediate-child project and reject the domain root or sibling projects.
