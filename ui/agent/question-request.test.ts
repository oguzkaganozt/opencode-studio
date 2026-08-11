import { describe, expect, test } from "bun:test"
import type { QuestionInfo } from "@opencode-ai/sdk/v2/client"
import { answersReady, buildQuestionAnswers } from "./question-request"

const single: QuestionInfo = {
  question: "Pick one",
  header: "Choice",
  options: [
    { label: "A", description: "Option A" },
    { label: "B", description: "Option B" },
  ],
}

const multi: QuestionInfo = {
  question: "Pick many",
  header: "Multi",
  options: [
    { label: "X", description: "x" },
    { label: "Y", description: "y" },
  ],
  multiple: true,
}

describe("buildQuestionAnswers", () => {
  test("single-select prefers option over leftover custom", () => {
    expect(buildQuestionAnswers([single], [["A"]], ["other"])).toEqual([["A"]])
  })

  test("single-select custom alone", () => {
    expect(buildQuestionAnswers([single], [[]], ["typed"])).toEqual([["typed"]])
  })

  test("multi-select includes custom with options", () => {
    expect(buildQuestionAnswers([multi], [["X"]], ["other"])).toEqual([["X", "other"]])
  })

  test("omits blank custom", () => {
    expect(buildQuestionAnswers([single], [["B"]], ["  "])).toEqual([["B"]])
  })

  test("respects custom:false", () => {
    const locked = { ...single, custom: false }
    expect(buildQuestionAnswers([locked], [[]], ["typed"])).toEqual([[]])
    expect(buildQuestionAnswers([locked], [["A"]], ["typed"])).toEqual([["A"]])
  })
})

describe("answersReady", () => {
  test("requires every question answered before submit", () => {
    expect(answersReady([single, multi], [["A"], []])).toBe(false)
    expect(answersReady([single, multi], [["A"], ["X", "Y"]])).toBe(true)
  })
})
