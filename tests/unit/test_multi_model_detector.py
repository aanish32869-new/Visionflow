import os
import sys
import types

# Add dataset_service directory to path so module can be imported in test runner
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SERVICE_PATH = os.path.join(ROOT, 'services', 'dataset_service')
if SERVICE_PATH not in sys.path:
    sys.path.insert(0, SERVICE_PATH)

if 'ultralytics' not in sys.modules:
    ultralytics_stub = types.ModuleType('ultralytics')

    class PlaceholderYOLO:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    ultralytics_stub.YOLO = PlaceholderYOLO
    sys.modules['ultralytics'] = ultralytics_stub

from multi_model_detector import (
    MultiModelDetector,
    map_custom_query_to_detectable,
    expand_query_with_subclasses,
    get_all_searchable_queries,
    get_ambiguous_object_aliases,
    get_supported_coco_classes,
    get_object_catalog_sources,
)


class DummyArray:
    def __init__(self, values):
        self.values = values

    def tolist(self):
        return list(self.values)


class DummyBox:
    def __init__(self, cls_id=0, conf=0.9, xywhn=(0.5, 0.5, 0.2, 0.2)):
        self.cls = [DummyTensor(cls_id)]
        self.conf = [DummyTensor(conf)]
        self.xywhn = [DummyArray(xywhn)]


class DummyTensor:
    def __init__(self, value):
        self._value = value

    def item(self):
        return self._value


class DummyResult:
    def __init__(self, boxes):
        self.boxes = boxes


class DummyModel:
    def __init__(self):
        self.names = {0: 'car'}
        self.set_classes_calls = []

    def set_classes(self, classes):
        self.set_classes_calls.append(classes)

    def __call__(self, image_path, conf=0.02):
        return [DummyResult([DummyBox()])]


def test_map_custom_query_to_detectable_direct_coco():
    assert map_custom_query_to_detectable('person') == 'person'
    assert map_custom_query_to_detectable('CAR') == 'car'


def test_map_custom_query_to_detectable_coco_aliases():
    assert map_custom_query_to_detectable('phone') == 'cell phone'
    assert map_custom_query_to_detectable('tv monitor') == 'tv'
    assert map_custom_query_to_detectable('motorbike') == 'motorcycle'


def test_map_custom_query_to_detectable_mapped_object():
    assert map_custom_query_to_detectable('sofa') == 'couch'
    assert map_custom_query_to_detectable('engine hood') == 'hood'


def test_map_custom_query_to_detectable_partial_match():
    # Should map a close match to known COCO class
    assert map_custom_query_to_detectable('eleph') == 'elephant'
    assert map_custom_query_to_detectable('wheels') == 'wheel'


def test_expand_query_with_subclasses_keeps_root_query_compact():
    expanded = expand_query_with_subclasses('car')
    assert 'car' in expanded
    assert 'vehicle' in expanded
    assert 'automobile' in expanded
    assert 'wheel' not in expanded
    assert 'mirror' not in expanded


def test_expand_query_with_subclasses_keeps_mirror_part_specific():
    expanded = expand_query_with_subclasses('mirror')
    assert 'mirror' in expanded
    assert 'side mirror' in expanded
    assert 'wing mirror' in expanded
    assert 'car' not in expanded
    assert 'wheel' not in expanded


def test_expand_query_with_subclasses_keeps_windshield_part_specific():
    expanded = expand_query_with_subclasses('windshield')
    assert 'windshield' in expanded
    assert 'windscreen' in expanded
    assert 'front glass' in expanded
    assert 'car' not in expanded
    assert 'wheel' not in expanded


def test_expand_query_with_subclasses_unknown():
    assert expand_query_with_subclasses('banana') == ['banana']


def test_detect_with_strategy_yolo_world_resets_set_classes():
    detector = MultiModelDetector()
    detector.yolo_world_model = DummyModel()
    detector.yolov8_model = DummyModel()  # no-op for COCO path logic

    # first call with queries should set the classes
    detections, labels = detector.detect_with_strategy('dummy.jpg', queries=['car'], strategy='world')
    assert ['car'] in detector.yolo_world_model.set_classes_calls
    assert labels == ['car']

    # second call without queries should reset classes to None
    detections, labels = detector.detect_with_strategy('dummy.jpg', queries=None, strategy='world')
    assert detector.yolo_world_model.set_classes_calls[-1] is None


def test_filter_part_detections_keeps_small_box_inside_car():
    detector = MultiModelDetector()
    detections = [{
        "label": "side mirror",
        "x_center": 0.75,
        "y_center": 0.42,
        "width": 0.08,
        "height": 0.06,
        "confidence": 0.6,
        "model": "world",
    }]
    parent = [{
        "label": "car",
        "x_center": 0.5,
        "y_center": 0.5,
        "width": 0.8,
        "height": 0.4,
        "confidence": 0.9,
        "model": "coco",
    }]

    detector._collect_parent_candidates = lambda image_path, root_labels, conf_threshold: parent
    filtered = detector._filter_part_detections("dummy.jpg", detections, ["mirror"], 0.02)
    assert filtered == detections


def test_filter_part_detections_rejects_huge_box_and_keeps_smallest_fallback():
    detector = MultiModelDetector()
    huge = {
        "label": "mirror",
        "x_center": 0.5,
        "y_center": 0.5,
        "width": 0.72,
        "height": 0.32,
        "confidence": 0.7,
        "model": "world",
    }
    smaller = {
        "label": "mirror",
        "x_center": 0.72,
        "y_center": 0.44,
        "width": 0.14,
        "height": 0.08,
        "confidence": 0.45,
        "model": "world",
    }
    parent = [{
        "label": "car",
        "x_center": 0.5,
        "y_center": 0.5,
        "width": 0.8,
        "height": 0.4,
        "confidence": 0.9,
        "model": "coco",
    }]

    detector._collect_parent_candidates = lambda image_path, root_labels, conf_threshold: parent
    filtered = detector._filter_part_detections("dummy.jpg", [huge, smaller], ["mirror"], 0.02)
    assert filtered == [smaller]


def test_get_all_searchable_queries_includes_car_parts():
    searchable = get_all_searchable_queries()
    assert 'car' in searchable
    assert 'tyre' in searchable
    assert 'mirror' in searchable


def test_get_supported_coco_classes_has_complete_core_labels():
    coco_classes = get_supported_coco_classes()
    assert 'bird' in coco_classes
    assert 'cell phone' in coco_classes
    assert len(coco_classes) == 80


def test_get_ambiguous_object_aliases_exposes_shared_terms():
    ambiguous = get_ambiguous_object_aliases()
    assert 'mirror' in ambiguous
    assert 'car' in ambiguous['mirror']
    assert len(ambiguous['mirror']) > 1


def test_get_object_catalog_sources_prefers_split_catalog_files():
    sources = get_object_catalog_sources()
    assert 'vehicles.json' in sources
    assert 'animals.json' in sources
    assert 'DEFAULT_OBJECT_SUBCLASSES' not in sources


if __name__ == '__main__':
    test_functions = [
        obj for name, obj in sorted(globals().items())
        if name.startswith('test_') and callable(obj)
    ]
    failures = []
    for test_func in test_functions:
        try:
            test_func()
            print(f"PASS {test_func.__name__}")
        except Exception as exc:
            failures.append((test_func.__name__, exc))
            print(f"FAIL {test_func.__name__}: {exc}")

    if failures:
        raise SystemExit(1)
