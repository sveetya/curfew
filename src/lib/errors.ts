/**
 * Errors, said the way a person would.
 *
 * The Rust side returns strings; some are already human ("Wrong key. Locked
 * for 5 minutes."), some leak internals ("the log folder must be an absolute
 * path"). Everything that reaches a toast goes through here first.
 */
const MAP: Array<[RegExp, string]> = [
  [/no release key/i, "This build carries no key, so the clock cannot move."],
  [/wrong key/i, "That key is not right."],
  [/locked/i, "Still locked out. Give it a few minutes."],
  [/card must open before the shutdown/i, "The card has to open before the shutdown."],
  [
    /log folder must be an absolute path/i,
    "That log folder needs a full path, like C:\\Curfew\\logs.",
  ],
  [/grace must be between/i, "Grace has to be between 0 and 120 minutes."],
  [/failed to fetch|network|dns/i, "Could not reach the update server."],
  [/permission denied|access is denied/i, "Windows would not allow that write."],
];

export function humanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const clean = raw.replace(/^error:\s*/i, "").trim();
  for (const [pattern, message] of MAP) {
    if (pattern.test(clean)) return message;
  }
  return clean.length > 0 ? clean.slice(0, 160) : "Something went wrong.";
}
