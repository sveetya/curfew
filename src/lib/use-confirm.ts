import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-step danger for actions that cannot be undone.
 *
 * The first press arms it and starts a countdown; the second press commits;
 * silence cancels. It replaced a single click that shut the machine down,
 * which is the one place this app must not be trigger-happy.
 */
export function useConfirm(seconds = 3) {
  const [armed, setArmed] = useState(false);
  const [left, setLeft] = useState(seconds);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    setArmed(false);
    setLeft(seconds);
  }, [seconds]);

  const trigger = useCallback(
    (commit: () => void) => {
      if (armed) {
        stop();
        commit();
        return;
      }
      setArmed(true);
      let remaining = seconds;
      setLeft(remaining);
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          stop();
          return;
        }
        setLeft(remaining);
      }, 1000);
    },
    [armed, seconds, stop],
  );

  useEffect(() => stop, [stop]);
  return { armed, left, trigger };
}
