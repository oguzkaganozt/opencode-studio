import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Markdown } from "./markdown"

describe("agent markdown", () => {
  test("renders GFM emphasis and tables", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text={`**Result**

| Item | Value |
| --- | --- |
| CPU | 1247 events/s |`}
      />,
    )

    expect(html).toContain("<strong>Result</strong>")
    expect(html).toContain('class="oc-md__table-scroll"')
    expect(html).toContain("<table>")
  })

  test("does not render raw HTML", () => {
    const html = renderToStaticMarkup(<Markdown text={'<script>alert("x")</script>'} />)
    expect(html).not.toContain("<script>")
  })
})
