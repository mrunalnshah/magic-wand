"""The cameras found on this machine, read once and kept.

Finding the cameras opens every camera number in turn, one after another,
which is slow, switches cameras on (including a phone's), and can disturb a
camera that is already running. So the list is read the first time it is
needed and kept until the user asks for a fresh one (the Refresh list button).
The Calibration Service and the Session Service share one catalog.
"""

from __future__ import annotations

import threading
from collections.abc import Callable

from wand_core.sources import CameraInfo, list_cameras

Lister = Callable[[], list[CameraInfo]]


class CameraCatalog:
    """A kept copy of what the lister found."""

    def __init__(self, lister: Lister = list_cameras) -> None:
        self._lister = lister
        self._found: list[CameraInfo] | None = None
        self._lock = threading.Lock()  # one scan at a time

    def get(self, refresh: bool = False) -> list[CameraInfo]:
        """The cameras; they are looked for only the first time, or when
        ``refresh`` is true."""
        with self._lock:
            if refresh or self._found is None:
                self._found = list(self._lister())
            return list(self._found)

    @property
    def scanned(self) -> bool:
        """Whether the cameras have been looked for yet."""
        return self._found is not None


def as_catalog(source: Lister | CameraCatalog) -> CameraCatalog:
    """A catalog for a lister, or the catalog itself."""
    return (
        source if isinstance(source, CameraCatalog) else CameraCatalog(source)
    )
