import type { Ref } from "react"
import type { ComposerChip, ModelRef, PopoverKind } from "./agent-types"
import { modelKey } from "./agent-types"
import { IconChevron, IconSend, IconStop } from "./icons"
import { modelVariantLabel } from "./model-variant"

export function AgentComposer({
  composerRef,
  draft,
  onDraftChange,
  chips,
  onRemoveChip,
  busy,
  contextWritable,
  canSend,
  directory,
  model,
  modelOptions,
  modelQuery,
  onModelQueryChange,
  modelVariants,
  variant,
  popover,
  onPopoverChange,
  onSelectModel,
  onSelectVariant,
  onClearVariant,
  onSend,
  onAbort,
}: {
  composerRef: Ref<HTMLTextAreaElement>
  draft: string
  onDraftChange: (value: string) => void
  chips: ComposerChip[]
  onRemoveChip: (id: string) => void
  busy: boolean
  contextWritable: boolean
  canSend: boolean
  directory?: string
  model?: ModelRef
  modelOptions: ModelRef[]
  modelQuery: string
  onModelQueryChange: (value: string) => void
  modelVariants: string[]
  variant?: string
  popover: PopoverKind
  onPopoverChange: (value: PopoverKind | ((prev: PopoverKind) => PopoverKind)) => void
  onSelectModel: (model: ModelRef) => void
  onSelectVariant: (option: string) => void
  onClearVariant: () => void
  onSend: () => void
  onAbort: () => void
}) {
  return (
    <div className="oc-composer-wrap">
      <div className="oc-composer-inner">
        {chips.length > 0 ? (
          <div className="oc-composer__chips">
            {chips.map((chip) => (
              <span key={chip.id} className={`oc-chip ${chip.kind === "annotation" ? "oc-chip--ann" : ""}`} title={chip.value}>
                {chip.kind === "annotation" ? "◎ " : "@"}
                {chip.label}
                <button type="button" aria-label={`Remove ${chip.label}`} onClick={() => onRemoveChip(chip.id)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <form
          className="oc-dock"
          onSubmit={(e) => {
            e.preventDefault()
            if (busy) {
              onAbort()
              return
            }
            onSend()
          }}
        >
          <textarea
            ref={composerRef}
            className="oc-dock__input"
            placeholder="Ask anything…"
            value={draft}
            disabled={busy || !contextWritable}
            rows={2}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSend()
              }
            }}
          />
          <div className="oc-dock__bar">
            <div className="oc-dock__left">
              <button
                type="button"
                data-oc-popover-trigger
                className="oc-dock__model oc-dock__model--primary"
                disabled={!contextWritable}
                onClick={() => onPopoverChange((p) => (p === "model" ? null : "model"))}
                aria-expanded={popover === "model"}
                title={model ? modelKey(model) : "Model"}
              >
                <span className="truncate">{model ? model.modelID : "Model"}</span>
                <IconChevron />
              </button>
              {popover === "model" ? (
                <div className="oc-popover oc-popover--model" data-oc-popover role="listbox" aria-label="Models">
                  <input
                    className="oc-popover__search"
                    placeholder="Search models…"
                    value={modelQuery}
                    onChange={(e) => onModelQueryChange(e.target.value)}
                  />
                  <div className="oc-popover__list">
                    {modelOptions.map((m) => (
                      <button
                        key={modelKey(m)}
                        type="button"
                        role="option"
                        aria-selected={model ? modelKey(model) === modelKey(m) : false}
                        className={`oc-popover__item ${model && modelKey(model) === modelKey(m) ? "is-active" : ""}`}
                        onClick={() => onSelectModel(m)}
                      >
                        <span className="truncate font-medium">{m.modelID}</span>
                        <span className="oc-popover__meta">{m.providerID}</span>
                      </button>
                    ))}
                    {modelOptions.length === 0 ? <p className="oc-popover__empty">No models</p> : null}
                  </div>
                </div>
              ) : null}
              {modelVariants.length > 0 ? (
                <button
                  type="button"
                  data-oc-popover-trigger
                  className="oc-dock__model oc-dock__model--variant"
                  disabled={!contextWritable}
                  onClick={() => onPopoverChange((p) => (p === "variant" ? null : "variant"))}
                  aria-expanded={popover === "variant"}
                  aria-label={`Reasoning effort: ${modelVariantLabel(variant ?? "")}`}
                  title={`Reasoning effort: ${modelVariantLabel(variant ?? "")}`}
                >
                  <span className="truncate">{modelVariantLabel(variant ?? "")}</span>
                  <IconChevron />
                </button>
              ) : null}
              {popover === "variant" && model ? (
                <div className="oc-popover oc-popover--model" data-oc-popover role="listbox" aria-label="Reasoning effort">
                  <div className="oc-popover__list">
                    <button
                      type="button"
                      role="option"
                      aria-selected={!variant}
                      className={`oc-popover__item ${!variant ? "is-active" : ""}`}
                      onClick={onClearVariant}
                    >
                      <span className="truncate font-medium">Default</span>
                      <span className="oc-popover__meta">Model default</span>
                    </button>
                    {modelVariants.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={variant === option}
                        className={`oc-popover__item ${variant === option ? "is-active" : ""}`}
                        onClick={() => onSelectVariant(option)}
                      >
                        <span className="truncate font-medium">{modelVariantLabel(option)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <button type="submit" className="oc-dock__send" disabled={!canSend && !busy} aria-label={busy ? "Stop" : "Send"}>
              {busy ? <IconStop /> : <IconSend />}
            </button>
          </div>
        </form>
        <p className="oc-dock__dir" title={directory}>
          {directory ?? "Resolving context…"}
        </p>
      </div>
    </div>
  )
}
