import React from 'react';

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8">
          <div className="text-4xl mb-4">Warning</div>
          <h2 className="text-lg font-semibold text-text-bright mb-2">Something went wrong</h2>
          <p className="text-sm text-text-dim mb-4 max-w-md">{this.state.error?.message}</p>
          <button
            className="btn btn-primary"
            onClick={() => { this.setState({ hasError: false, error: null }); }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
