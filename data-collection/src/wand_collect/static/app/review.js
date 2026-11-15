// The Review page: look through the samples of the loaded session and
// reject, restore, delete or relabel them. Every action is sent at once and
// the page repeats its query when the samples revision changes. The selected
// sample is local to the page.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { ApiError, api } from "./api.js";
import { HoldButton } from "./hold.js";
import { html } from "./html.js";
import {
  LabelSelect,
  labelName,
  pathImage,
  useLabelKeys,
} from "./labels.js";
import { Scrub } from "./scrub.js";

const PAGE_SIZE = 500; // the largest page the server gives

// All the samples of a session in capture order (it takes more than one
// request only for a very long session).
export async function fetchSession(sessionId) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const query = `session=${encodeURIComponent(sessionId)}`;
    const result = await api.get(
      `/api/samples?${query}&order=capture&page=${page}&pageSize=${PAGE_SIZE}`,
    );
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
  }
  return items;
}

// Which sample to show after the list changed: the one that was selected,
// else the one now at its position, else the latest.
export function nextSelection(items, selectedId, previousIndex) {
  if (items.length === 0) return null;
  if (selectedId && items.some((item) => item.id === selectedId)) {
    return selectedId;
  }
  if (selectedId && previousIndex >= 0) {
    return items[Math.min(previousIndex, items.length - 1)].id;
  }
  return items[items.length - 1].id;
}

// How many tiles are in one row of the grid: those that share the first
// tile's top edge. One when the layout is not known.
export function columnsOf(list) {
  const tiles = list ? Array.from(list.children) : [];
  if (tiles.length === 0) return 1;
  const top = tiles[0].offsetTop;
  const count = tiles.filter((tile) => tile.offsetTop === top).length;
  return Math.max(1, count);
}

function Button({ shortcuts, action, label, ...rest }) {
  const key = action ? shortcuts.keyFor(action) : "";
  return html`<button ...${rest}>
    ${label}${key && html` <kbd>${key}</kbd>`}
  </button>`;
}

function Strip({ items, selected, onSelect, listRef }) {
  return html`<ol class="strip" ref=${listRef}>
    ${items.map(
      (item, index) => html`<li key=${item.id}>
        <button
          class=${"thumb" + (item.status === "rejected" ? " rejected" : "")}
          aria-current=${item.id === selected ? "true" : undefined}
          aria-label=${`Sample ${index + 1}, ${item.status}`}
          onClick=${() => onSelect(item.id)}
        >
          <img
            loading="lazy"
            src=${`/api/samples/${encodeURIComponent(item.id)}/thumbnail`}
            alt=""
          />
          <span>${index + 1}</span>
        </button>
      </li>`,
    )}
  </ol>`;
}

function formatDate(text) {
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

export function Review({ snapshot, shortcuts, notices }) {
  const session = snapshot.session;
  const capturing = Boolean(session) && session.role === "capture";
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [overlay, setOverlay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const stripRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const sessionId = session ? session.id : null;
  const load = useCallback(async () => {
    if (!sessionId) {
      setItems([]);
      setSelected(null);
      return;
    }
    const list = await notices.attempt(() => fetchSession(sessionId));
    if (!list) return;
    const previous = itemsRef.current.findIndex(
      (item) => item.id === selectedRef.current,
    );
    setItems(list);
    setSelected(nextSelection(list, selectedRef.current, previous));
  }, [sessionId, notices]);

  useEffect(() => {
    load();
  }, [load, snapshot.samplesRevision]);

  // The selected sample's details (whether it has a clip). A sample that is
  // gone (deleted here, in another tab or by a command) answers 404: that is
  // not an error to show, because the list is reloaded at the same time and
  // moves the selection on.
  useEffect(() => {
    setDetails(null);
    if (!selected) return undefined;
    let current = true;
    api
      .get(`/api/samples/${encodeURIComponent(selected)}`)
      .then((found) => current && found && setDetails(found))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) return;
        notices.add(error.message || String(error), error.code);
      });
    return () => {
      current = false;
    };
  }, [selected, snapshot.samplesRevision]);

  const hasClip = Boolean(details && details.hasClip);
  const showOverlay = overlay && hasClip;
  const index = items.findIndex((item) => item.id === selected);
  const current = index >= 0 ? items[index] : null;

  const step = useCallback(
    (delta) => {
      const list = itemsRef.current;
      if (list.length === 0) return;
      const at = list.findIndex((item) => item.id === selectedRef.current);
      const next = Math.max(0, Math.min(list.length - 1, at + delta));
      setSelected(list[next].id);
    },
    [],
  );

  // Keep the selected tile in view when the selection moves.
  useEffect(() => {
    const list = stripRef.current;
    if (!list || !selected) return;
    const tile = list.querySelector('[aria-current="true"]');
    if (tile && tile.scrollIntoView) tile.scrollIntoView({ block: "nearest" });
  }, [selected, items]);

  const act = async (action) => {
    setBusy(true);
    try {
      await notices.attempt(action);
    } finally {
      setBusy(false);
    }
  };
  const url = selected ? `/api/samples/${encodeURIComponent(selected)}` : "";
  const toggleReject = () => {
    if (!current) return;
    const status = current.status === "accepted" ? "rejected" : "accepted";
    return act(() => api.patch(url, { status }));
  };
  const relabel = useCallback(
    (label) => {
      if (!selectedRef.current) return;
      const target = `/api/samples/${encodeURIComponent(selectedRef.current)}`;
      return act(() => api.patch(target, { label }));
    },
    [notices],
  );
  const remove = () => {
    if (!current) return;
    if (!window.confirm("Delete this sample and its clip for good?")) return;
    return act(() => api.delete(url));
  };
  const chooseActive = (label) =>
    notices.attempt(() => api.put("/api/recording/label", { label }));
  const resume = () => {
    const path = capturing
      ? "/api/recording/resume"
      : "/api/sessions/current/end";
    return notices.attempt(() => api.post(path));
  };

  useEffect(() => shortcuts.on("previous", () => step(-1)), [shortcuts, step]);
  useEffect(() => shortcuts.on("next", () => step(1)), [shortcuts, step]);
  useEffect(
    () => shortcuts.on("up", () => step(-columnsOf(stripRef.current))),
    [shortcuts, step],
  );
  useEffect(
    () => shortcuts.on("down", () => step(columnsOf(stripRef.current))),
    [shortcuts, step],
  );
  useEffect(() => shortcuts.on("reject", toggleReject));
  useEffect(() => shortcuts.on("delete", remove));
  useEffect(() => shortcuts.on("toggleView", () => setOverlay((v) => !v)), []);
  useEffect(() => {
    // Escape resumes capturing; it never closes a review by accident.
    if (capturing) return shortcuts.on("pause", resume);
    return undefined;
  });
  useLabelKeys(shortcuts, snapshot, relabel);

  if (scrubbing && details) {
    return html`<${Scrub}
      id=${selected}
      details=${details}
      onClose=${() => setScrubbing(false)}
      shortcuts=${shortcuts}
    />`;
  }
  const latest = snapshot.latestSample;
  const waiting = Boolean(latest) && latest.saving;
  return html`<section class="review">
    <h2>Review</h2>
    ${!session &&
    html`<p class="hint">No session is loaded. Open one on the Setup page.</p>`}
    ${waiting &&
    html`<p class="locked" role="status">
      The last gesture is still saving; it appears here when it is saved.
    </p>`}
    <div class="row">
      <${Button}
        shortcuts=${shortcuts}
        action=${capturing ? "pause" : ""}
        label=${capturing ? "Resume capturing" : "Close review"}
        onClick=${resume}
        disabled=${!session}
      />
      ${capturing && html`<${HoldButton} notices=${notices} />`}
      <span class="hint">${items.length} samples</span>
    </div>
    ${items.length === 0 &&
    session &&
    html`<p class="hint">This session has no samples yet.</p>`}
    ${current &&
    html`<div class="columns">
      <div>
        <div class="panel">
          <img
            class="sample-image"
            key=${selected + (showOverlay ? "o" : "p")}
            src=${pathImage(selected, showOverlay ? "overlay" : "path")}
            alt="Path of the selected gesture"
          />
          <div class="row">
            <button
              aria-pressed=${!showOverlay}
              onClick=${() => setOverlay(false)}
            >
              Path only
            </button>
            <button
              aria-pressed=${showOverlay}
              disabled=${!hasClip}
              onClick=${() => setOverlay(true)}
            >
              Overlay on camera frame
            </button>
            <kbd>${shortcuts.keyFor("toggleView")}</kbd>
            <button disabled=${!details} onClick=${() => setScrubbing(true)}>
              ${hasClip ? "Scrub video" : "Scrub path"}
            </button>
          </div>
          ${!hasClip &&
          html`<p class="hint">
            There is no video clip for this sample, so the camera frame is
            not available.
          </p>`}
        </div>
      </div>
      <div>
        <div class="panel">
          <h3>Sample ${index + 1} of ${items.length}</h3>
          <dl class="facts">
            <dt>Label</dt>
            <dd>${labelName(snapshot, current.label)}</dd>
            <dt>Status</dt>
            <dd class=${current.status}>${current.status}</dd>
            <dt>Captured</dt>
            <dd>${formatDate(current.capturedAt)}</dd>
            <dt>Clip</dt>
            <dd>${hasClip ? "yes" : "no"}</dd>
          </dl>
          <div class="row">
            <${Button}
              shortcuts=${shortcuts}
              action="previous"
              label="Previous"
              disabled=${index <= 0}
              onClick=${() => step(-1)}
            />
            <${Button}
              shortcuts=${shortcuts}
              action="next"
              label="Next"
              disabled=${index >= items.length - 1}
              onClick=${() => step(1)}
            />
          </div>
          <div class="row">
            <${Button}
              shortcuts=${shortcuts}
              action="reject"
              label=${current.status === "accepted" ? "Reject" : "Restore"}
              disabled=${busy}
              onClick=${toggleReject}
            />
            <${Button}
              shortcuts=${shortcuts}
              action="delete"
              label="Delete"
              disabled=${busy}
              onClick=${remove}
            />
          </div>
          <div class="row">
            <label>
              Relabel (1 to 9)
              <${LabelSelect}
                snapshot=${snapshot}
                value=${current.label}
                disabled=${busy}
                onChoose=${relabel}
              />
            </label>
          </div>
        </div>
        <div class="panel">
          <h3>Next captures</h3>
          <div class="row">
            <label>
              Active label
              <${LabelSelect}
                snapshot=${snapshot}
                value=${snapshot.activeLabel}
                onChoose=${chooseActive}
              />
            </label>
          </div>
        </div>
      </div>
    </div>`}
    <${Strip}
      items=${items}
      selected=${selected}
      onSelect=${setSelected}
      listRef=${stripRef}
    />
  </section>`;
}
