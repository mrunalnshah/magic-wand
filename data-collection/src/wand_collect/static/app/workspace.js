// The sample workspace used by the Browse and Review pages: a grid of
// thumbnails that loads more samples as it is scrolled, and the selected
// sample beside it. The page gives it the filters (a session, a label, ...)
// and what to show above the grid; it does the rest: loading, selection, the
// keys, and scrubbing a sample.

import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "./api.js";
import { html } from "./html.js";
import { Scrub } from "./scrub.js";
import {
  SampleDetail,
  SampleGrid,
  columnsOf,
  useSampleDetails,
} from "./sampleview.js";

export const CHUNK = 100; // samples fetched at a time
const MAX_PAGE = 500; // the largest page the server gives
const NEAR_END_PX = 600; // load more when the end is this close to the view

// The query string of a set of filters and a page.
export function queryFor(filters, page, pageSize = CHUNK, order = "newest") {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value) params.set(name, value);
  }
  params.set("order", order);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

// Fetches the first `count` samples of a query (a multiple of CHUNK, or all of
// them), in as few requests as the server's page size allows.
async function fetchFirst(filters, order, count) {
  const size = CHUNK * Math.min(MAX_PAGE / CHUNK, Math.max(1, count / CHUNK));
  const items = [];
  let total = 0;
  for (let page = 1; items.length < count; page += 1) {
    const found = await api.get(
      `/api/samples?${queryFor(filters, page, size, order)}`,
    );
    total = found.total;
    items.push(...found.items);
    if (items.length >= total || found.items.length === 0) break;
  }
  return { items, total };
}

// The samples of a query, loaded a chunk at a time. `loadMore` adds the next
// chunk. When the samples revision changes the part already loaded is read
// again, so the list stays what it is on the server (and keeps its place,
// because the same samples keep the same keys).
export function useSampleList(filters, order, revision, notices) {
  const [list, setList] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const listRef = useRef(list);
  listRef.current = list;
  const busy = useRef(false);
  const generation = useRef(0); // a response for an older query is dropped
  const last = useRef({ key: null, revision: null });
  const key = JSON.stringify(filters) + order;

  const guarded = async (work) => {
    const mine = generation.current;
    busy.current = true;
    setLoading(true);
    try {
      const result = await work();
      if (mine === generation.current) return result;
    } catch (error) {
      notices.add(error.message || String(error), error.code);
    } finally {
      busy.current = false;
      setLoading(false);
    }
    return null;
  };

  useEffect(() => {
    const same = last.current.key === key;
    last.current = { key, revision };
    if (!same) {
      generation.current += 1;
      setList({ items: [], total: 0 });
    }
    const count = same
      ? Math.max(CHUNK, listRef.current.items.length)
      : CHUNK;
    guarded(() => fetchFirst(filters, order, count)).then((result) => {
      if (result) setList(result);
    });
  }, [key, revision]);

  const loadMore = async () => {
    const have = listRef.current.items.length;
    if (busy.current || have >= listRef.current.total) return;
    const result = await guarded(() =>
      api.get(
        `/api/samples?${queryFor(filters, have / CHUNK + 1, CHUNK, order)}`,
      ),
    );
    if (!result) return;
    setList((current) => {
      const known = new Set(current.items.map((item) => item.id));
      const fresh = result.items.filter((item) => !known.has(item.id));
      return { items: [...current.items, ...fresh], total: result.total };
    });
  };

  return {
    items: list.items,
    total: list.total,
    hasMore: list.items.length < list.total,
    loading,
    loadMore,
  };
}

// Which sample to select after the list changed: the one selected, else the
// one now at its position, else the first.
export function chooseSelection(items, selectedId, previousIndex) {
  if (items.length === 0) return null;
  if (selectedId && items.some((item) => item.id === selectedId)) {
    return selectedId;
  }
  if (selectedId && previousIndex >= 0) {
    return items[Math.min(previousIndex, items.length - 1)].id;
  }
  return items[0].id;
}

export function SampleWorkspace({
  snapshot,
  notices,
  shortcuts,
  filters,
  order = "newest",
  top = null,
  emptyText = "No samples match.",
}) {
  const list = useSampleList(filters, order, snapshot.samplesRevision, notices);
  const [selected, setSelected] = useState(null);
  const [scrubbing, setScrubbing] = useState(false);
  const paneRef = useRef(null);
  const gridRef = useRef(null);
  const endRef = useRef(null);
  const itemsRef = useRef(list.items);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const listRef = useRef(list);
  listRef.current = list;
  const wantRef = useRef(null); // a move that waits for more samples to load

  // Keep a valid selection when the list changes.
  useEffect(() => {
    const previous = itemsRef.current.findIndex(
      (item) => item.id === selectedRef.current,
    );
    itemsRef.current = list.items;
    if (wantRef.current !== null && list.items.length > 0) {
      const index = Math.min(wantRef.current, list.items.length - 1);
      wantRef.current = null;
      selectedRef.current = list.items[index].id;
      setSelected(list.items[index].id);
      return;
    }
    setSelected(
      chooseSelection(list.items, selectedRef.current, previous),
    );
  }, [list.items]);

  // Load more when the end of the grid is near the part that can be seen.
  // This works whether the grid pane scrolls or (in a narrow, short window)
  // the page does.
  const checkEnd = () => {
    const end = endRef.current;
    const pane = paneRef.current;
    const now = listRef.current;
    if (!end || !pane || !now.hasMore || now.loading) return;
    const visibleBottom = Math.min(
      pane.getBoundingClientRect().bottom,
      window.innerHeight,
    );
    if (end.getBoundingClientRect().top - visibleBottom < NEAR_END_PX) {
      now.loadMore();
    }
  };
  useEffect(() => {
    checkEnd(); // the grid may not fill the pane yet
  }, [list.items, list.hasMore, list.loading]);
  useEffect(() => {
    window.addEventListener("scroll", checkEnd);
    window.addEventListener("resize", checkEnd);
    return () => {
      window.removeEventListener("scroll", checkEnd);
      window.removeEventListener("resize", checkEnd);
    };
  }, []);

  const summary = list.items.find((item) => item.id === selected) || null;
  const details = useSampleDetails(
    summary ? summary.id : null,
    snapshot.samplesRevision,
    notices,
  );

  // Moves the selection by `delta` samples (a row is a few samples). Past the
  // end of what is loaded it loads more and goes on from there.
  const move = (delta) => {
    const items = itemsRef.current;
    if (items.length === 0) return;
    const at = items.findIndex((item) => item.id === selectedRef.current);
    const target = (at < 0 ? 0 : at) + delta;
    if (target >= items.length && listRef.current.hasMore) {
      wantRef.current = target;
      listRef.current.loadMore();
      return;
    }
    // The ref is updated at once, so keys that repeat faster than the page
    // draws each move from where the last one went.
    const id = items[Math.max(0, Math.min(items.length - 1, target))].id;
    selectedRef.current = id;
    setSelected(id);
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
    const grid = gridRef.current;
    const tile = grid && grid.querySelector('[aria-current="true"]');
    if (tile && tile.scrollIntoView) tile.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (scrubbing && details && summary) {
    return html`${top}
      <${Scrub}
        id=${summary.id}
        details=${details}
        onClose=${() => setScrubbing(false)}
        shortcuts=${shortcuts}
      />`;
  }
  const shown = list.items.length;
  return html`${top}
    <div class="workspace">
      <div class="grid-pane" ref=${paneRef} onScroll=${checkEnd}>
        <p class="hint">
          ${list.total} samples match${shown < list.total
            ? ` (${shown} shown, more load as you scroll)`
            : ""}.
        </p>
        <${SampleGrid}
          items=${list.items}
          selectedId=${selected}
          snapshot=${snapshot}
          onSelect=${setSelected}
          listRef=${gridRef}
        />
        <div class="grid-end" ref=${endRef}>
          ${list.loading ? "Loading more..." : ""}
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
            <p class="hint">
              ${list.loading ? "Loading..." : emptyText}
            </p>
          </aside>`}
    </div>`;
}
