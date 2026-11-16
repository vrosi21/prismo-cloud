import { Component, type ReactNode } from 'react'

/**
 * Keeps a crash inside one part (an editor, a board) from blanking the whole
 * app: that part shows what went wrong and a button to try it again.
 */
export class Boundary extends Component<{ children: ReactNode; what: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="panel px flex flex-col items-start gap-2 p-3">
        <p className="text-danger">
          &gt; the {this.props.what} broke: {this.state.error.message}
        </p>
        <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>
          try again
        </button>
      </div>
    )
  }
}
