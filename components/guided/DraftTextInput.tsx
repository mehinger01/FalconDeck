"use client";

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type Ref } from "react";

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "onBlur" | "id">;

interface DraftTextInputProps extends BaseProps {
  value: string;
  onCommit: (value: string) => void;
  /** Called with true while typed text has not been handed to the draft yet, false once it has. */
  onPendingChange?: (pending: boolean) => void;
  id?: string;
  /** Milliseconds of no typing before the text is committed anyway. */
  delay?: number;
  ref?: Ref<HTMLInputElement>;
}

/**
 * A text field that commits to the draft on blur, on Enter, or after a
 * short pause - not on every keystroke, since every commit is a save.
 * Uncommitted text is reported through onPendingChange so the page can
 * show "Unsaved changes" and warn before leaving.
 */
export function DraftTextInput({ value, onCommit, onPendingChange, delay = 700, id, ref, ...inputProps }: DraftTextInputProps) {
  const generatedId = useId();
  const [local, setLocal] = useState(value);
  // Follow a value replaced from outside (e.g. a saved version chosen in a conflict).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setLocal(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ local, value, onCommit, onPendingChange });
  useEffect(() => {
    latest.current = { local, value, onCommit, onPendingChange };
  });

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { local: text, value: current, onCommit: save, onPendingChange: pending } = latest.current;
    pending?.(false);
    if (text !== current) save(text);
  };

  // Commit anything still typed if the field goes away.
  useEffect(() => () => {
    if (timer.current) commit();
  }, []);

  return (
    <input
      {...inputProps}
      ref={ref}
      id={id ?? generatedId}
      value={local}
      onChange={(event) => {
        setLocal(event.target.value);
        latest.current.onPendingChange?.(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(commit, delay);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        inputProps.onKeyDown?.(event);
      }}
    />
  );
}
