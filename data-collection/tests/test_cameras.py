from wand_collect.cameras import CameraCatalog, as_catalog
from wand_core.sources import CameraInfo


class CountingLister:
    def __init__(self, *found):
        self.found = list(found)
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return list(self.found)


CAM_A = CameraInfo(0, "A", "A")
CAM_B = CameraInfo(1, "B", "B")


def test_the_cameras_are_looked_for_only_once():
    lister = CountingLister(CAM_A)
    catalog = CameraCatalog(lister)
    assert not catalog.scanned
    assert catalog.get() == [CAM_A]
    assert catalog.get() == [CAM_A]
    assert catalog.get() == [CAM_A]
    assert lister.calls == 1
    assert catalog.scanned


def test_a_refresh_looks_again_and_keeps_the_new_list():
    lister = CountingLister(CAM_A)
    catalog = CameraCatalog(lister)
    catalog.get()
    lister.found = [CAM_A, CAM_B]
    assert catalog.get() == [CAM_A]  # still the list read before
    assert catalog.get(refresh=True) == [CAM_A, CAM_B]
    assert catalog.get() == [CAM_A, CAM_B]
    assert lister.calls == 2


def test_the_list_given_out_is_a_copy():
    catalog = CameraCatalog(CountingLister(CAM_A))
    catalog.get().append(CAM_B)
    assert catalog.get() == [CAM_A]


def test_a_catalog_given_where_a_lister_is_expected_is_used_as_it_is():
    catalog = CameraCatalog(CountingLister(CAM_A))
    assert as_catalog(catalog) is catalog
    assert isinstance(as_catalog(CountingLister(CAM_A)), CameraCatalog)
