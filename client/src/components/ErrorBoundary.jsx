import { Component } from 'preact';

/**
 * Error boundary that catches render errors in its subtree.
 * Displays a fallback UI instead of crashing the entire app.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ error });
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div class="error-boundary">
          <div class="error-boundary-card">
            <h2>Something went wrong</h2>
            <p class="error-boundary-message">{this.state.error.message || 'An unexpected error occurred.'}</p>
            <div class="error-boundary-actions">
              <button class="error-boundary-btn" onClick={this.handleReset}>
                Try Again
              </button>
              <button class="error-boundary-btn secondary" onClick={() => { window.location.href = '/'; }}>
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
