import { Component, type ReactNode } from 'react';

/** Contains render errors to one region and shows them, instead of blanking the page. */
export class ErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(`[${this.props.name}]`, error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        {this.props.name} crashed: {this.state.error.message}
        <button onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
  }
}
