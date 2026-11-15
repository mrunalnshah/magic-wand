// The notices at the top of the page. Each one dismisses itself after a few
// seconds, and a thin bar shows how long is left. Holding the pointer over a
// notice pauses the countdown; it goes on from where it was when the pointer
// leaves. A notice that is renewed (the same message again) starts over.

import { useEffect, useRef, useState } from "preact/hooks";

import { html } from "./html.js";

export const DISMISS_MS = 6000;

function Notice({ item, notices, duration }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(duration); // milliseconds left
  const started = useRef(0);

  useEffect(() => {
    left.current = duration; // renewed: start over
  }, [item.renewals, duration]);

  useEffect(() => {
    if (paused) return undefined;
    started.current = Date.now();
    const timer = setTimeout(() => notices.dismiss(item.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started.current;
    };
  }, [paused, item.renewals, duration]);

  return html`<div
    class="notice"
    onMouseEnter=${() => setPaused(true)}
    onMouseLeave=${() => setPaused(false)}
  >
    <span>${item.message}</span>
    <span class="code">${item.code}</span>
    <button aria-label="Dismiss" onClick=${() => notices.dismiss(item.id)}>
      ×
    </button>
    <div
      class="notice-bar"
      key=${item.renewals}
      style=${{
        animationDuration: `${duration}ms`,
        animationPlayState: paused ? "paused" : "running",
      }}
    ></div>
  </div>`;
}

export function Notices({ items, notices, duration = DISMISS_MS }) {
  return html`<div class="notices" role="alert">
    ${items.map(
      (item) =>
        html`<${Notice}
          key=${item.id}
          item=${item}
          notices=${notices}
          duration=${duration}
        />`,
    )}
  </div>`;
}
