// Notices shown at the top of the page. A failed request becomes a notice
// with the server's error code and message. A notice goes away when the user
// dismisses it or after a few seconds (the view does that). The same notice
// added again while it is showing is not repeated: it is renewed, which
// restarts its timer.

import { ApiError } from "./api.js";

export function createNotices() {
  let items = [];
  let nextId = 1;
  const listeners = new Set();
  const publish = () => listeners.forEach((listener) => listener(items));
  return {
    get: () => items,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(message, code = "") {
      const same = items.find(
        (item) => item.message === message && item.code === code,
      );
      items = same
        ? items.map((item) =>
            item === same ? { ...item, renewals: item.renewals + 1 } : item,
          )
        : [...items, { id: nextId++, message, code, renewals: 0 }];
      publish();
    },
    dismiss(id) {
      items = items.filter((item) => item.id !== id);
      publish();
    },
    // Runs an action (a function returning a promise). If it fails, shows
    // the error as a notice and resolves with undefined.
    async attempt(action) {
      try {
        return await action();
      } catch (error) {
        if (error instanceof ApiError) this.add(error.message, error.code);
        else this.add(String(error.message || error));
        return undefined;
      }
    },
  };
}
