"use client";

import { useState } from "react";

/** The Clean Screen tool's tray controls: an editable message, pre-filled from the configured default. */
export function CleanScreenPanel({
  defaultMessage,
  onStart,
}: {
  defaultMessage: string;
  onStart: (message: string) => void;
}) {
  const [message, setMessage] = useState(defaultMessage);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onStart(message.trim() || defaultMessage);
      }}
      className="flex flex-col gap-2"
    >
      <input
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={defaultMessage}
        className="rounded border border-falcon-cream-200/20 bg-falcon-brown-900 px-2 py-1.5 text-sm text-falcon-cream-100"
      />
      <button
        type="submit"
        className="rounded-md bg-falcon-gold-400 px-3 py-1.5 text-sm font-bold text-falcon-brown-950 hover:bg-falcon-gold-300"
      >
        Start Clean Screen
      </button>
    </form>
  );
}
