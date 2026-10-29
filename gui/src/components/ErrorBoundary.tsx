import { Component, type ErrorInfo, type ReactNode } from "react"

type Props = {
  children: ReactNode
  // Changing the key clears a previous failure, e.g. when a virtualized row remounts.
  resetKey?: unknown
}

type State = {
  error?: Error
  key?: unknown
}

// Keeps one broken turn from blanking the whole transcript.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): State | null {
    return props.resetKey === state.key ? null : { key: props.resetKey, error: undefined }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Conversation turn failed to render", error, info.componentStack)
  }

  private retry = () => this.setState({ error: undefined })

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="my-2 rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-card)] px-4 py-3 text-[length:var(--text-chat-sm)] text-[var(--text-secondary)]">
          <p className="m-0 mb-2 font-medium text-[var(--text-primary)]">This turn couldn't render</p>
          <button
            type="button"
            onClick={this.retry}
            className="noa-confirm-btn h-7 rounded-md border border-[var(--divider-subtle)] px-3 text-caption"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
