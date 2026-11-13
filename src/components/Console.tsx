import { IconArrowRight, IconCheck, IconLock } from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, isTauri } from "@/lib/bridge";
import { scheduleDiffers, windowSentence } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { clock, parseHHmm, percentLeft } from "@/lib/format";
import { borrowedTotal, parseLog } from "@/lib/log";
import type { CurfewConfig, CurfewState, LogSummary } from "@/lib/types";
import { useConfirm } from "@/lib/use-confirm";

type View = "night" | "history" | "settings";

const PANES: Array<{ id: View; label: string }> = [
  { id: "night", label: "Tonight" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

function DeathClock({ state, start }: { state: CurfewState | null; start?: string }) {
  const grace = state?.phase === "grace";
  const expired = state?.phase === "expired";
  const seconds = grace
    ? (state?.graceRemainingSeconds ?? 0)
    : expired
      ? (state?.overdueSeconds ?? 0)
      : (state?.remainingSeconds ?? 0);
  const pct = expired
    ? 0
    : percentLeft(seconds, grace ? (state?.graceSeconds ?? 1) : (state?.totalSeconds ?? 1));

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <div
          className={cn(
            "tabular font-mono text-display font-medium tracking-tight",
            expired ? "text-destructive" : grace ? "text-secondary" : "text-foreground",
          )}
        >
          {state?.released ? "off" : expired ? `+${clock(seconds)}` : clock(seconds)}
        </div>
        <div className="text-sm text-muted-foreground">
          {expired
            ? `overdue since ${state?.deadlineLabel ?? "—"}`
            : `${grace ? "grace ends at" : "until"} ${state?.deadlineLabel ?? "—"}`}
        </div>
      </div>

      <div className="mt-7 h-0.5 w-full rounded-full bg-white/8">
        <div
          className={cn(
            "h-full rounded-full",
            expired ? "bg-destructive" : grace ? "bg-secondary" : "bg-primary-ink",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span className="tabular">{start ?? "—"}</span>
        <span className="tabular">{state?.deadlineLabel ?? "—"}</span>
      </div>
    </div>
  );
}

function Vitals({ state }: { state: CurfewState | null }) {
  const items = [
    { k: "Deadline", v: state?.deadlineLabel ?? "—" },
    { k: "Grace", v: `${state?.graceMinutes ?? 0} min` },
    { k: "Borrowed", v: String(state?.borrows ?? 0) },
    { k: "Owed", v: `${state?.owedMinutes ?? 0} min` },
  ];
  return (
    <div className="flex">
      {items.map((item, index) => (
        <div
          key={item.k}
          className={cn(
            "flex-1",
            index > 0 && "border-l border-white/8 pl-5",
            index === 0 && "pr-5",
          )}
        >
          <div className="text-xs text-muted-foreground">{item.k}</div>
          <div className="tabular mt-1 text-base font-medium">{item.v}</div>
        </div>
      ))}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-white/8 pt-5 first:mt-0 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const inputClass =
  "h-[34px] w-full rounded-[var(--radius-sm)] border border-input bg-white/2 px-2.5 text-sm tabular " +
  "text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary-ink";

export function Console() {
  const [view, setView] = useState<View>("night");
  const [state, setState] = useState<CurfewState | null>(null);
  const [logText, setLogText] = useState("");
  const [config, setConfig] = useState<CurfewConfig | null>(null);
  const [draft, setDraft] = useState<CurfewConfig | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState("—");
  const [borrowsOnly, setBorrowsOnly] = useState(false);
  const shutdown = useConfirm(3);

  const refresh = useCallback(async () => {
    try {
      setState(await api.getState());
    } catch (error) {
      toast.error(humanError(error));
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

  // First run and every upgrade: make sure tonight is actually scheduled.
  useEffect(() => {
    let cancelled = false;
    void api
      .ensureScheduled()
      .then((installed) => {
        if (!installed || cancelled) return;
        void api.getConfig().then((loaded) => {
          toast.success("Armed for tonight", {
            description: `Card at ${loaded.start}, shutdown at ${loaded.deadline}.`,
          });
        });
      })
      .catch((error) => toast.error(humanError(error)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Check once in the background; the offer carries its own button.
  useEffect(() => {
    let cancelled = false;
    void api
      .checkUpdate()
      .then((update) => {
        if (!update.available || cancelled) return;
        toast(`Curfew ${update.version} is ready`, {
          description: update.notes || "Signed build from GitHub.",
          duration: Number.POSITIVE_INFINITY,
          action: {
            label: "Install",
            onClick: () => {
              const id = toast.loading("Downloading and verifying…");
              void api
                .installUpdate()
                .then(() => toast.success("Installing", { id, description: "Curfew restarts." }))
                .catch((error) => toast.error(humanError(error), { id }));
            },
          },
        });
      })
      .catch(() => {
        /* a background check that fails is not worth interrupting anyone */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: LogSummary[] = useMemo(() => parseLog(logText), [logText]);
  const shown = borrowsOnly ? rows.filter((row) => row.borrows > 0) : rows;

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!draft) return out;
    const start = parseHHmm(draft.start);
    const deadline = parseHHmm(draft.deadline);
    if (start === null) out.start = "Use a 24h time, like 21:30.";
    if (deadline === null) out.deadline = "Use a 24h time, like 22:00.";
    if (start !== null && deadline !== null && start >= deadline)
      out.start = "The card has to open before the shutdown.";
    if (draft.graceMinutes < 0 || draft.graceMinutes > 120)
      out.graceMinutes = "Grace is 0–120 minutes.";
    return out;
  }, [draft]);

  const blocked = Object.keys(errors).length > 0;
  const movesClock = draft && config ? scheduleDiffers(draft, config) : false;
  const movesAnything =
    movesClock ||
    (config &&
      draft &&
      (config.batteryAllowed !== draft.batteryAllowed ||
        config.wakeToRun !== draft.wakeToRun ||
        config.autostartConsole !== draft.autostartConsole ||
        config.logDir !== draft.logDir));

  const save = async () => {
    if (!draft || blocked) return;
    setSaving(true);
    try {
      const next = await api.setConfig(draft, movesClock ? key : undefined);
      setConfig(next);
      setDraft(next);
      setKey("");
      toast.success(movesClock ? "Schedule saved" : "Settings saved", {
        description: movesClock
          ? `Card ${next.start} · shutdown ${next.deadline}.`
          : "Applied to the app and the task.",
      });
    } catch (error) {
      toast.error("Could not save", { description: humanError(error) });
    } finally {
      setSaving(false);
    }
  };

  const openCard = async () => {
    if (!isTauri) {
      window.open("/index.html?phase=work", "curfew-card", "width=380,height=248,popup=yes");
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_card", { minutes: 2, dryRun: true });
    toast.info("Test card opened", { description: "Two minutes. Nothing is enforced." });
  };

  const wait = async () => {
    try {
      const next = await api.waitTen();
      setState(next);
      if (next.borrows > 0) {
        toast.warning("Grace borrowed", {
          description: `Shutdown now ${next.deadlineLabel}. ${next.owedMinutes} min earlier start tomorrow.`,
        });
      } else {
        toast.success("Deadline moved", { description: `Shutdown now ${next.deadlineLabel}.` });
      }
    } catch (error) {
      toast.error(humanError(error));
    }
  };

  const shutDown = async () => {
    try {
      await api.shutdownNow();
    } catch (error) {
      toast.error(humanError(error));
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-white/8 px-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              state?.phase === "grace"
                ? "bg-secondary"
                : state?.phase === "expired"
                  ? "bg-destructive"
                  : "bg-success",
            )}
          />
          <span role="status" aria-live="polite">
            {state?.phase === "grace" ? (
              "Finish up"
            ) : state?.phase === "expired" ? (
              "Down"
            ) : (
              <>
                Armed <span className="text-foreground">until {state?.deadlineLabel ?? "—"}</span>
              </>
            )}
          </span>
        </div>

        <nav className="mx-auto flex gap-0.5 rounded-[10px] bg-white/3 p-[3px]">
          {PANES.map((pane) => (
            <button
              key={pane.id}
              type="button"
              onClick={() => setView(pane.id)}
              aria-current={view === pane.id ? "page" : undefined}
              className={cn(
                "h-[26px] rounded-md px-3 text-sm transition-colors",
                view === pane.id
                  ? "bg-white/8 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {pane.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => void openCard()}>
            Test card
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("text-muted-foreground", shutdown.armed && "text-destructive")}
            onClick={() => shutdown.trigger(() => void shutDown())}
          >
            {shutdown.armed ? `Shut down in ${shutdown.left}…` : "Shut down…"}
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-[640px] pb-28 pt-10">
          {view === "night" && (
            <div className="space-y-10">
              <DeathClock state={state} start={config?.start} />
              <Vitals state={state} />

              <div className="flex items-baseline gap-3 border-t border-white/8 pt-4 text-sm text-muted-foreground">
                <span className="w-20 text-xs">Last night</span>
                {rows[0] ? (
                  <span className="tabular">
                    {rows[0].start} · {rows[0].outcome} · {rows[0].borrows} borrows
                  </span>
                ) : (
                  <span>No nights on record yet.</span>
                )}
                <button
                  type="button"
                  onClick={() => setView("history")}
                  className="ml-auto inline-flex items-center gap-1 text-primary-ink hover:underline"
                >
                  History <IconArrowRight size={13} />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void wait()}>
                  Wait 10 min
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "ml-auto text-muted-foreground",
                    shutdown.armed && "text-destructive",
                  )}
                  onClick={() => shutdown.trigger(() => void shutDown())}
                >
                  {shutdown.armed ? `Confirm shut down (${shutdown.left})` : "Shut down…"}
                </Button>
              </div>
            </div>
          )}

          {view === "history" && (
            <div className="space-y-6">
              <div className="flex">
                {[
                  { k: "Nights", v: String(rows.length) },
                  { k: "Borrowed", v: String(borrowedTotal(rows)) },
                  { k: "Released", v: String(rows.filter((r) => r.released).length) },
                ].map((stat, index) => (
                  <div
                    key={stat.k}
                    className={cn("flex-1", index > 0 && "border-l border-white/8 pl-5")}
                  >
                    <div className="text-xs text-muted-foreground">{stat.k}</div>
                    <div className="tabular mt-1 text-lg font-medium">{stat.v}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-1">
                {[
                  { on: false, label: "All nights" },
                  { on: true, label: "With borrows" },
                ].map((filter) => (
                  <button
                    key={filter.label}
                    type="button"
                    onClick={() => setBorrowsOnly(filter.on)}
                    className={cn(
                      "h-7 rounded-full border px-3 text-xs transition-colors",
                      borrowsOnly === filter.on
                        ? "border-white/15 bg-white/8 text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              {shown.length === 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-dashed border-white/10 px-5 py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {borrowsOnly
                      ? "No night borrowed grace. Keep it that way."
                      : "No nights on record yet. The first night writes the first line."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => void openCard()}
                  >
                    Run a test card
                  </Button>
                </div>
              ) : (
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
                    {shown.map((row) => (
                      <TR key={row.raw}>
                        <TD className="tabular text-xs">{row.date}</TD>
                        <TD className="tabular text-xs text-muted-foreground">{row.start}</TD>
                        <TD className="tabular text-xs text-muted-foreground">{row.deadline}</TD>
                        <TD>
                          <span
                            className={cn(
                              "tabular text-xs",
                              row.borrows > 0 ? "text-secondary" : "text-muted-foreground",
                            )}
                          >
                            {row.borrows}
                          </span>
                        </TD>
                        <TD>
                          <Badge tone={row.released ? "warn" : "ok"}>
                            {row.released ? "released" : row.outcome}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          )}

          {view === "settings" && draft && (
            <div>
              <Group title="Schedule" hint="When the card appears and when Windows goes down.">
                <div className="flex gap-3">
                  {(
                    [
                      ["start", "Card opens", "time", errors.start],
                      ["deadline", "Shutdown", "time", errors.deadline],
                      ["graceMinutes", "Grace", "number", errors.graceMinutes],
                    ] as const
                  ).map(([field, label, type, message]) => (
                    <div key={field} className="flex-1">
                      <span className="mb-1.5 block text-xs text-muted-foreground">{label}</span>
                      <input
                        type={type}
                        min={type === "number" ? 0 : undefined}
                        max={type === "number" ? 120 : undefined}
                        value={draft[field]}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            [field]:
                              type === "number" ? Number(event.target.value) : event.target.value,
                          })
                        }
                        className={cn(inputClass, message && "border-destructive")}
                      />
                      {message && <p className="mt-1 text-xs text-destructive">{message}</p>}
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-sm text-muted-foreground">{windowSentence(draft)}</p>

                {movesClock && (
                  <div className="mt-3 flex items-center gap-3 rounded-[var(--radius-sm)] border border-white/10 bg-white/3 px-3 py-2.5">
                    <IconLock size={14} className="shrink-0 text-secondary" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-secondary">
                        The clock needs the release key
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Moving a time is the one edit the curfew exists to prevent.
                      </div>
                    </div>
                    <input
                      type="password"
                      value={key}
                      onChange={(event) => setKey(event.target.value)}
                      placeholder="release key"
                      aria-label="Release key"
                      className="ml-auto h-7 w-40 rounded-md border border-white/12 bg-black/25 px-2.5 font-mono text-xs"
                    />
                  </div>
                )}
              </Group>

              <Group title="Behaviour">
                <div className="-mt-1">
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
                        "Brings the laptop out of sleep to draw the card.",
                      ],
                      [
                        "autostartConsole",
                        "Open console at login",
                        "Tray countdown, close to tray, no taskbar button.",
                      ],
                    ] as const
                  ).map(([field, title, hint]) => (
                    <div
                      key={field}
                      className="flex items-center gap-4 border-t border-white/8 py-3 first:border-t-0"
                    >
                      <div>
                        <div className="text-sm">{title}</div>
                        <div className="text-xs text-muted-foreground">{hint}</div>
                      </div>
                      <div className="ml-auto">
                        <Switch
                          label={title}
                          checked={draft[field]}
                          onChange={(next) => setDraft({ ...draft, [field]: next })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Group>

              <Group title="Log" hint="Point it at a synced folder and the log leaves the machine.">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft.logDir}
                    onChange={(event) => setDraft({ ...draft, logDir: event.target.value })}
                    placeholder="empty: the app's own log folder"
                    className={cn(inputClass, "font-mono text-xs")}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(state?.logPath ?? "")
                        .then(() => toast.success("Path copied"))
                        .catch(() => toast.error("Could not copy the path"));
                    }}
                  >
                    Copy
                  </Button>
                </div>
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground/70">
                  now: {state?.logPath ?? "unknown"}
                </p>
              </Group>

              <Group title="Build">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="tabular text-sm">Curfew {version}</div>
                    <div className="text-xs text-muted-foreground">
                      Releases are signed; the manifest is verified before install.
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-primary-ink"
                    onClick={() => {
                      const id = toast.loading("Checking the manifest…");
                      void api
                        .checkUpdate()
                        .then((update) => {
                          if (!update.available) {
                            toast.success("Up to date", { id, description: `Curfew ${version}` });
                            return;
                          }
                          toast(`Curfew ${update.version} is ready`, {
                            id,
                            description: update.notes || "Signed build from GitHub.",
                            duration: Number.POSITIVE_INFINITY,
                            action: {
                              label: "Install",
                              onClick: () => {
                                const job = toast.loading("Downloading and verifying…");
                                void api
                                  .installUpdate()
                                  .then(() =>
                                    toast.success("Installing", {
                                      id: job,
                                      description: "Curfew restarts itself.",
                                    }),
                                  )
                                  .catch((error) => toast.error(humanError(error), { id: job }));
                              },
                            },
                          });
                        })
                        .catch((error) => toast.error(humanError(error), { id }));
                    }}
                  >
                    Check for updates
                  </Button>
                </div>
              </Group>
            </div>
          )}
        </div>
      </main>

      {view === "settings" && movesAnything && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-5">
          <div className="pointer-events-auto flex w-[640px] items-center gap-3 rounded-[var(--radius)] border border-white/10 bg-popover px-4 py-3 shadow-xl">
            <div className="text-sm text-muted-foreground">
              <span className="text-foreground">Unsaved changes</span>
              {movesClock ? " — the clock is locked until you enter the key." : "."}
            </div>
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => config && setDraft(config)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saving || blocked || (movesClock && key.trim().length === 0)}
                onClick={() => void save()}
              >
                <IconCheck size={14} /> Save changes
              </Button>
            </div>
          </div>
        </div>
      )}

      <Toaster />
    </div>
  );
}
