// Saved calibrations. A profile holds a full set of vision and motion
// settings for one camera, room and lighting.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.js";
import { html } from "../html.js";

// Whether two settings objects hold the same values (key order ignored).
export function sameSettings(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => sameSettings(a[key], b[key]));
}

const SAVED_SHOWN_MS = 3000;

export function Profiles({ loaded, vision, motion, notices, locked }) {
  const [names, setNames] = useState([]);
  const [name, setName] = useState("");
  const [stored, setStored] = useState(null); // the loaded profile's settings
  const [version, setVersion] = useState(0); // bumped when a profile changes
  const [saved, setSaved] = useState("");

  const refresh = async () => {
    const list = await notices.attempt(() => api.get("/api/profiles"));
    if (list) setNames(list.map((entry) => entry.name));
  };
  useEffect(() => {
    refresh();
  }, []);

  // The loaded profile as stored, to tell whether the settings have moved
  // away from it.
  useEffect(() => {
    if (!loaded) {
      setStored(null);
      return undefined;
    }
    let current = true;
    api
      .get(`/api/profiles/${encodeURIComponent(loaded)}`)
      .then((found) => current && setStored(found))
      .catch(() => current && setStored(null));
    return () => {
      current = false;
    };
  }, [loaded, version]);

  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(() => setSaved(""), SAVED_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const unchanged =
    stored &&
    sameSettings(stored.vision, vision) &&
    sameSettings(stored.motion, motion);
  const changed = Boolean(loaded && stored) && !unchanged;

  // Runs a change to the profiles; resolves true if it was accepted.
  const run = async (action) => {
    const result = await notices.attempt(action);
    await refresh();
    setVersion((v) => v + 1);
    return result !== undefined;
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await run(() => api.put(`/api/profiles/${encodeURIComponent(trimmed)}`));
    setName("");
  };

  const saveLoaded = async () => {
    const ok = await run(() =>
      api.put(`/api/profiles/${encodeURIComponent(loaded)}`),
    );
    if (ok) setSaved(`Saved to ${loaded}.`);
  };

  return html`<section class="panel">
    <h3>Profiles</h3>
    <div class="row">
      <input
        type="text"
        placeholder="Profile name"
        value=${name}
        disabled=${locked}
        onInput=${(event) => setName(event.target.value)}
      />
      <button disabled=${locked || !name.trim()} onClick=${save}>
        Save current settings
      </button>
    </div>
    ${loaded &&
    html`<div class="row">
      <button disabled=${locked} onClick=${saveLoaded}>
        Save to ${loaded}
      </button>
      ${changed && html`<span class="hint">changed since loaded</span>`}
      ${saved && html`<span role="status">${saved}</span>`}
    </div>`}
    ${names.length === 0 && html`<p class="hint">No saved profiles.</p>`}
    <ul class="profiles">
      ${names.map(
        (entry) => html`<li key=${entry}>
          <span>${entry}${entry === loaded ? " (loaded)" : ""}</span>
          <button
            disabled=${locked}
            onClick=${() =>
              run(() =>
                api.post(`/api/profiles/${encodeURIComponent(entry)}/load`),
              )}
          >
            Load
          </button>
          <button
            disabled=${locked}
            onClick=${() =>
              run(() =>
                api.delete(`/api/profiles/${encodeURIComponent(entry)}`),
              )}
          >
            Delete
          </button>
        </li>`,
      )}
    </ul>
  </section>`;
}
