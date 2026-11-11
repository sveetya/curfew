import { useCallback, useEffect, useMemo, useState } from "react";
import { api, isTauri } from "@/lib/bridge";
import { clock, percentLeft, parseHHmm } from "@/lib/format";
import { scheduleDiffers } from "@/lib/config";
import { borrowedTotal, parseLog } from "@/lib/log";
import type { CurfewConfig, CurfewState, LogSummary } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

type View = "night" | "history" | "settings" | "updates";

const NAV: Array<{ id: View; label: string }> = [
  { id: "night", label: "Tonight" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
  { id: "updates", label: "Updates" },
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border/70 bg-background/30 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="tabular mt-1 font-mono text-lg leading-none">{value}</div>
      {hint && <div className="mt-1.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function EmptyRow({ children, colSpan = 5 }: { children: string; colSpan?: number }) {
  return (
    <TR>
      <TD className="text-muted-foreground" colSpan={colSpan}>
        {children}
      </TD>
    </TR>
  );
}

export function Console() {
  const [view, setView] = useState<View>("night");
  const [state, setState] = useState<CurfewState | null>(null);
  const [logText, setLogText] = useState("");
  const [config, setConfig] = useState<CurfewConfig | null>(null);
  const [draft, setDraft] = useState<CurfewConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState("0.1.0");
  const [update, setUpdate] = useState<{ available: boolean; version: string; notes: string } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.getState());
    } catch (error) {
      setNote(String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void api.readLog().then(setLogText).catch(() => setLogText(""));
    void api.getVersion().then(setVersion).catch(() => setVersion("unknown"));
    void api.getConfig().then((next) => {
      setConfig(next);
      setDraft(next);
    });
    const interval = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const rows: LogSummary[] = useMemo(() => parseLog(logText), [logText]);

  const scheduleMoves = draft && config ? scheduleDiffers(draft, config) : false;

  const commit = async (withKey?: string) => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await api.setConfig(draft, withKey);
      setConfig(next);
      setDraft(next);
      setAsking(false);
      setKey("");
      setSaveError(null);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (error) {
      setSaveError(String(error).replace(/^.*Error:\s*/, ""));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (scheduleMoves) {
      setAsking(true);
      setSaveError(null);
      return;
    }
    await commit();
  };

  const openCard = async () => {
    if (!isTauri) {
      window.open(
        "/index.html?phase=work",
        "curfew-card",
        "width=380,height=300,popup=yes",
      );
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_card", { minutes: 2, dryRun: true });
  };

  return (
    <div className="flex h-full bg-background text-foreground">
      <aside className="flex w-[236px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5">
        <div className="flex items-center gap-2.5 px-2">
          <div className="grid size-8 place-items-center rounded-[var(--radius-sm)] bg-primary text-primary-foreground">
            <span className="font-mono text-[13px] font-bold">C</span>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Curfew</div>
            <div className="text-[11px] text-muted-foreground">night guard</div>
          </div>
        </div>

        <nav className="mt-7 flex flex-col gap-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={cn(
                "h-9 rounded-full px-3.5 text-left text-[13px] transition-colors",
                view === item.id
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-2 px-2 text-[11px] text-muted-foreground">
          {!isTauri && (
            <div className="rounded-[var(--radius-sm)] border border-secondary/40 bg-secondary/10 px-3 py-2 text-secondary">
              Preview — no Windows backend attached.
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-1.5 rounded-full",
                state?.phase === "grace" ? "bg-secondary" : "bg-emerald-400",
              )}
            />
            <span>
              {state?.phase === "grace" ? "in finish up" : "armed"}
              {state ? ` · ${state.deadlineLabel}` : ""}
            </span>
          </div>
          <div className="font-mono">v{version}</div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-background/85 px-8 backdrop-blur">
          <div>
            <h1 className="text-sm font-semibold tracking-tight">
              {view === "night"
                ? "Tonight"
                : view === "history"
                  ? "History"
                  : view === "settings"
                    ? "Settings"
                    : "Updates"}
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {view === "night"
                ? "Countdown, deadline, and what happened last night."
                : view === "history"
                  ? "Every run from the audit log, newest first."
                  : view === "settings"
                    ? "The schedule Task Scheduler runs."
                    : "Signed builds, installed from the manifest."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void openCard()}>
              Test card
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void api.shutdownNow().then(setState)}
            >
              Shut down now
            </Button>
          </div>
        </header>

        <div className="mx-auto max-w-[840px] space-y-5 px-8 py-7">
          {note && (
            <div className="rounded-[var(--radius-sm)] border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
              {note}
            </div>
          )}

          {view === "night" && (
            <>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            state?.phase === "grace" ? "bg-secondary" : "bg-primary",
                          )}
                        />
                        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          {state?.phase === "grace" ? "finish up" : "night curfew"}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "tabular mt-2 font-mono text-[56px] font-semibold leading-none tracking-tight",
                          state?.phase === "grace" && "text-secondary",
                        )}
                      >
                        {state
                          ? clock(
                              state.phase === "grace"
                                ? state.graceRemainingSeconds
                                : state.remainingSeconds,
                            )
                          : "—:—"}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {state?.phase === "grace"
                          ? "Grace is running. Save, commit, close."
                          : `Windows goes down at ${state?.deadlineLabel ?? "22:00"}. No cancel button.`}
                      </p>
                    </div>

                    <div className="grid w-[280px] shrink-0 grid-cols-2 gap-2">
                      <Stat label="Deadline" value={state?.deadlineLabel ?? "—"} hint="shutdown" />
                      <Stat
                        label="Grace"
                        value={`${state?.graceMinutes ?? 0} min`}
                        hint="carved out"
                      />
                      <Stat
                        label="Borrowed"
                        value={String(state?.borrows ?? 0)}
                        hint="windows tonight"
                      />
                      <Stat
                        label="Owed"
                        value={`${state?.owedMinutes ?? 0} min`}
                        hint="earlier start"
                      />
                    </div>
                  </div>

                  <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${percentLeft(state?.remainingSeconds ?? 0, state?.totalSeconds ?? 1)}%`,
                      }}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between p-5">
                  <div>
                    <CardTitle>This week</CardTitle>
                    <CardDescription>
                      Parsed from the audit log beside the script.
                    </CardDescription>
                  </div>
                  <Badge tone="neutral">{rows.length} runs</Badge>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Night</TH>
                        <TH>Start</TH>
                        <TH>Deadline</TH>
                        <TH>Borrows</TH>
                        <TH>Outcome</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {rows.length === 0 && (
                        <EmptyRow>
                          No runs logged yet. The first night writes the first line.
                        </EmptyRow>
                      )}
                      {rows.slice(0, 7).map((row) => (
                        <TR key={row.raw}>
                          <TD className="font-mono text-xs">{row.date}</TD>
                          <TD className="font-mono text-xs text-muted-foreground">{row.start}</TD>
                          <TD className="font-mono text-xs text-muted-foreground">{row.deadline}</TD>
                          <TD>
                            <span
                              className={cn(
                                "font-mono text-xs",
                                row.borrows > 0 ? "text-secondary" : "text-muted-foreground",
                              )}
                            >
                              {row.borrows}
                            </span>
                          </TD>
                          <TD>
                            <Badge tone={row.released ? "warn" : row.outcome === "shutdown" ? "ok" : "neutral"}>
                              {row.released ? "released" : row.outcome}
                            </Badge>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}

          {view === "history" && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Runs" value={String(rows.length)} hint="all nights on record" />
                <Stat
                  label="Borrowed"
                  value={String(borrowedTotal(rows))}
                  hint="grace windows"
                />
                <Stat
                  label="Released"
                  value={String(rows.filter((row) => row.released).length)}
                  hint="times the key came out"
                />
              </div>
              <Card>
                <CardHeader className="p-5">
                  <CardTitle>Audit log</CardTitle>
                  <CardDescription className="font-mono text-[11px]">
                    {state?.logPath ?? "log path unknown"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Night</TH>
                        <TH>Start</TH>
                        <TH>Deadline</TH>
                        <TH>Grace</TH>
                        <TH>Borrows</TH>
                        <TH>Outcome</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {rows.length === 0 && <EmptyRow>Nothing logged yet.</EmptyRow>}
                      {rows.map((row) => (
                        <TR key={row.raw}>
                          <TD className="font-mono text-xs">{row.date}</TD>
                          <TD className="font-mono text-xs text-muted-foreground">{row.start}</TD>
                          <TD className="font-mono text-xs text-muted-foreground">{row.deadline}</TD>
                          <TD className="font-mono text-xs text-muted-foreground">{row.grace}</TD>
                          <TD className="font-mono text-xs">{row.borrows}</TD>
                          <TD>
                            <Badge tone={row.released ? "warn" : "ok"}>
                              {row.released ? "released" : row.outcome}
                            </Badge>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    One SUMMARY line per run. A high borrow count is the number worth watching,
                    not a single one.
                  </p>
                </CardContent>
              </Card>
            </>
          )}

          {view === "settings" && draft && (
            <Card>
              <CardHeader className="p-5">
                <CardTitle>Schedule</CardTitle>
                <CardDescription>
                  Saved to config.json and applied to the Curfew task immediately. Moving the
                  clock needs the release key; the switches do not.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-5 pt-0">
                <div className="grid grid-cols-3 gap-3">
                  <label className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Card opens
                    </span>
                    <input
                      type="time"
                      value={draft.start}
                      onChange={(event) => setDraft({ ...draft, start: event.target.value })}
                      className="h-10 w-full rounded-[var(--radius-sm)] border border-input bg-input/30 px-3 font-mono text-sm"
                    />
                    {parseHHmm(draft.start) === null && (
                      <span className="text-[11px] text-destructive">Use HH:mm</span>
                    )}
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Shutdown
                    </span>
                    <input
                      type="time"
                      value={draft.deadline}
                      onChange={(event) => setDraft({ ...draft, deadline: event.target.value })}
                      className="h-10 w-full rounded-[var(--radius-sm)] border border-input bg-input/30 px-3 font-mono text-sm"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Grace
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={draft.graceMinutes}
                      onChange={(event) =>
                        setDraft({ ...draft, graceMinutes: Number(event.target.value) })
                      }
                      className="h-10 w-full rounded-[var(--radius-sm)] border border-input bg-input/30 px-3 font-mono text-sm"
                    />
                  </label>
                </div>

                <div className="divide-y divide-border/70 rounded-[var(--radius-md)] border border-border/70">
                  {(
                    [
                      ["batteryAllowed", "Run on battery", "A laptop that unplugs escapes a curfew that needs mains."],
                      ["wakeToRun", "Wake the machine", "The task brings the laptop out of sleep to draw the card."],
                      ["autostartConsole", "Open console at login", "Tray countdown, close to tray, no taskbar button."],
                    ] as const
                  ).map(([key, label, hint]) => (
                    <div key={key} className="flex items-center justify-between gap-6 px-4 py-3.5">
                      <div>
                        <div className="text-[13px]">{label}</div>
                        <div className="text-[11px] text-muted-foreground">{hint}</div>
                      </div>
                      <Switch
                        label={label}
                        checked={draft[key]}
                        onChange={(next) => setDraft({ ...draft, [key]: next })}
                      />
                    </div>
                  ))}
                </div>

                {asking ? (
                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void commit(key);
                    }}
                  >
                    <p className="text-[11px] text-muted-foreground">
                      The clock is key-gated. Enter the release key to move it.
                    </p>
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        type="password"
                        value={key}
                        onChange={(event) => setKey(event.target.value)}
                        placeholder="release key"
                        aria-label="Release key"
                        className="h-10 min-w-0 flex-1 rounded-full border border-input bg-input/40 px-4 font-mono text-xs"
                      />
                      <Button type="submit" size="sm" className="h-10" disabled={saving}>
                        Unlock &amp; save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10"
                        onClick={() => {
                          setAsking(false);
                          setKey("");
                          setSaveError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                    {saveError && <p className="text-[11px] text-destructive">{saveError}</p>}
                  </form>
                ) : (
                  <div className="flex items-center gap-3">
                    <Button size="sm" onClick={() => void save()}>
                      Save schedule
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      {saved
                        ? "Saved. Task Scheduler updated."
                        : scheduleMoves
                          ? "Changing the clock needs the release key."
                          : `Armed nightly at ${config?.start}.`}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {view === "updates" && (
            <>
              <Card>
                <CardHeader className="p-5">
                  <CardTitle>Updates</CardTitle>
                  <CardDescription>
                    Installed from the signed manifest. The hash in the manifest is checked before
                    anything runs.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-5 pt-0">
                  <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-border/70 px-4 py-3">
                    <div>
                      <div className="text-[13px]">Installed version</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{version}</div>
                    </div>
                    <Badge tone="ok">up to date</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updateBusy}
                      onClick={() => {
                        setUpdateBusy(true);
                        void api
                          .checkUpdate()
                          .then(setUpdate)
                          .catch((error) => setNote(String(error)))
                          .finally(() => setUpdateBusy(false));
                      }}
                    >
                      Check for updates
                    </Button>
                    {update?.available && (
                      <Button size="sm" onClick={() => void api.installUpdate()}>
                        Install {update.version}
                      </Button>
                    )}
                  </div>
                  {update && (
                    <p className="text-[11px] text-muted-foreground">
                      {update.available
                        ? `Version ${update.version} is available. ${update.notes}`
                        : "No update available."}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-5">
                  <CardTitle>Honest limits</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-5 pt-0 text-xs leading-relaxed text-muted-foreground">
                  <p>A guardrail, not a cage. Task Manager ends the process.</p>
                  <p>The updater only installs builds signed with the release key.</p>
                  <p>A pending Windows shutdown is aborted by our own shutdown call.</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
