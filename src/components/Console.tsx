import {
  IconAlarm,
  IconHistory,
  IconLoader2,
  IconMoonOff,
  IconMoonStars,
  IconRefresh,
  IconSettings,
  IconShieldCheck,
} from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, isTauri } from "@/lib/bridge";
import { scheduleDiffers } from "@/lib/config";
import { clock, parseHHmm, percentLeft } from "@/lib/format";
import { borrowedTotal, parseLog } from "@/lib/log";
import type { CurfewConfig, CurfewState, LogSummary } from "@/lib/types";

type View = "night" | "history" | "settings";

const NAV = [
  { id: "night", label: "Tonight", Icon: IconMoonStars },
  { id: "history", label: "History", Icon: IconHistory },
  { id: "settings", label: "Settings", Icon: IconSettings },
] as const;

const TITLES: Record<View, { title: string; hint: string }> = {
  night: { title: "Tonight", hint: "Countdown, deadline, and what happened last night." },
  history: { title: "History", hint: "Every run from the audit log, newest first." },
  settings: { title: "Settings", hint: "The schedule, the log, and the build." },
};

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

/** The one always-visible answer to "is it on?". */
function StatusPanel({ state, start }: { state: CurfewState | null; start?: string }) {
  const phase = state?.phase ?? "work";
  const tone = {
    work: {
      Icon: IconShieldCheck,
      chip: "bg-emerald-500/12 text-emerald-400",
      bar: "bg-emerald-400/70",
      label: "Armed",
    },
    grace: {
      Icon: IconAlarm,
      chip: "bg-secondary/15 text-secondary",
      bar: "bg-secondary",
      label: "Finish up",
    },
    expired: {
      Icon: IconMoonOff,
      chip: "bg-muted text-muted-foreground",
      bar: "bg-muted-foreground",
      label: "Down",
    },
  }[phase];

  const elapsed = state
    ? Math.min(100, Math.max(0, 100 - percentLeft(state.remainingSeconds, state.totalSeconds)))
    : 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-border/60 bg-sidebar-accent/40 p-3">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", tone.chip)}>
          <tone.Icon size={15} stroke={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium leading-none" role="status" aria-live="polite">
              {tone.label}
            </span>
            <span className={cn("size-1.5 rounded-full", tone.bar)} />
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {start ? `${start} → ${state?.deadlineLabel ?? "—"}` : "schedule unset"}
          </div>
        </div>
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-border/70">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone.bar)}
          style={{ width: `${elapsed}%` }}
        />
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      {children}
      {hint && <div className="text-[11px] leading-relaxed text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
      <div>
        <div className="text-[13px]">{title}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

type UpdateStatus = "idle" | "checking" | "current" | "available" | "error";

function UpdateRow({
  version,
  status,
  updateVersion,
  notes,
  onCheck,
  onInstall,
}: {
  version: string;
  status: UpdateStatus;
  updateVersion: string;
  notes: string;
  onCheck: () => void;
  onInstall: () => void;
}) {
  const available = status === "available";
  const subtitle = {
    idle: "Signed manifest, checked on demand.",
    checking: "Checking the signed manifest…",
    current: "Up to date. The manifest is signed.",
    available: `Version ${updateVersion} is ready to install.`,
    error: "Could not reach the manifest. Check back later.",
  }[status];

  return (
    <div className="rounded-[var(--radius-md)] border border-border/70 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full",
              available ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground",
            )}
          >
            <IconRefresh size={15} stroke={1.9} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px]">Curfew {version}</div>
            <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        <Button
          variant={available ? "primary" : "outline"}
          size="sm"
          disabled={status === "checking"}
          onClick={available ? onInstall : onCheck}
        >
          {status === "checking" ? (
            <span className="flex items-center gap-1.5">
              <IconLoader2 size={13} className="animate-spin" />
              Checking
            </span>
          ) : available ? (
            `Install ${updateVersion}`
          ) : (
            "Check for updates"
          )}
        </Button>
      </div>
      {available && notes && (
        <p className="mt-2.5 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {notes}
        </p>
      )}
    </div>
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
  const [version, setVersion] = useState("—");
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<{ available: boolean; version: string; notes: string }>({
    available: false,
    version: "",
    notes: "",
  });
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
    void api
      .readLog()
      .then(setLogText)
      .catch(() => setLogText(""));
    void api
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
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

  const checkUpdates = async () => {
    setStatus("checking");
    try {
      const result = await api.checkUpdate();
      setUpdate(result);
      setStatus(result.available ? "available" : "current");
    } catch (error) {
      setNote(String(error));
      setStatus("error");
    }
  };

  const installUpdate = async () => {
    setStatus("checking");
    try {
      await api.installUpdate();
    } catch (error) {
      setNote(String(error));
      setStatus("error");
    }
  };

  const openCard = async () => {
    if (!isTauri) {
      window.open("/index.html?phase=work", "curfew-card", "width=380,height=300,popup=yes");
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_card", { minutes: 2, dryRun: true });
  };

  return (
    <div className="flex h-full bg-background text-foreground">
      <aside className="flex w-[224px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4">
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ id, label, Icon }) => {
            const active = view === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-9 items-center gap-2.5 rounded-full px-3 text-left text-[13px] transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon
                  size={16}
                  stroke={1.9}
                  className={cn(
                    "shrink-0 transition-colors",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2">
          <StatusPanel state={state} start={config?.start} />
          {!isTauri && (
            <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground/80">
              <span className="size-1 rounded-full bg-secondary" />
              Preview — no Windows backend
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-background/85 px-8 backdrop-blur">
          <div>
            <h1 className="text-sm font-semibold tracking-tight">{TITLES[view].title}</h1>
            <p className="text-[11px] text-muted-foreground">{TITLES[view].hint}</p>
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
                    <CardDescription>Parsed from the audit log.</CardDescription>
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
                          <TD className="font-mono text-xs text-muted-foreground">
                            {row.deadline}
                          </TD>
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
                            <Badge
                              tone={
                                row.released
                                  ? "warn"
                                  : row.outcome === "shutdown"
                                    ? "ok"
                                    : "neutral"
                              }
                            >
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
                <Stat label="Borrowed" value={String(borrowedTotal(rows))} hint="grace windows" />
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
                          <TD className="font-mono text-xs text-muted-foreground">
                            {row.deadline}
                          </TD>
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
                    One SUMMARY line per run. A high borrow count is the number worth watching, not
                    a single one.
                  </p>
                </CardContent>
              </Card>
            </>
          )}

          {view === "settings" && draft && (
            <>
              <Card>
                <CardHeader className="p-5">
                  <CardTitle>Schedule</CardTitle>
                  <CardDescription>
                    Applied to the Curfew task on save. Moving the clock needs the release key; the
                    switches do not.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 p-5 pt-0">
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Card opens">
                      <input
                        type="time"
                        value={draft.start}
                        onChange={(event) => setDraft({ ...draft, start: event.target.value })}
                        className="h-10 w-full rounded-[var(--radius-sm)] border border-input bg-input/30 px-3 font-mono text-sm"
                      />
                      {parseHHmm(draft.start) === null && (
                        <span className="text-[11px] text-destructive">Use HH:mm</span>
                      )}
                    </Field>
                    <Field label="Shutdown">
                      <input
                        type="time"
                        value={draft.deadline}
                        onChange={(event) => setDraft({ ...draft, deadline: event.target.value })}
                        className="h-10 w-full rounded-[var(--radius-sm)] border border-input bg-input/30 px-3 font-mono text-sm"
                      />
                    </Field>
                    <Field label="Grace">
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
                    </Field>
                  </div>

                  <div className="divide-y divide-border/70 rounded-[var(--radius-md)] border border-border/70">
                    {(
                      [
                        [
                          "batteryAllowed",
                          "Run on battery",
                          "A laptop that unplugs escapes a curfew that needs mains.",
                        ],
                        [
                          "wakeToRun",
                          "Wake the machine",
                          "The task brings the laptop out of sleep to draw the card.",
                        ],
                        [
                          "autostartConsole",
                          "Open console at login",
                          "Tray countdown, close to tray, no taskbar button.",
                        ],
                      ] as const
                    ).map(([field, label, hint]) => (
                      <Row key={field} title={label} hint={hint}>
                        <Switch
                          label={label}
                          checked={draft[field]}
                          onChange={(next) => setDraft({ ...draft, [field]: next })}
                        />
                      </Row>
                    ))}
                  </div>

                  <Field
                    label="Audit log folder"
                    hint="Point this at a synced folder and the log leaves the machine. The card writes every run here, so the coach can read nights without touching the laptop. Saves without the key."
                  >
                    <input
                      type="text"
                      value={draft.logDir}
                      onChange={(event) => setDraft({ ...draft, logDir: event.target.value })}
                      placeholder="empty: the app's own log folder"
                      className="h-10 w-full rounded-[var(--radius-sm)] border border-input bg-input/30 px-3 font-mono text-[11px]"
                    />
                    <div className="font-mono text-[11px] text-muted-foreground/70">
                      now: {state?.logPath ?? "unknown"}
                    </div>
                  </Field>

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
                          // biome-ignore lint/a11y/noAutofocus: the prompt exists to be typed into
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

              <Card>
                <CardHeader className="p-5">
                  <CardTitle>Build</CardTitle>
                  <CardDescription>
                    Releases are signed, and the manifest hash is verified before anything installs.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  <UpdateRow
                    version={version}
                    status={status}
                    updateVersion={update.version}
                    notes={update.notes}
                    onCheck={() => void checkUpdates()}
                    onInstall={() => void installUpdate()}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
