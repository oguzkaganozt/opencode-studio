import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Assistant message markdown. Raw HTML is not rendered (react-markdown default),
 * links are sanitized (defaultUrlTransform) and open externally.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="oc-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          table: ({ node: _node, ...props }) => (
            <div className="oc-md__table-scroll">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
