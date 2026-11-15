// The Calibrate page: color calibration, manual adjustment, motion tuning,
// the guided measurement and profiles, for the current camera. Every value
// comes from the state, and every control is disabled while a session is
// loaded for capture.

import { api } from "../api.js";
import { html } from "../html.js";
import { CameraPanel } from "../setup.js";
import { useSelector } from "../state.js";
import { ColorCalibration } from "./color.js";
import { MotionTuning } from "./motion.js";
import { Profiles } from "./profiles.js";
import { VisionSliders } from "./vision.js";

export function isLocked(snapshot) {
  return Boolean(snapshot.session) && snapshot.session.role === "capture";
}

// Starts the session from the details given on Setup. The settings are fixed
// from then on, so this comes last.
function StartSession({ snapshot, store, notices, goTo }) {
  const draft = useSelector(store, (all) => all.draft);
  const locked = isLocked(snapshot);
  const start = async () => {
    const started = await notices.attempt(() =>
      api.post("/api/sessions", draft),
    );
    if (started) goTo("record");
  };
  const end = () =>
    notices.attempt(() => api.post("/api/sessions/current/end"));
  if (locked) {
    const name = snapshot.session.name;
    const text = `${name} is capturing, so settings are locked.`;
    return html`<section class="panel start">
      <h3>Session</h3>
      <p>${text}</p>
      <button onClick=${end}>End session to calibrate</button>
    </section>`;
  }
  return html`<section class="panel start">
    <h3>Start the session</h3>
    ${draft
      ? html`<p>
          ${[draft.name, draft.author, `${draft.handedness}-handed`]
            .filter(Boolean)
            .join(", ")}.
          <button onClick=${() => goTo("setup")}>Change</button>
        </p>`
      : html`<p class="hint">
          Enter the author and handedness on the Setup page first.
          <button onClick=${() => goTo("setup")}>Go to Setup</button>
        </p>`}
    <p class="hint">
      Settings are locked once the session starts. Calibrate first.
    </p>
    <button disabled=${!draft || !snapshot.camera.device} onClick=${start}>
      Start session
    </button>
    ${draft &&
    !snapshot.camera.device &&
    html`<p class="hint">No camera is in use.</p>`}
  </section>`;
}

// After a resume: check that the camera is the one the session used, with the
// settings locked to what it was recorded with. Only the camera can change.
// Continuing records the camera in use as the session's camera.
function CameraCheck({ snapshot, notices, goTo }) {
  const session = snapshot.session;
  const confirm = async () => {
    const done = await notices.attempt(() =>
      api.post("/api/sessions/current/camera/confirm"),
    );
    if (done !== undefined) goTo("record");
  };
  const end = () =>
    notices.attempt(() => api.post("/api/sessions/current/end"));
  return html`<section class="panel start">
      <h3>Check the camera</h3>
      <p>
        ${session.name} was resumed. It was recorded with
        ${session.recordedCamera || "an unknown camera"}. The settings are
        locked to what the session was recorded with, so only the camera can
        change. In the live view, switch to the mask and check that the wand
        is tracked. If the camera is not the one you used before, choose it
        below.
      </p>
      <p class="hint">
        If you continue with a different camera, the session record takes it
        from then on.
      </p>
      <div class="row">
        <button disabled=${!snapshot.camera.device} onClick=${confirm}>
          Continue to Record
        </button>
        <button onClick=${end}>End session</button>
      </div>
    </section>
    <${CameraPanel}
      snapshot=${snapshot}
      notices=${notices}
      preview=${false}
    />`;
}

export function Calibrate({ snapshot, store, notices, goTo }) {
  const locked = isLocked(snapshot);
  const checking = locked && Boolean(snapshot.session.cameraCheck);
  const { vision, motion, profile } = snapshot.settings;
  return html`<section class="calibrate">
    <h2>Calibrate</h2>
    ${locked &&
    html`<p class="locked" role="status">
      ${checking
        ? "Settings are locked to what the session was recorded with."
        : "Settings are locked while a session is capturing. " +
          "End the session to calibrate."}
    </p>`}
    ${checking
      ? html`<${CameraCheck}
          snapshot=${snapshot}
          notices=${notices}
          goTo=${goTo}
        />`
      : html`<${StartSession}
          snapshot=${snapshot}
          store=${store}
          notices=${notices}
          goTo=${goTo}
        />`}
    <div class="columns">
      <div>
        <${ColorCalibration}
          store=${store}
          notices=${notices}
          locked=${locked}
        />
        <${Profiles}
          loaded=${profile}
          vision=${vision}
          motion=${motion}
          notices=${notices}
          locked=${locked}
        />
      </div>
      <div>
        <${MotionTuning}
          store=${store}
          motion=${motion}
          notices=${notices}
          locked=${locked}
        />
        <${VisionSliders}
          vision=${vision}
          notices=${notices}
          locked=${locked}
        />
      </div>
    </div>
  </section>`;
}
