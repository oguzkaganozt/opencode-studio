import { Component, type ReactNode } from "react"

type Props = {
  fallback: ReactNode
  children: ReactNode
  /** Change this when underlying data reloads so a prior crash does not stick. */
  resetKey?: string | number
}

type State = { hasError: boolean }

/**
 * Renders `fallback` when a child viewer crashes (e.g. a tscircuit viewer
 * package hitting a circuit-json incompatibility). Keeps the static SVG
 * path available as a safety net.
 */
export class ViewerErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  componentDidCatch(error: unknown) {
    console.error("Interactive viewer crashed, falling back to SVG:", error)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
