import threading
import time

import cv2
import numpy as np
import pytest

from wand_core.sources import (
    CameraMode,
    CameraOpenError,
    CameraSource,
    Frame,
    FrameSourceError,
    VideoFileSource,
    VideoOpenError,
    camera_name,
    list_cameras,
    run_within,
)
from wand_core.testing.synthetic import SceneStyle, circle_path, write_video


class FakeCapture:
    """Stands in for cv2.VideoCapture; no hardware is touched."""

    def __init__(self, opened=True, props=None, frames=3, log=None):
        self.opened = opened
        self.props = {
            cv2.CAP_PROP_FRAME_WIDTH: 640,
            cv2.CAP_PROP_FRAME_HEIGHT: 480,
            cv2.CAP_PROP_FPS: 30,
        }
        self.props.update(props or {})
        self.frames = frames
        self.log = log if log is not None else []
        self.released = 0
        self.set_calls = []

    def isOpened(self):  # noqa: N802 - mirrors the OpenCV API
        return self.opened

    def set(self, prop, value):
        self.set_calls.append((prop, value))
        self.props[prop] = value
        return True

    def get(self, prop):
        return self.props.get(prop, 0)

    def grab(self):
        self.log.append("grab")
        if self.frames <= 0:
            return False
        self.frames -= 1
        return True

    def retrieve(self):
        self.log.append("retrieve")
        return True, np.zeros((480, 640, 3), dtype=np.uint8)

    def release(self):
        self.released += 1


# --- Video files ------------------------------------------------------------


@pytest.fixture
def clip(tmp_path):
    file = tmp_path / "clip.avi"
    write_video(circle_path(20), file, SceneStyle(), fps=25.0)
    return file


def test_video_file_yields_every_frame_in_order(clip):
    with VideoFileSource(clip) as source:
        frames = list(source)
        assert source.frame_size == (640, 480)
        assert source.nominal_fps == pytest.approx(25.0)
    assert len(frames) == 20
    assert all(isinstance(f, Frame) for f in frames)
    assert frames[0].image.shape == (480, 640, 3)


def test_video_timestamps_start_at_zero_and_advance_by_frame_interval(clip):
    with VideoFileSource(clip) as source:
        stamps = [f.timestamp_s for f in source]
    assert stamps[0] == 0.0
    assert np.diff(stamps) == pytest.approx(1 / 25.0)
    assert all(b > a for a, b in zip(stamps, stamps[1:]))


def test_video_end_returns_none(clip):
    source = VideoFileSource(clip)
    source.open()
    for _ in range(20):
        assert source.read() is not None
    assert source.read() is None
    source.close()


def test_missing_and_unreadable_video_raise(tmp_path):
    with pytest.raises(VideoOpenError, match="not found"):
        VideoFileSource(tmp_path / "nope.avi").open()
    junk = tmp_path / "junk.avi"
    junk.write_bytes(b"not a video")
    with pytest.raises(VideoOpenError):
        VideoFileSource(junk).open()


def test_video_without_frame_rate_raises(tmp_path):
    file = tmp_path / "x.avi"
    file.write_bytes(b"x")
    fake = FakeCapture(props={cv2.CAP_PROP_FPS: 0})
    with pytest.raises(VideoOpenError, match="frame rate"):
        VideoFileSource(file, capture_factory=lambda _: fake).open()
    assert fake.released == 1


def test_reading_before_open_raises(clip):
    with pytest.raises(FrameSourceError):
        VideoFileSource(clip).read()


def test_closing_twice_is_safe(clip):
    source = VideoFileSource(clip)
    source.open()
    source.close()
    source.close()
    VideoFileSource(clip).close()  # never opened


# --- Camera -----------------------------------------------------------------


def test_camera_requests_mode_and_reports_actual():
    fake = FakeCapture(
        props={cv2.CAP_PROP_FRAME_WIDTH: 1280, cv2.CAP_PROP_FRAME_HEIGHT: 720}
    )
    # The fake applies requests, so make it ignore them like a stubborn camera.
    fake.set = lambda prop, value: fake.set_calls.append((prop, value)) or True
    camera = CameraSource(2, 640, 480, 30, capture_factory=lambda index: fake)
    camera.open()
    assert camera.requested == CameraMode(640, 480, 30)
    assert camera.actual == CameraMode(1280, 720, 30.0)
    assert camera.frame_size == (1280, 720)
    assert camera.nominal_fps == 30.0
    assert (cv2.CAP_PROP_FRAME_WIDTH, 640) in fake.set_calls
    assert (cv2.CAP_PROP_FPS, 30) in fake.set_calls


def test_camera_defaults_to_640x480_at_30():
    camera = CameraSource(capture_factory=lambda index: FakeCapture())
    assert camera.requested == CameraMode(640, 480, 30)


def test_camera_timestamp_is_taken_between_grab_and_retrieve():
    log = []
    fake = FakeCapture(log=log)

    def clock():
        log.append("clock")
        return 123.5

    camera = CameraSource(capture_factory=lambda i: fake, clock=clock)
    camera.open()
    frame = camera.read()
    assert log == ["grab", "clock", "retrieve"]
    assert frame.timestamp_s == 123.5


def test_camera_timestamps_come_from_a_monotonic_clock():
    camera = CameraSource(capture_factory=lambda i: FakeCapture(frames=50))
    camera.open()
    stamps = [camera.read().timestamp_s for _ in range(50)]
    assert all(b >= a for a, b in zip(stamps, stamps[1:]))


def test_camera_failed_grab_returns_none():
    camera = CameraSource(capture_factory=lambda i: FakeCapture(frames=1))
    camera.open()
    assert camera.read() is not None
    assert camera.read() is None


def test_camera_that_cannot_open_raises_specific_error():
    fake = FakeCapture(opened=False)
    camera = CameraSource(3, capture_factory=lambda i: fake)
    with pytest.raises(CameraOpenError, match="camera 3"):
        camera.open()
    assert fake.released == 1
    assert isinstance(CameraOpenError("x"), FrameSourceError)


def test_camera_closes_and_double_close_is_safe():
    fake = FakeCapture()
    camera = CameraSource(capture_factory=lambda i: fake)
    camera.open()
    camera.close()
    camera.close()
    assert fake.released == 1
    with pytest.raises(FrameSourceError):
        camera.read()


# --- Listing cameras --------------------------------------------------------


def test_list_cameras_with_none_returns_empty_list(tmp_path):
    cameras = list_cameras(
        capture_factory=lambda i: FakeCapture(opened=False), names_dir=tmp_path
    )
    assert cameras == []


def test_list_cameras_finds_open_indices_and_releases_them(tmp_path):
    made = {}

    def factory(index):
        made[index] = FakeCapture(opened=index in (0, 2))
        return made[index]

    cameras = list_cameras(capture_factory=factory, names_dir=tmp_path)
    assert [c.index for c in cameras] == [0, 2]
    assert [c.device_id for c in cameras] == ["index:0", "index:2"]
    assert all(c.name is None for c in cameras)
    assert all(c.modes == () for c in cameras)
    assert all(fake.released == 1 for fake in made.values())


def test_list_cameras_uses_names_when_available(tmp_path):
    (tmp_path / "video0").mkdir()
    (tmp_path / "video0" / "name").write_text("Integrated Camera\n")
    cameras = list_cameras(
        capture_factory=lambda i: FakeCapture(opened=i == 0),
        names_dir=tmp_path,
    )
    assert cameras[0].name == "Integrated Camera"
    assert cameras[0].device_id == "Integrated Camera"
    assert camera_name(5, tmp_path) is None


def test_list_cameras_survives_a_failing_backend(tmp_path):
    def factory(index):
        if index == 0:
            raise OSError("boom")
        return FakeCapture(opened=index == 1)

    cameras = list_cameras(capture_factory=factory, names_dir=tmp_path)
    assert [c.index for c in cameras] == [1]


def test_list_cameras_can_probe_modes(tmp_path):
    cameras = list_cameras(
        capture_factory=lambda i: FakeCapture(opened=i == 0),
        names_dir=tmp_path,
        probe_modes=True,
    )
    widths = [m.width for m in cameras[0].modes]
    assert widths == [640, 1280, 1920]


# --- Cameras that never answer ----------------------------------------------


class HangingFactory:
    """Opens camera ``stuck`` only once ``release_stuck`` is set, like a
    broken camera whose driver blocks; the other indices open at once."""

    def __init__(self, stuck=0, working=(1,)):
        self.stuck = stuck
        self.working = working
        self.release_stuck = threading.Event()
        self.late = None

    def __call__(self, index):
        if index == self.stuck:
            self.release_stuck.wait(5)
            self.late = FakeCapture()
            return self.late
        return FakeCapture(opened=index in self.working)


def test_camera_that_never_answers_raises_within_the_time_limit():
    factory = HangingFactory()
    camera = CameraSource(0, capture_factory=factory, open_timeout_s=0.2)
    started = time.monotonic()
    with pytest.raises(CameraOpenError, match="did not respond"):
        camera.open()
    assert time.monotonic() - started < 2
    with pytest.raises(FrameSourceError):
        camera.read()


def test_camera_that_opens_too_late_is_released():
    factory = HangingFactory()
    camera = CameraSource(0, capture_factory=factory, open_timeout_s=0.1)
    with pytest.raises(CameraOpenError):
        camera.open()
    factory.release_stuck.set()
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline and not (
        factory.late is not None and factory.late.released
    ):
        time.sleep(0.01)
    assert factory.late.released == 1


def test_list_cameras_leaves_out_a_camera_that_never_answers(tmp_path):
    factory = HangingFactory(stuck=0, working=(1,))
    started = time.monotonic()
    cameras = list_cameras(
        capture_factory=factory, names_dir=tmp_path, open_timeout_s=0.2
    )
    assert [c.index for c in cameras] == [1]
    assert time.monotonic() - started < 3
    factory.release_stuck.set()


def test_run_within_returns_the_result_or_raises_the_error():
    def fail():
        raise ValueError("bad")

    assert run_within(lambda: 42, 1.0) == 42
    assert run_within(lambda: 42, None) == 42
    with pytest.raises(ValueError, match="bad"):
        run_within(fail, 1.0)


def test_run_within_without_a_limit_runs_in_the_calling_thread():
    assert run_within(threading.current_thread, None) is (
        threading.current_thread()
    )
