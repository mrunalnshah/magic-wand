// Keyboard shortcuts. The key for each action comes from the application
// settings (`shortcuts`), so it can be changed in the configuration. An action
// can have one key or a list of keys (the first is the one shown on buttons).
// Keys 1 to 9 always choose a label. Keys typed into an input field are
// ignored, and so are Space and Enter while a button or link has the focus,
// because the browser then uses them to press it.

const DISPLAY = {
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Backspace: "⌫",
  Delete: "Del",
  Enter: "↵",
  " ": "Space",
};

// How a key is shown on a button.
export function keyLabel(key) {
  if (key in DISPLAY) return DISPLAY[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

function isTyping(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    Boolean(target.isContentEditable)
  );
}

function isPressable(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toLowerCase();
  return (
    tag === "button" ||
    tag === "a" ||
    tag === "summary" ||
    target.getAttribute?.("role") === "button"
  );
}

// The keys of a binding as a list (a binding is one key or a list of keys).
function keysOf(binding) {
  return [].concat(binding === undefined ? [] : binding);
}

export function createShortcuts(bindings = {}) {
  let keys = { ...bindings };
  const handlers = new Map(); // action -> list of functions

  function run(action, argument) {
    const list = handlers.get(action) || [];
    list.forEach((handler) => handler(argument));
    return list.length > 0;
  }

  return {
    setBindings(next) {
      keys = { ...next };
    },
    // The key bound to an action, for showing on its button.
    keyFor(action) {
      const [first] = keysOf(keys[action]);
      return first === undefined ? "" : keyLabel(first);
    },
    // Registers a handler for an action; returns a function that removes it.
    on(action, handler) {
      const list = handlers.get(action) || [];
      handlers.set(action, [...list, handler]);
      return () => {
        handlers.set(
          action,
          (handlers.get(action) || []).filter((h) => h !== handler),
        );
      };
    },
    // Handles a keyboard event; returns true if it was a shortcut.
    handle(event) {
      if (isTyping(event.target)) return false;
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if ((event.key === " " || event.key === "Enter") &&
          isPressable(event.target)) {
        return false;
      }
      if (/^[1-9]$/.test(event.key)) {
        return run("label", Number(event.key));
      }
      const action = Object.keys(keys).find((name) =>
        keysOf(keys[name]).some(
          (key) => key.toLowerCase() === event.key.toLowerCase(),
        ),
      );
      return action ? run(action) : false;
    },
    attach(target = window) {
      const listener = (event) => {
        if (this.handle(event)) event.preventDefault();
      };
      // A button that was clicked with the mouse keeps the focus, which would
      // make Space press it again; give the focus back. A button reached and
      // pressed with the keyboard (event.detail is 0) keeps it.
      const release = (event) => {
        const button = event.target.closest && event.target.closest("button");
        if (button && event.detail > 0) button.blur();
      };
      target.addEventListener("keydown", listener);
      target.addEventListener("click", release);
      return () => {
        target.removeEventListener("keydown", listener);
        target.removeEventListener("click", release);
      };
    },
  };
}
