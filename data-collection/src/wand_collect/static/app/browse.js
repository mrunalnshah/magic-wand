// The Browse page: every sample in the dataset, with filters, per-label
// progress and the sample workspace (a grid of thumbnails that loads more as
// it is scrolled, and the selected sample beside it), in which a sample can be
// relabeled, rejected, restored or deleted, in any session. It has the keys of
// the Review page, and it works while no session is loaded.

import { useEffect, useState } from "preact/hooks";

import { api } from "./api.js";
import { html } from "./html.js";
import { TARGET_PER_LABEL } from "./labels.js";
import { SampleWorkspace, chooseSelection, queryFor } from "./workspace.js";

export { chooseSelection, queryFor };

const NO_FILTERS = {
  label: "",
  session: "",
  author: "",
  from: "",
  to: "",
  status: "",
};

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

export function Browse({ snapshot, notices, shortcuts }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [sessions, setSessions] = useState([]);

  const change = (changes) =>
    setFilters((current) => ({ ...current, ...changes }));

  useEffect(() => {
    notices.attempt(() => api.get("/api/sessions")).then((list) => {
      if (list) setSessions(list);
    });
  }, [snapshot.samplesRevision]);

  const top = html`<div class="browse-top">
    <${Progress} snapshot=${snapshot} />
    <${Filters}
      snapshot=${snapshot}
      filters=${filters}
      sessions=${sessions}
      onChange=${change}
    />
  </div>`;
  return html`<section class="browse">
    <${SampleWorkspace}
      snapshot=${snapshot}
      notices=${notices}
      shortcuts=${shortcuts}
      filters=${filters}
      top=${top}
    />
  </section>`;
}
