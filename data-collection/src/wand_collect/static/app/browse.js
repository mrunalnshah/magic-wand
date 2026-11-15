// The Browse page: every sample in the dataset, with filters, per-label
// progress and a workspace in which a sample can be relabeled, rejected,
// restored or deleted, in any session. The samples are a grid of thumbnails in
// a pane of their own, and the selected sample stays beside it (or above it,
// in a narrow window). It has the keys of the Review page. The grid repeats
// its query when the samples revision changes, and it works while no session
// is loaded.

import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "./api.js";
import { html } from "./html.js";
import { TARGET_PER_LABEL } from "./labels.js";
import { Scrub } from "./scrub.js";
import {
  SampleDetail,
  SampleGrid,
  columnsOf,
  useSampleDetails,
} from "./sampleview.js";

const PAGE_SIZE = 100; // the grid scrolls, so a page can be long
const NO_FILTERS = {
  label: "",
  session: "",
  author: "",
  from: "",
  to: "",
  status: "",
};

// The query string of a set of filters and a page.
export function queryFor(filters, page) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value) params.set(name, value);
  }
  params.set("order", "newest");
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));
  return params.toString();
}

function Progress({ snapshot }) {
  return html`<section class="panel" aria-label="Accepted samples per label">
    <ul class="progress">
      ${snapshot.labels.map((label) => {
        const count = snapshot.counts[label.id] || 0;
        const share = Math.min(100, (100 * count) / TARGET_PER_LABEL);
        return html`<li key=${label.id}>
          <span class="name">${label.name}</span>
          <span
            class="bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax=${TARGET_PER_LABEL}
            aria-valuenow=${count}
          >
            <span style=${`width: ${share}%`}></span>
          </span>
          <span class="number">${count} / ${TARGET_PER_LABEL}</span>
        </li>`;
      })}
    </ul>
  </section>`;
}

function Filters({ snapshot, filters, sessions, onChange }) {
  const authors = [...new Set(sessions.map((entry) => entry.author))].sort();
  const set = (name) => (event) => onChange({ [name]: event.target.value });
  return html`<section class="panel filters">
    <label>
      Label
      <select aria-label="Filter by label" onChange=${set("label")}
        value=${filters.label}>
        <option value="">all</option>
        ${snapshot.labels.map(
          (label) =>
            html`<option key=${label.id} value=${label.id}>
              ${label.name}
            </option>`,
        )}
      </select>
    </label>
    <label>
      Session
      <select aria-label="Filter by session" onChange=${set("session")}
        value=${filters.session}>
        <option value="">all</option>
        ${sessions.map(
          (entry) =>
            html`<option key=${entry.id} value=${entry.id}>
              ${entry.name || "(unnamed)"} - ${entry.author}
            </option>`,
        )}
      </select>
    </label>
    <label>
      Author
      <select aria-label="Filter by author" onChange=${set("author")}
        value=${filters.author}>
        <option value="">all</option>
        ${authors.map(
          (author) => html`<option key=${author} value=${author}>
            ${author}
          </option>`,
        )}
      </select>
    </label>
    <label>
      Status
      <select aria-label="Filter by status" onChange=${set("status")}
        value=${filters.status}>
        <option value="">all</option>
        <option value="accepted">accepted</option>
        <option value="rejected">rejected</option>
      </select>
    </label>
    <label>
      From
      <input type="date" aria-label="From date" value=${filters.from}
        onChange=${set("from")} />
    </label>
    <label>
      To
      <input type="date" aria-label="To date" value=${filters.to}
        onChange=${set("to")} />
    </label>
    <button onClick=${() => onChange(NO_FILTERS)}>Clear filters</button>
  </section>`;
}

// Which sample to select after the list changed: the one selected, else the
// one now at its position, else the first (or, after a move to the previous
// page, the last).
export function chooseSelection(items, selectedId, previousIndex, edge) {
  if (items.length === 0) return null;
  if (edge === "last") return items[items.length - 1].id;
  if (edge === "first") return items[0].id;
  if (selectedId && items.some((item) => item.id === selectedId)) {
    return selectedId;
  }
  if (selectedId && previousIndex >= 0) {
    return items[Math.min(previousIndex, items.length - 1)].id;
  }
  return items[0].id;
}

export function Browse({ snapshot, notices, shortcuts }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [scrubbing, setScrubbing] = useState(false);
  const gridRef = useRef(null);
  const paneRef = useRef(null);
  const resultRef = useRef(result);
  resultRef.current = result;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const pageRef = useRef(page);
  pageRef.current = page;
  const edgeRef = useRef(null); // "first" or "last" after a move across pages

  const change = (changes) => {
    setFilters((current) => ({ ...current, ...changes }));
    setPage(1);
  };

  useEffect(() => {
    notices.attempt(() => api.get("/api/sessions")).then((list) => {
      if (list) setSessions(list);
    });
  }, [snapshot.samplesRevision]);

  useEffect(() => {
    let current = true;
    notices
      .attempt(() => api.get(`/api/samples?${queryFor(filters, page)}`))
      .then((found) => {
        if (!current || !found) return;
        const previous = resultRef.current.items.findIndex(
          (item) => item.id === selectedRef.current,
        );
        setResult(found);
        setSelected(
          chooseSelection(
            found.items,
            selectedRef.current,
            previous,
            edgeRef.current,
          ),
        );
        edgeRef.current = null;
      });
    return () => {
      current = false;
    };
  }, [filters, page, snapshot.samplesRevision]);

  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const summary = result.items.find((item) => item.id === selected) || null;
  const details = useSampleDetails(
    summary ? summary.id : null,
    snapshot.samplesRevision,
    notices,
  );

  // Moves the selection by `delta` samples (a row is a few samples); past the
  // end of a page it goes on to the next or the previous page.
  const move = (delta) => {
    const items = resultRef.current.items;
    if (items.length === 0) return;
    const at = items.findIndex((item) => item.id === selectedRef.current);
    const target = (at < 0 ? 0 : at) + delta;
    if (target < 0 && pageRef.current > 1) {
      edgeRef.current = "last";
      setPage(pageRef.current - 1);
    } else if (target >= items.length && pageRef.current < pagesRef.current) {
      edgeRef.current = "first";
      setPage(pageRef.current + 1);
    } else {
      // The ref is updated at once, so keys that repeat faster than the page
      // draws each move from where the last one went.
      const id = items[Math.max(0, Math.min(items.length - 1, target))].id;
      selectedRef.current = id;
      setSelected(id);
    }
  };
  useEffect(() => shortcuts.on("previous", () => move(-1)), [shortcuts]);
  useEffect(() => shortcuts.on("next", () => move(1)), [shortcuts]);
  useEffect(
    () => shortcuts.on("up", () => move(-columnsOf(gridRef.current))),
    [shortcuts],
  );
  useEffect(
    () => shortcuts.on("down", () => move(columnsOf(gridRef.current))),
    [shortcuts],
  );

  // Keep the selected tile in view inside the grid pane.
  useEffect(() => {
    const list = gridRef.current;
    const tile = list && list.querySelector('[aria-current="true"]');
    if (tile && tile.scrollIntoView) tile.scrollIntoView({ block: "nearest" });
  }, [selected, result]);

  if (scrubbing && details) {
    return html`<section class="browse">
      <${Scrub}
        id=${summary.id}
        details=${details}
        onClose=${() => setScrubbing(false)}
        shortcuts=${shortcuts}
      />
    </section>`;
  }
  return html`<section class="browse">
    <div class="browse-top">
      <${Progress} snapshot=${snapshot} />
      <${Filters}
        snapshot=${snapshot}
        filters=${filters}
        sessions=${sessions}
        onChange=${change}
      />
    </div>
    <div class="workspace">
      <div class="grid-pane" ref=${paneRef}>
        <p class="hint">${result.total} samples match.</p>
        <${SampleGrid}
          items=${result.items}
          selectedId=${selected}
          snapshot=${snapshot}
          onSelect=${setSelected}
          listRef=${gridRef}
        />
        <div class="row pager">
          <button disabled=${page <= 1} onClick=${() => setPage(page - 1)}>
            Previous page
          </button>
          <span>Page ${page} of ${pages}</span>
          <button disabled=${page >= pages} onClick=${() => setPage(page + 1)}>
            Next page
          </button>
        </div>
      </div>
      ${summary
        ? html`<${SampleDetail}
            snapshot=${snapshot}
            summary=${summary}
            details=${details}
            notices=${notices}
            shortcuts=${shortcuts}
            onScrub=${() => setScrubbing(true)}
          />`
        : html`<aside class="detail-pane empty">
            <p class="hint">No sample to show.</p>
          </aside>`}
    </div>
  </section>`;
}
