// The pieces of the sample workspace: a grid of thumbnails on one side and
// the selected sample on the other. The Browse page uses them, and the Review
// page will. The grid scrolls in its own pane; the panel with the picture,
// the details and the action buttons stays where it is.

import { useEffect, useState } from "preact/hooks";

import { ApiError, api } from "./api.js";
import { html } from "./html.js";
import {
  LabelSelect,
  labelName,
  pathImage,
  useLabelKeys,
} from "./labels.js";

// The symbol that marks a thumbnail as accepted or rejected (the colour
// says the same, and the tile's label gives the status in words).
export function statusMark(status) {
  return status === "rejected" ? "✕" : "✓";
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

export function thumbnail(id) {
  return `/api/samples/${encodeURIComponent(id)}/thumbnail`;
}

export function formatDate(text) {
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

// The full record of a sample (positions, whether it has a clip). A sample
// that is gone (deleted here, in another tab or by a command) answers 404:
// that is not an error to show, because the list is reloaded at the same time
// and moves the selection on.
export function useSampleDetails(id, revision, notices) {
  const [details, setDetails] = useState(null);
  useEffect(() => {
    setDetails(null);
    if (!id) return undefined;
    let current = true;
    api
      .get(`/api/samples/${encodeURIComponent(id)}`)
      .then((found) => current && found && setDetails(found))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) return;
        notices.add(error.message || String(error), error.code);
      });
    return () => {
      current = false;
    };
  }, [id, revision]);
  return details;
}

// The thumbnails. Each tile shows the status as a border and a marker, and
// the label's name underneath.
export function SampleGrid({ items, selectedId, snapshot, onSelect, listRef }) {
  return html`<ol class="tiles" ref=${listRef}>
    ${items.map(
      (item, index) => html`<li key=${item.id}>
        <button
          class=${"tile " + item.status}
          aria-current=${item.id === selectedId ? "true" : undefined}
          aria-label=${`Sample ${index + 1}, ${labelName(
            snapshot,
            item.label,
          )}, ${item.status}`}
          onClick=${() => onSelect(item.id)}
        >
          <span class="thumbbox">
            <img loading="lazy" src=${thumbnail(item.id)} alt="" />
            <span class="mark" aria-hidden="true">
              ${statusMark(item.status)}
            </span>
          </span>
          <span class="caption">${labelName(snapshot, item.label)}</span>
        </button>
      </li>`,
    )}
  </ol>`;
}

function KeyButton({ shortcuts, action, label, ...rest }) {
  const key = action ? shortcuts.keyFor(action) : "";
  return html`<button ...${rest}>
    ${label}${key && html` <kbd>${key}</kbd>`}
  </button>`;
}

// The selected sample: the picture, the buttons that change what it shows,
// the facts, and (pinned at the bottom) the actions. It owns the keys that
// act on the selected sample (reject, delete, the overlay, the label digits).
export function SampleDetail({
  snapshot,
  summary,
  details,
  notices,
  shortcuts,
  onScrub,
  onDeleted,
}) {
  const [overlay, setOverlay] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = summary.id;
  const url = `/api/samples/${encodeURIComponent(id)}`;
  const hasClip = Boolean(details && details.hasClip);
  const noClip = Boolean(details) && !details.hasClip;
  const showOverlay = overlay && hasClip;

  const act = async (action) => {
    setBusy(true);
    try {
      return await notices.attempt(action);
    } finally {
      setBusy(false);
    }
  };
  const toggle = () =>
    act(() =>
      api.patch(url, {
        status: summary.status === "accepted" ? "rejected" : "accepted",
      }),
    );
  const relabel = (label) => act(() => api.patch(url, { label }));
  const remove = async () => {
    if (!window.confirm("Delete this sample and its clip for good?")) return;
    const done = await act(() => api.delete(url));
    if (done !== undefined && onDeleted) onDeleted(id);
  };

  // The keys use the latest functions, so they act on the sample selected now.
  useEffect(() => shortcuts.on("reject", toggle));
  useEffect(() => shortcuts.on("delete", remove));
  useEffect(() => shortcuts.on("toggleView", () => setOverlay((v) => !v)), []);
  useLabelKeys(shortcuts, snapshot, relabel);

  return html`<aside class="detail-pane">
    <div class="detail-scroll">
      <img
        class="sample-image"
        key=${id + (showOverlay ? "o" : "p")}
        src=${pathImage(id, showOverlay ? "overlay" : "path")}
        alt="Path of the selected gesture"
      />
      <div class="row video-buttons">
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
          ${noClip ? "Video unavailable" : "Overlay on camera frame"}
        </button>
        <kbd>${shortcuts.keyFor("toggleView")}</kbd>
        <button disabled=${!details} onClick=${onScrub}>
          ${hasClip ? "Scrub video" : "Scrub path"}
        </button>
      </div>
      <dl class="facts">
        <dt>Label</dt>
        <dd>${labelName(snapshot, summary.label)}</dd>
        <dt>Status</dt>
        <dd class=${summary.status}>${summary.status}</dd>
        <dt>Session</dt>
        <dd>${summary.sessionName || "(unnamed)"} by ${summary.author}</dd>
        <dt>Captured</dt>
        <dd>${formatDate(summary.capturedAt)}</dd>
        ${details &&
        html`<dt>Points</dt>
          <dd>${details.positions.horizontal.length}</dd>
          <dt>Hand</dt>
          <dd>${details.handedness}</dd>
          <dt>Clip</dt>
          <dd>${hasClip ? "yes" : "no"}</dd>`}
      </dl>
    </div>
    <div class="detail-actions row">
      <label>
        Relabel
        <${LabelSelect}
          snapshot=${snapshot}
          value=${summary.label}
          disabled=${busy}
          onChoose=${relabel}
        />
      </label>
      <${KeyButton}
        shortcuts=${shortcuts}
        action="reject"
        label=${summary.status === "accepted" ? "Reject" : "Restore"}
        disabled=${busy}
        onClick=${toggle}
      />
      <${KeyButton}
        shortcuts=${shortcuts}
        action="delete"
        label="Delete"
        disabled=${busy}
        onClick=${remove}
      />
    </div>
  </aside>`;
}
