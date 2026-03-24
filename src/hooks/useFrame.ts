import { useRef, useEffect } from "react";

/**
 * Runs a callback on every animation frame.
 * The callback receives no arguments — callers read current state from refs.
 * Automatically starts/stops based on `active`.
 */
export function useFrame(callback: () => void, active = true) {
  const callbackRef = useRef(callback);
  const animRef = useRef(0);

  // Keep the callback ref current (via effect to satisfy React compiler)
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!active) return;

    const loop = () => {
      callbackRef.current();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animRef.current);
  }, [active]);
}
