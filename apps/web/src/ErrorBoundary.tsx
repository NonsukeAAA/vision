import { Component, type ErrorInfo, type ReactNode } from "react";
import { describeError, formatLogText, logError } from "./diagnostics";

type Props = { children: ReactNode };
type State = { message: string | null };

/** A render crash must not leave a blank page with no way to read the log. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(err: unknown): State {
    return {
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: unknown, info: ErrorInfo): void {
    logError("react render crash", {
      ...describeError(err),
      component: info.componentStack?.split("\n").slice(0, 4).join(" | "),
    });
  }

  render(): ReactNode {
    if (this.state.message == null) return this.props.children;
    return (
      <div className="fatal-screen">
        <h1>画面の描画に失敗しました</h1>
        <p>{this.state.message}</p>
        <div className="fatal-actions">
          <button type="button" onClick={() => window.location.reload()}>
            再読み込み
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(formatLogText());
            }}
          >
            ログをコピー
          </button>
        </div>
        <pre>{formatLogText()}</pre>
      </div>
    );
  }
}
