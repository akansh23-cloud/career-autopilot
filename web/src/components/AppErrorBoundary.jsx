/* ============================================================
   APP ERROR BOUNDARY
   ------------------------------------------------------------
   Today the app has exactly ONE error boundary — TabCrashBoundary,
   local to ProjectStudio.jsx. App.jsx renders <ViewCmp /> raw:

       <ViewCmp go={navigate} {...viewParams} />

   So a throw in ANY other view (Jobs, ProjectBuilder,
   ProjectWorkspace, CollegeWorkspace, TeamProjectsPanel…) unmounts
   the entire React tree and the student sees a blank white page
   with no way back. That is what "crashed while going through
   flow" looks like from the user's side, and it is why the report
   contained no error text — there was nothing on screen to read.

   Drop this in and wrap the view render in App.jsx:

     import AppErrorBoundary from './components/AppErrorBoundary.jsx';
     ...
     <AppErrorBoundary
       resetKey={renderActive}
       onGoHome={() => navigate('dashboard')}
     >
       <ViewCmp go={navigate} {...viewParams} />
     </AppErrorBoundary>

   `resetKey={renderActive}` matters: navigating to another screen
   clears the error automatically, so a student is never stuck.
   ============================================================ */
import React from 'react';

function shortStack(err, info) {
  const parts = [];
  if (err?.message) parts.push(String(err.message));
  const stack = String(info?.componentStack || err?.stack || '').trim();
  if (stack) parts.push(stack.split('\n').slice(0, 6).join('\n'));
  return parts.join('\n\n').slice(0, 1800);
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Best-effort telemetry. Never let reporting throw.
    try {
      if (typeof this.props.onError === 'function') this.props.onError(error, info);
      fetch('/api/ops/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: String(error?.message || error),
          componentStack: String(info?.componentStack || '').slice(0, 2000),
          screen: this.props.resetKey || null,
          url: typeof window !== 'undefined' ? window.location.hash : '',
          at: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: null, copied: false });
    }
  }

  copyDetails = () => {
    const text = shortStack(this.state.error, this.state.info);
    try {
      navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch { /* ignore */ }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto max-w-lg px-4 py-10 sm:py-16">
        <div className="rounded-2xl border border-red-400/25 bg-red-500/[0.07] p-5 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-danger">
            This screen stopped responding
          </p>
          <h2 className="mt-2 text-lg font-semibold">
            Your work is safe — nothing was lost.
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed opacity-80">
            Something in this screen hit an unexpected state. Everything you
            saved is still stored. Go back to your dashboard and open it again,
            or try reloading.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null, info: null })}
              className="rounded-lg border border-strong px-3.5 py-2 text-[13px] font-medium transition hover:bg-surface-1"
            >
              Try again
            </button>
            {this.props.onGoHome && (
              <button
                type="button"
                onClick={() => { this.setState({ error: null, info: null }); this.props.onGoHome(); }}
                className="rounded-lg border border-strong px-3.5 py-2 text-[13px] font-medium transition hover:bg-surface-1"
              >
                Back to dashboard
              </button>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-strong px-3.5 py-2 text-[13px] font-medium transition hover:bg-surface-1"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.copyDetails}
              className="rounded-lg px-3.5 py-2 text-[13px] font-medium opacity-70 transition hover:opacity-100"
            >
              {this.state.copied ? 'Copied' : 'Copy details for support'}
            </button>
          </div>

          {import.meta?.env?.DEV && (
            <pre className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-subtle bg-sunken p-3 text-[11px] leading-relaxed opacity-70">
              {shortStack(this.state.error, this.state.info)}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
