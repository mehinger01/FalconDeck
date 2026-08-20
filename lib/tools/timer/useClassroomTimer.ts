"use client";

import { useEffect, useState } from "react";
import {
  adjustTimerRemaining,
  createTimerState,
  isTimerFinished,
  pauseTimer,
  resetTimer,
  setTimerDuration,
  startTimer,
  tickTimer,
  type TimerState,
} from "./timerLogic";

export const TIMER_PRESET_MINUTES = [2, 5, 10, 15] as const;
const DEFAULT_DURATION_SECONDS = 5 * 60;

export interface ClassroomTimer extends TimerState {
  isFinished: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  setDuration: (seconds: number) => void;
  adjustRemaining: (deltaSeconds: number) => void;
}

/**
 * A manually-operated classroom countdown - completely independent of the
 * bell schedule engine. It never reads schedule state, and starting,
 * pausing, or resetting it has zero effect on the live/preview
 * presentation (see `getPresentationState`, which this hook never calls).
 * All the actual state-transition logic lives in `timerLogic` (pure, no
 * React); this hook only wires that to `useState` and a `setInterval`
 * tick. Nothing here is persisted - it resets on reload, like a physical
 * classroom timer.
 */
export function useClassroomTimer(initialSeconds: number = DEFAULT_DURATION_SECONDS): ClassroomTimer {
  const [state, setState] = useState<TimerState>(() => createTimerState(initialSeconds));

  useEffect(() => {
    if (!state.isRunning) return;
    const id = setInterval(() => setState(tickTimer), 1000);
    return () => clearInterval(id);
  }, [state.isRunning]);

  return {
    ...state,
    isFinished: isTimerFinished(state),
    start: () => setState(startTimer),
    pause: () => setState(pauseTimer),
    reset: () => setState(resetTimer),
    setDuration: (seconds) => setState(setTimerDuration(seconds)),
    adjustRemaining: (deltaSeconds) => setState((current) => adjustTimerRemaining(current, deltaSeconds)),
  };
}
