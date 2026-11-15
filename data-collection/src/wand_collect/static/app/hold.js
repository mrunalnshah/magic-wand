// The button that puts the loaded session on hold: capturing stops and the
// session is unloaded, but it stays open, so it can be resumed later and
// another session can be started or loaded meanwhile. Ending a session is
// final; this is not.

import { api } from "./api.js";
import { html } from "./html.js";

export function HoldButton({ notices }) {
  const hold = () =>
    notices.attempt(() => api.post("/api/sessions/current/hold"));
  return html`<button
    title="Stop capturing and keep the session open, to resume it later"
    onClick=${hold}
  >
    Put on hold (resume later)
  </button>`;
}
