import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/card";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import { clock, percentLeft } from "@/lib/format";
import type { CurfewState } from "@/lib/types";
import { useConfirm } from "@/lib/use-confirm";

const TONE = {
  work: {
    dot: "bg-success",
    clock: "text-foreground",
    bar: "bg-primary-ink",
    label: "Night curfew",
    note: "no cancel",
  },
  grace: {
    dot: "bg-secondary",
    clock: "text-secondary",
    bar: "bg-secondary",
    label: "Finish up",
    note: "last minutes",
  },
  expired: {
    dot: "bg-destructive",
    clock: "text-destructive",
    bar: "bg-destructive",
    label: "Shutting down",
    note: "now",
  },
} as const;

export function CurfewCard() {
  const [state, setState] = useState<CurfewState | null>(null);
  const [prompting, setPrompting] = useState(false);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const shutdown = useConfirm(3);

  const refresh = useCallback(async () => {
    try {
      setState(await api.getState());
    } catch (err) {
      setMessage(humanError(err));
      setError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const tick = window.setInterval(() => void refresh(), 500);
    return () => window.clearInterval(tick);
  }, [refresh]);

  // Esc backs out of the key prompt, the way any modal should.
  useEffect(() => {
    if (!prompting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPrompting(false);
        setKey("");
        setMessage(null);
        setError(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompting]);

  const wait = async () => {
    setBusy(true);
    try {
      const next = await api.waitTen();
      setState(next);
      setError(false);
      setMessage(
        next.borrows > 0
          ? `borrowed · ${next.owedMinutes} min owed`
          : `moved to ${next.deadlineLabel}`,
      );
    } catch (err) {
      setMessage(humanError(err));
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
      setMessage(humanError(err));
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const shutDown = async () => {
    try {
      await api.shutdownNow();
    } catch (err) {
      setMessage(humanError(err));
      setError(true);
    }
  };

  if (!state) {
    return (
      <div className="grid h-full place-items-center">
        <span className="font-mono text-xs text-muted-foreground">connecting…</span>
      </div>
    );
  }

  const tone = TONE[state.phase];
  const grace = state.phase === "grace";
  const seconds = grace ? state.graceRemainingSeconds : state.remainingSeconds;

  return (
    <div className="p-2">
      <div className="flex h-[232px] flex-col rounded-[18px] border border-white/10 bg-card px-4 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
        <header className="flex items-center gap-2" data-tauri-drag-region>
          <span className={cn("size-1.5 rounded-full", tone.dot)} />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {tone.label}
          </span>
          <span className="tabular ml-auto text-xs text-muted-foreground">
            {state.deadlineLabel}
          </span>
        </header>

        <div className="mt-3.5 flex items-baseline gap-2.5" data-tauri-drag-region>
          <div
            className={cn("tabular font-mono text-display font-medium tracking-tight", tone.clock)}
          >
            {state.released ? "off" : clock(seconds)}
          </div>
          <div className="text-xs text-muted-foreground">
            {grace ? "grace" : state.borrows > 0 ? `${state.borrows} borrowed` : tone.note}
          </div>
        </div>

        <div className="mt-auto">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/8">
            <div
              className={cn("h-full rounded-full", tone.bar)}
              style={{
                width: `${percentLeft(seconds, grace ? state.graceSeconds : state.totalSeconds)}%`,
              }}
            />
          </div>

          {message && (
            <p
              className={cn(
                "mt-2 truncate text-xs",
                error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {message}
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-1">
            {prompting ? (
              <form
                className="flex w-full gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (state.lockoutSeconds === 0) void submitKey();
                }}
              >
                <input
                  // biome-ignore lint/a11y/noAutofocus: the prompt exists to be typed into
                  autoFocus
                  type="password"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  disabled={state.lockoutSeconds > 0 || busy}
                  placeholder={
                    state.lockoutSeconds > 0
                      ? `locked ${clock(state.lockoutSeconds)}`
                      : "release key"
                  }
                  aria-label="Release key"
                  className="h-8 min-w-0 flex-1 rounded-md border border-white/12 bg-black/25 px-2.5 font-mono text-xs disabled:opacity-60"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="h-8"
                  disabled={state.lockoutSeconds > 0 || busy}
                >
                  Unlock
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground"
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
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={busy}
                  onClick={() => void wait()}
                >
                  Wait 10 min
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground"
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
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "ml-auto h-8 px-2 text-muted-foreground",
                    shutdown.armed && "text-destructive",
                  )}
                  disabled={busy}
                  onClick={() => shutdown.trigger(() => void shutDown())}
                >
                  {shutdown.armed ? `Confirm (${shutdown.left})` : "Shut down…"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
