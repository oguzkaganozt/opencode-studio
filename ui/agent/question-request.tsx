import type { QuestionAnswer, QuestionInfo, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { useMemo, useState } from "react"

function allowsCustom(question: QuestionInfo): boolean {
  return question.custom !== false
}

function emptySelections(count: number): string[][] {
  return Array.from({ length: count }, () => [])
}

function emptyCustoms(count: number): string[] {
  return Array.from({ length: count }, () => "")
}

export function buildQuestionAnswers(questions: QuestionInfo[], selected: string[][], customs: string[]): QuestionAnswer[] {
  return questions.map((question, index) => {
    const picks = [...(selected[index] ?? [])]
    const custom = (customs[index] ?? "").trim()
    if (question.multiple) {
      if (custom && allowsCustom(question) && !picks.includes(custom)) picks.push(custom)
      return picks
    }
    // Single-select: option XOR custom (prefer option when both present).
    if (picks.length > 0) return picks.slice(0, 1)
    if (custom && allowsCustom(question)) return [custom]
    return []
  })
}

export function answersReady(questions: QuestionInfo[], answers: QuestionAnswer[]): boolean {
  if (answers.length !== questions.length) return false
  return answers.every((answer) => answer.length > 0 && answer.every((item) => item.trim().length > 0))
}

function stepAnswered(question: QuestionInfo, picks: string[], custom: string): boolean {
  return buildQuestionAnswers([question], [picks], [custom])[0]!.length > 0
}

export function QuestionRequestBar({
  request,
  onReply,
  onReject,
}: {
  request: QuestionRequest
  onReply: (answers: QuestionAnswer[]) => void
  onReject: () => void
}) {
  const questions = request.questions
  const total = questions.length
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState(() => emptySelections(total))
  const [customs, setCustoms] = useState(() => emptyCustoms(total))
  const answers = useMemo(() => buildQuestionAnswers(questions, selected, customs), [questions, selected, customs])
  const index = Math.min(step, Math.max(total - 1, 0))
  const question = questions[index]
  const multiple = Boolean(question?.multiple)
  const customEnabled = question ? allowsCustom(question) : false
  const picks = selected[index] ?? []
  const custom = customs[index] ?? ""
  const canAdvance = question ? stepAnswered(question, picks, custom) : false
  const last = index >= total - 1
  const ready = answersReady(questions, answers)

  const toggleOption = (label: string) => {
    setSelected((current) => {
      const next = current.map((row) => [...row])
      const row = next[index] ?? []
      if (multiple) {
        next[index] = row.includes(label) ? row.filter((item) => item !== label) : [...row, label]
      } else {
        next[index] = row.includes(label) && row.length === 1 ? [] : [label]
      }
      return next
    })
    if (!multiple) {
      setCustoms((current) => {
        const next = [...current]
        next[index] = ""
        return next
      })
    }
  }

  if (!question || total === 0) return null

  return (
    <div className="oc-question" role="alertdialog" aria-label="Agent question">
      <div className="oc-question__top">
        <p className="oc-question__kicker">Question from agent</p>
        <p className="oc-question__progress" aria-live="polite">
          {index + 1}/{total}
        </p>
      </div>
      {question.header ? <p className="oc-question__header">{question.header}</p> : null}
      <p className="oc-question__prompt">{question.question}</p>
      {question.options.length > 0 ? (
        <div className="oc-question__options" role={multiple ? "group" : "radiogroup"}>
          {question.options.map((option) => {
            const active = picks.includes(option.label)
            return (
              <button
                key={option.label}
                type="button"
                className={`oc-question__option${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => toggleOption(option.label)}
              >
                <span className="oc-question__option-label">{option.label}</span>
                {option.description ? <span className="oc-question__option-desc">{option.description}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
      {customEnabled ? (
        <label className="oc-question__custom">
          <span className="oc-question__custom-label">{multiple ? "Add your own" : "Or type your own"}</span>
          <input
            type="text"
            className="oc-question__custom-input"
            value={custom}
            placeholder="Type an answer…"
            onChange={(event) => {
              const value = event.target.value
              setCustoms((current) => {
                const next = [...current]
                next[index] = value
                return next
              })
              if (!multiple && value.trim()) {
                setSelected((current) => {
                  const next = current.map((row) => [...row])
                  next[index] = []
                  return next
                })
              }
            }}
          />
        </label>
      ) : null}
      <div className="oc-question__actions">
        {index > 0 ? (
          <button type="button" className="oc-chip" onClick={() => setStep((current) => Math.max(0, current - 1))}>
            Back
          </button>
        ) : (
          <button type="button" className="oc-chip" onClick={onReject}>
            Skip
          </button>
        )}
        {last ? (
          <button type="button" className="oc-chip oc-question__submit" disabled={!ready} onClick={() => onReply(answers)}>
            Submit
          </button>
        ) : (
          <button
            type="button"
            className="oc-chip oc-question__submit"
            disabled={!canAdvance}
            onClick={() => setStep((current) => Math.min(total - 1, current + 1))}
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}
