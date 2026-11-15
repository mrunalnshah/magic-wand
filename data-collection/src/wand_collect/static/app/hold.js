// The Pause button, which puts the loaded session on hold: capturing stops and
// the session is unloaded, but it stays open, so it can be resumed later and
// another session can be started or loaded meanwhile. Ending a session is
// final; this is not. (It is not the same as pausing a capture, which keeps
// the session loaded and opens Review.)

import { api } from "./api.js";
import { html } from "./html.js";

export function HoldButton({ notices }) {
  const hold = () =>
    notices.attempt(() => api.post("/api/sessions/current/hold"));
  const hint =
    "Stop capturing and set this session aside, still open, to resume it later";
  return html`<button title=${hint} onClick=${hold}>
    Pause
  </button>`;
}
