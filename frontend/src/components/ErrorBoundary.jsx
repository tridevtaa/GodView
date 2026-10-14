import { Component } from "react";
import { isStaleRelease, reloadForNewRelease } from "../pwa/release.js";

// If a screen crashes, show what happened and a way out instead of a blank
// page. Code left over from the previous release just reloads.
export default class ErrorBoundary extends Component {
  state = { error: null, reloading: false };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (isStaleRelease(error) && reloadForNewRelease()) return this.setState({ reloading: true });
    console.error("Godview crashed:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.state.reloading) return <main className="auth-screen" aria-busy="true" />;
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <h1>Something went wrong</h1>
          <p className="muted">This page hit an error. Reloading usually fixes it; if not, send this message to Godview support.</p>
          <code className="crash-detail">{String(this.state.error?.message || this.state.error).slice(0, 300)}</code>
          <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
