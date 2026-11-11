import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/card";
import { api, isTauri } from "@/lib/bridge";
import { clock, percentLeft } from "@/lib/format";
import type { CurfewState } from "@/lib/types";

const TONE = {
  work: {
    dot: "bg-primary",
    clock: "text-foreground",
    border: "border-border/80",
    fill: "bg-primary",
    eyebrow: "NIGHT CURFEW",
  },
  grace: {
    dot: "bg-secondary",
    clock: "text-secondary",
    border: "border-secondary/45",
    fill: "bg-secondary",
    eyebrow: "FINISH UP",
  },
  expired: {
    dot: "bg-destructive",
    clock: "text-destructive",
    border: "border-destructive/50",
    fill: "bg-destructive",
    eyebrow: "SHUTTING DOWN",
  },
} as const;

export function CurfewCard() {
  const [state, setState] = useState<CurfewState | null>(null);
  const [prompting, setPrompting] = useState(false);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await api.getState());
    } catch (err) {
      setMessage(String(err));
      setError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const tick = window.setInterval(() => void refresh(), 500);
    return () => window.clearInterval(tick);
  }, [refresh]);

  const act = async (fn: () => Promise<CurfewState>) => {
    setBusy(true);
    try {
      setState(await fn());
    } catch (err) {
      setMessage(String(err));
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const submitKey = async () => {
    setBusy(true);
    try {
      const result = await api.requestRelease(key);
      setMessage(result.message);
      setError(!result.ok);
      if (result.ok) {
        setPrompting(false);
        setKey("");
      }
      await refresh();
    } catch (err) {
      setMessage(String(err));
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="h-full w-full p-2">
        <div className="flex h-full items-center justify-center rounded-[var(--radius)] border border-border bg-card">
          <span className="font-mono text-xs text-muted-foreground">connecting…</span>
        </div>
      </div>
    );
  }

  const tone = TONE[state.phase];
  const inGrace = state.phase === "grace";
  const countdown = inGrace ? state.graceRemainingSeconds : state.remainingSeconds;
  const locked = state.lockoutSeconds > 0;

  return (
    <div className="h-full w-full p-2">
      <div
        className={cn(
          "flex h-full flex-col justify-between rounded-[var(--radius)] border bg-card p-4",
          "shadow-[var(--shadow-xl)] transition-colors duration-300",
          tone.border,
        )}
      >
        <header className="flex items-center justify-between" data-tauri-drag-region>
          <div className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full", tone.dot)} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {tone.eyebrow}
            </span>
          </div>
          {(!isTauri || state.dryRun) && (
            <Badge tone="neutral" className="px-2 py-0.5">
              preview
            </Badge>
          )}
        </header>

        <div className="flex items-end justify-between gap-3" data-tauri-drag-region>
          <div
            className={cn(
              "tabular font-mono text-[48px] font-semibold leading-none tracking-tight",
              tone.clock,
            )}
          >
            {state.released ? "off" : clock(countdown)}
          </div>
          <div className="pb-0.5 text-right">
            <div className="tabular font-mono text-[15px] leading-none text-foreground">
              {state.deadlineLabel}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {inGrace ? "grace ends" : "shutdown"}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500 ease-linear",
                tone.fill,
              )}
              style={{
                width: `${percentLeft(
                  countdown,
                  inGrace ? state.graceSeconds : state.totalSeconds,
                )}%`,
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className={cn("truncate", error ? "text-destructive" : "text-muted-foreground")}>
              {message ??
                (inGrace ? "save, commit, close" : `grace ${state.graceMinutes} min after zero`)}
            </span>
            {state.borrows > 0 && (
              <span className="shrink-0 font-mono text-secondary">borrows {state.borrows}</span>
            )}
          </div>

          {prompting ? (
            <form
              className="flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!locked) void submitKey();
              }}
            >
              <input
                // biome-ignore lint/a11y/noAutofocus: the prompt exists to be typed into
                autoFocus
                value={key}
                onChange={(event) => setKey(event.target.value)}
                disabled={locked || busy}
                placeholder={locked ? `locked ${clock(state.lockoutSeconds)}` : "release key"}
                aria-label="Release key"
                className={cn(
                  "h-9 min-w-0 flex-1 rounded-full border border-input bg-input/40 px-3.5 font-mono text-xs",
                  "text-foreground placeholder:text-muted-foreground/70",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  locked && "opacity-60",
                )}
              />
              <Button type="submit" size="sm" className="h-9" disabled={locked || busy}>
                Unlock
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-3"
                onClick={() => {
                  setPrompting(false);
                  setKey("");
                  setMessage(null);
                  setError(false);
                }}
              >
                Back
              </Button>
            </form>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2 text-xs"
                disabled={busy}
                onClick={() => void act(api.waitTen)}
              >
                Wait 10
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 border border-input/60 px-2 text-xs text-foreground"
                disabled={busy}
                onClick={() => {
                  setPrompting(true);
                  setMessage(null);
                  setError(false);
                }}
              >
                Release
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-9 px-2 text-xs"
                disabled={busy}
                onClick={() => void act(api.shutdownNow)}
              >
                Shut down
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
