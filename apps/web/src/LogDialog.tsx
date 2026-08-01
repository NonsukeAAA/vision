import { useEffect, useMemo, useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eDialog } from "@m3e/react/dialog";
import { M3eIcon } from "@m3e/react/icon";
import {
  clearLog,
  formatLogText,
  getLogEntries,
  getPreviousSessionReport,
  subscribeToLog,
  type LogEntry,
} from "./diagnostics";

type Props = {
  open: boolean;
  onClose: () => void;
  onNotify?: (message: string) => void;
};

function clock(t: number): string {
  const d = new Date(t);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function detail(entry: LogEntry): string {
  if (!entry.data) return "";
  return Object.entries(entry.data)
    .map(([k, v]) => `${k}=${v}`)
    .join("  ");
}

export function LogDialog({ open, onClose, onNotify }: Props) {
  const [tick, setTick] = useState(0);
  const [onlyProblems, setOnlyProblems] = useState(false);

  useEffect(() => subscribeToLog(() => setTick((n) => n + 1)), []);

  const entries = useMemo(() => {
    void tick;
    const all = getLogEntries();
    const filtered = onlyProblems
      ? all.filter((e) => e.level !== "info")
      : all;
    // Newest first: after a crash the interesting line is the last one written.
    return [...filtered].reverse();
  }, [tick, onlyProblems, open]);

  const crash = getPreviousSessionReport();

  const copy = async () => {
    const text = formatLogText();
    try {
      await navigator.clipboard.writeText(text);
      onNotify?.("ログをコピーしました");
    } catch {
      onNotify?.("コピーできませんでした。ダウンロードを使ってください");
    }
  };

  const download = () => {
    const blob = new Blob([formatLogText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vision-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <M3eDialog
      className="log-dialog"
      open={open}
      dismissible
      closeLabel="閉じる"
      onClosed={onClose}
      onCancel={onClose}
    >
      <span slot="header">診断ログ</span>

      <div className="log-body">
        {crash ? (
          <div className="log-crash">
            <M3eIcon name="warning" />
            <span>
              前回は{crash.analyzing ? "解析中に" : ""}強制終了したようです。
              最後の記録:<code>{crash.lastMsg || "不明"}</code>
            </span>
          </div>
        ) : (
          <p className="settings-help">
            解析の各段階を端末内に記録しています。落ちた場合は一番上（最新）の行がその直前の処理です。
          </p>
        )}

        <div className="log-toolbar">
          <M3eButton
            type="button"
            variant={onlyProblems ? "filled" : "outlined"}
            onClick={() => setOnlyProblems((v) => !v)}
          >
            <M3eIcon slot="icon" name="error" />
            警告・エラーのみ
          </M3eButton>
          <span className="drop-tags-count">{entries.length}</span>
        </div>

        {entries.length === 0 ? (
          <p className="settings-help">記録はまだありません。</p>
        ) : (
          <ol className="log-list">
            {entries.map((e, i) => (
              <li key={`${e.t}-${i}`} className={`log-row log-${e.level}`}>
                <span className="log-time">{clock(e.t)}</span>
                <span className="log-msg">
                  {e.msg}
                  {e.data ? <em>{detail(e)}</em> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div slot="actions" className="dialog-actions">
        <M3eButton type="button" variant="text" onClick={() => clearLog()}>
          消去
        </M3eButton>
        <M3eButton type="button" variant="outlined" onClick={download}>
          <M3eIcon slot="icon" name="download" />
          保存
        </M3eButton>
        <M3eButton type="button" variant="filled" onClick={() => void copy()}>
          <M3eIcon slot="icon" name="content_copy" />
          コピー
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
