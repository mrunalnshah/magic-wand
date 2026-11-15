// The scrubbing view: one sample's video with its path drawn over it. The
// part of the path up to the current frame is highlighted. Frame positions
// come from the sample's `positions` and the clip's `gestureStartS`. A sample
// without a clip is scrubbed too: its path is replayed on a black background
// by a PathPlayer, which keeps time itself and answers like a video element.
// It can be used with the keyboard: while it is open it takes over the keys
// (see SCRUB_ACTIONS).

import { useEffect, useRef, useState } from "preact/hooks";

import { html } from "./html.js";

const FRAME_S = 1 / 30; // one step; the clip's rate is about 30 fps
const MANY_FRAMES = 10;

// The shortcut actions of this view; their keys are in the settings.
export const SCRUB_ACTIONS = [
  "scrubPlay",
  "scrubBack",
  "scrubForward",
  "scrubBackMany",
  "scrubForwardMany",
  "scrubStart",
  "scrubEnd",
  "scrubFullScreen",
  "scrubVideo",
  "scrubClose",
];
const PATH_COLOR = "rgba(255, 255, 255, 0.35)";
const DONE_COLOR = "#f0883e";
const MARKER_COLOR = "#4cc38a";

// A stand-in for a video element when a sample has no clip. It plays the
// stored positions in real time, from 0 to the last position's time, and
// offers what the view uses of a video: `currentTime`, `duration`, `paused`,
// `play()`, `pause()` and the events "play", "pause" and "seeked".
export class PathPlayer extends EventTarget {
  constructor(duration, now = () => performance.now()) {
    super();
    this.duration = duration;
    this._now = now;
    this._time = 0;
    this._playing = false;
    this._last = 0;
  }

  get paused() {
    this._advance();
    return !this._playing;
  }

  get currentTime() {
    this._advance();
    return this._time;
  }

  set currentTime(seconds) {
    this._advance();
    this._time = Math.min(Math.max(0, seconds), this.duration);
    this.dispatchEvent(new Event("seeked"));
  }

  play() {
    if (this._time >= this.duration) this._time = 0; // replay from the start
    this._playing = true;
    this._last = this._now();
    this.dispatchEvent(new Event("play"));
  }

  pause() {
    this._advance();
    if (!this._playing) return;
    this._playing = false;
    this.dispatchEvent(new Event("pause"));
  }

  // Moves the time on by the real time that has passed; stops at the end.
  _advance() {
    if (!this._playing) return;
    const now = this._now();
    this._time += (now - this._last) / 1000;
    this._last = now;
    if (this._time >= this.duration) {
      this._time = this.duration;
      this._playing = false;
      this.dispatchEvent(new Event("pause"));
    }
  }
}

// Whether the user chose to show the video. The video starts hidden, and the
// choice carries over to the next sample; reloading the page resets it.
let videoShown = false;

// How many positions are at or before video time `videoS`. Position times
// are seconds from the gesture start, which is `gestureStartS` into the clip.
export function countUpTo(timeS, gestureStartS, videoS) {
  const into = videoS - gestureStartS;
  let count = 0;
  while (count < timeS.length && timeS[count] <= into + 1e-9) count += 1;
  return count;
}

// Draws the whole path faintly and the part up to `count` in colour.
export function drawPath(context, positions, count, width, height) {
  const { horizontal, vertical } = positions;
  const at = (i) => [horizontal[i] * width, vertical[i] * height];
  context.clearRect(0, 0, width, height);
  context.lineWidth = Math.max(2, height / 120);
  context.lineJoin = "round";
  const trace = (from, to, color) => {
    if (to - from < 1) return;
    context.beginPath();
    context.strokeStyle = color;
    context.moveTo(...at(from));
    for (let i = from + 1; i <= to; i += 1) context.lineTo(...at(i));
    context.stroke();
  };
  trace(0, horizontal.length - 1, PATH_COLOR);
  trace(0, count - 1, DONE_COLOR);
  if (count > 0) {
    const [x, y] = at(count - 1);
    context.beginPath();
    context.fillStyle = MARKER_COLOR;
    context.arc(x, y, Math.max(4, height / 60), 0, 2 * Math.PI);
    context.fill();
  }
}

export function Scrub({ id, details, onClose, shortcuts }) {
  const stage = useRef(null);
  const video = useRef(null);
  const blank = useRef(null); // the black surface when there is no clip
  const canvas = useRef(null);
  const virtual = useRef(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [full, setFull] = useState(false);
  const [masked, setMasked] = useState(!videoShown);

  const positions = details.positions;
  const hasVideo = Boolean(details.hasClip && details.video);
  const times = positions.timeS;
  const start = hasVideo ? details.video.gestureStartS : 0;
  if (!hasVideo && !virtual.current) {
    const last = times.length ? times[times.length - 1] : 0;
    virtual.current = new PathPlayer(last);
  }
  // The thing that keeps the time: the video, or the path player.
  const getPlayer = () => (hasVideo ? video.current : virtual.current);
  const surface = () => (hasVideo ? video.current : blank.current);
  const draw = () => {
    const element = canvas.current;
    const player = getPlayer();
    const area = surface();
    if (!element || !player || !area) return;
    element.width = area.clientWidth || 640;
    element.height = area.clientHeight || 480;
    const context = element.getContext("2d");
    if (!context) return;
    const count = countUpTo(positions.timeS, start, player.currentTime);
    drawPath(context, positions, count, element.width, element.height);
  };

  useEffect(() => {
    const player = getPlayer();
    const update = () => {
      setTime(player.currentTime);
      draw();
    };
    const meta = () => {
      setDuration(player.duration || 0);
      player.currentTime = Math.max(0, start);
      update();
    };
    player.addEventListener("timeupdate", update);
    player.addEventListener("seeked", update);
    player.addEventListener("loadedmetadata", meta);
    player.addEventListener("play", () => setPlaying(true));
    player.addEventListener("pause", () => {
      setPlaying(false);
      update(); // the last step of playback is drawn too
    });
    if (!hasVideo) meta(); // nothing to load: the player is ready now
    // While playing, follow the video every animation frame.
    let frame = 0;
    const follow = () => {
      if (!player.paused) update();
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [id]);

  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  const seek = (seconds) => {
    const player = getPlayer();
    const next = Math.min(Math.max(0, seconds), duration || seconds);
    player.currentTime = next;
    setTime(next);
  };
  // A step starts from where the player is now, so quick clicks add up. With
  // a clip it is a frame of the video; without one it is a stored position.
  const step = (frames) => {
    const player = getPlayer();
    if (hasVideo) return seek(player.currentTime + frames * FRAME_S);
    if (times.length === 0) return undefined;
    const at = countUpTo(times, 0, player.currentTime) - 1; // -1: before all
    const target = Math.min(Math.max(at + frames, 0), times.length - 1);
    return seek(times[target]);
  };
  const toggle = () => {
    const player = getPlayer();
    if (player.paused) player.play();
    else player.pause();
  };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.current.requestFullscreen) stage.current.requestFullscreen();
  };

  const toggleMask = () => {
    if (!hasVideo) return; // there is no video to show
    videoShown = masked; // masked now, so the video is about to be shown
    setMasked(!masked);
  };
  // Escape leaves full screen first (the browser usually does that itself
  // and keeps the key), and closes the view when it is not full screen.
  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else onClose();
  };

  // The keyboard. The handlers always use the latest functions.
  const keyActions = useRef({});
  keyActions.current = {
    scrubPlay: toggle,
    scrubBack: () => step(-1),
    scrubForward: () => step(1),
    scrubBackMany: () => step(-MANY_FRAMES),
    scrubForwardMany: () => step(MANY_FRAMES),
    scrubStart: () => seek(0),
    scrubEnd: () => seek(getPlayer().duration || 0),
    scrubFullScreen: toggleFull,
    scrubVideo: toggleMask,
    scrubClose: close,
  };
  useEffect(() => {
    if (!shortcuts) return undefined;
    const release = shortcuts.pushScope(SCRUB_ACTIONS);
    const off = SCRUB_ACTIONS.map((action) =>
      shortcuts.on(action, () => keyActions.current[action]()),
    );
    return () => {
      release();
      off.forEach((remove) => remove());
    };
  }, [shortcuts]);
  const key = (action) => (shortcuts ? shortcuts.keyFor(action) : "");
  const hint = (action) => {
    const text = key(action);
    return text && html` <kbd>${text}</kbd>`;
  };
  const boxClass =
    "box" +
    (details.mirrored ? " mirrored" : "") +
    (masked || !hasVideo ? " masked" : "");
  const [width, height] = details.frameSize || [4, 3];
  // A definite width: as wide as the frame, up to 640 px or the room there is
  // (a box that sizes to its content would collapse to nothing without a
  // video in it), and no taller than 80% of the window.
  const boxStyle = hasVideo
    ? undefined
    : { width: `min(100%, 640px, calc(80vh * ${width} / ${height}))` };

  return html`<section class="scrub" ref=${stage}>
    <div class="frame">
      <div class=${boxClass} style=${boxStyle}>
        ${hasVideo
          ? html`<video
              ref=${video}
              src=${`/api/samples/${encodeURIComponent(id)}/video`}
              preload="auto"
              muted
              playsinline
            ></video>`
          : html`<div
              class="blank"
              ref=${blank}
              style=${{ aspectRatio: `${width} / ${height}` }}
            ></div>`}
        <canvas ref=${canvas}></canvas>
      </div>
    </div>
    <div class="row controls">
      <button onClick=${toggle}>
        ${playing ? "Pause" : "Play"}${hint("scrubPlay")}
      </button>
      <button aria-label="Back one frame" onClick=${() => step(-1)}>
        ◀ Frame${hint("scrubBack")}
      </button>
      <button aria-label="Forward one frame" onClick=${() => step(1)}>
        Frame ▶${hint("scrubForward")}
      </button>
      <input
        type="range"
        aria-label="Position in the clip"
        min="0"
        max=${duration}
        step="0.01"
        value=${time}
        onInput=${(event) => seek(Number(event.target.value))}
        onChange=${(event) => event.target.blur()}
      />
      <span class="hint">${time.toFixed(2)} s</span>
      <button
        aria-pressed=${masked}
        disabled=${!hasVideo}
        title=${hasVideo ? "" : "This sample has no video clip"}
        onClick=${toggleMask}
      >
        ${masked ? "Show video" : "Hide video"}${hint("scrubVideo")}
      </button>
      <button onClick=${toggleFull}>
        ${full ? "Leave full screen" : "Full screen"}${hint("scrubFullScreen")}
      </button>
      <button onClick=${onClose}>Close${hint("scrubClose")}</button>
    </div>
    ${!hasVideo &&
    html`<p class="hint">
      There is no video clip for this sample, so only the path is replayed.
    </p>`}
    ${shortcuts &&
    html`<p class="hint keys">
      <kbd>${key("scrubBack")}</kbd> <kbd>${key("scrubForward")}</kbd> one
      frame, <kbd>${key("scrubBackMany")}</kbd>
      <kbd>${key("scrubForwardMany")}</kbd> ten frames,
      <kbd>${key("scrubStart")}</kbd> <kbd>${key("scrubEnd")}</kbd> first and
      last frame
    </p>`}
  </section>`;
}
