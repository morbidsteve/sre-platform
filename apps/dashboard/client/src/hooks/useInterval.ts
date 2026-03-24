import { useEffect, useRef } from 'react';

export function useInterval(callback: () => void, delayMs: number, enabled = true): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || delayMs <= 0) return;

    savedCallback.current();

    const id = setInterval(() => savedCallback.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs, enabled]);
}
