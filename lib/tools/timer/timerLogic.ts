/**
 * Pure classroom-timer state machine - no React, no interval, no
 * schedule/lesson access of any kind. `useClassroomTimer` is the only
 * thing that wires this to `setState`/`setInterval`; everything about
 * what a start/pause/reset/adjust/tick actually DOES lives here, so it's
 * directly unit-testable (see scripts/verify-classroom.ts) and provably
 * independent of the bell-schedule engine.
 */
export interface TimerState {
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  /** True once the timer has ever been started or adjusted - distinct from a fresh, untouched timer. */
  isActive: boolean;
}

export function createTimerState(initialSeconds: number): TimerState {
  const clamped = Math.max(0, Math.round(initialSeconds));
  return { totalSeconds: clamped, remainingSeconds: clamped, isRunning: false, isActive: false };
}

export function startTimer(state: TimerState): TimerState {
  if (state.remainingSeconds <= 0) return state;
  return { ...state, isRunning: true, isActive: true };
}

export function pauseTimer(state: TimerState): TimerState {
  return { ...state, isRunning: false };
}

export function resetTimer(state: TimerState): TimerState {
  return { ...state, isRunning: false, isActive: false, remainingSeconds: state.totalSeconds };
}

export function setTimerDuration(seconds: number): TimerState {
  return createTimerState(seconds);
}

export function adjustTimerRemaining(state: TimerState, deltaSeconds: number): TimerState {
  return { ...state, isActive: true, remainingSeconds: Math.max(0, state.remainingSeconds + deltaSeconds) };
}

/** One second of countdown. A no-op when not running, so it's safe to call unconditionally on every interval tick. */
export function tickTimer(state: TimerState): TimerState {
  if (!state.isRunning) return state;
  if (state.remainingSeconds <= 1) return { ...state, isRunning: false, remainingSeconds: 0 };
  return { ...state, remainingSeconds: state.remainingSeconds - 1 };
}

export function isTimerFinished(state: TimerState): boolean {
  return state.isActive && state.remainingSeconds === 0;
}
