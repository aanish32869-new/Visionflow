import os
import sys
import types

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SERVICE_PATH = os.path.join(ROOT, "services", "inference_service")
if SERVICE_PATH not in sys.path:
    sys.path.insert(0, SERVICE_PATH)

if "ultralytics" not in sys.modules:
    ultralytics_stub = types.ModuleType("ultralytics")

    class PlaceholderYOLO:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    ultralytics_stub.YOLO = PlaceholderYOLO
    sys.modules["ultralytics"] = ultralytics_stub

from services.inference_service import InferenceLogic


def test_parse_annotation_group_terms_dedupes_case_insensitively():
    terms = InferenceLogic._parse_annotation_group_terms(" Helmet, vest\nhelmet, safety vest ")
    assert terms == [
        {"name": "Helmet", "slug": "helmet"},
        {"name": "vest", "slug": "vest"},
        {"name": "safety vest", "slug": "safety vest"},
    ]


def test_project_classification_queries_reject_empty_group():
    with pytest.raises(ValueError, match="at least one label"):
        InferenceLogic._project_classification_queries({
            "project_type": "Classification",
            "annotation_group": "",
            "classes": [],
        })


def test_project_classification_queries_reject_generic_group():
    with pytest.raises(ValueError, match="explicit labels"):
        InferenceLogic._project_classification_queries({
            "project_type": "Classification",
            "annotation_group": "objects",
        })


def test_project_classification_queries_exclude_unmapped_terms():
    queries = InferenceLogic._project_classification_queries({
        "project_type": "Classification",
        "annotation_group_terms": [
            {"name": "helmet", "slug": "helmet", "unmapped": False},
            {"name": "Sunny", "slug": "sunny", "unmapped": True},
        ],
    })
    assert queries == ["helmet"]


def test_project_classification_queries_use_detector_label_alias():
    queries = InferenceLogic._project_classification_queries({
        "project_type": "Classification",
        "annotation_group_terms": [
            {
                "name": "mobile phone",
                "slug": "mobile phone",
                "detector_label": "cell phone",
                "unmapped": False,
            },
            {
                "name": "safety vest",
                "slug": "safety vest",
                "detector_label": None,
                "unmapped": True,
            },
        ],
    })
    assert queries == ["cell phone"]


def test_project_classification_queries_include_unmapped_detector_terms():
    queries = InferenceLogic._project_classification_queries(
        {
            "project_type": "Classification",
            "annotation_group_terms": [
                {"name": "Safety helmet", "slug": "safety helmet", "unmapped": True},
                {"name": "Reflective vest", "slug": "reflective vest", "unmapped": True},
            ],
        },
        include_unmapped=True,
    )
    assert queries == ["Safety helmet", "Reflective vest"]


def test_classification_allowed_label_map_preserves_annotation_group_names():
    label_map = InferenceLogic._classification_allowed_label_map({
        "project_type": "Classification",
        "classification_type": "Multi-Label",
        "annotation_group_terms": [
            {"name": "Helmet", "slug": "helmet", "unmapped": True},
            {"name": "Safety vest", "slug": "safety vest", "unmapped": True},
        ],
    })
    assert label_map == {"helmet": "Helmet", "vest": "Safety vest", "safety vest": "Safety vest"}


def test_classification_detection_plan_maps_ppe_synonyms_to_model_labels():
    plan = InferenceLogic._classification_detection_plan({
        "project_type": "Classification",
        "classification_type": "Multi-Label",
        "annotation_group_terms": [
            {"name": "Safety Helmet", "slug": "safety helmet", "unmapped": True},
            {"name": "Reflective Vest", "slug": "reflective vest", "unmapped": True},
            {"name": "Person", "slug": "person", "unmapped": False},
        ],
    })
    assert plan["ppe_requested"] is True
    assert plan["label_queries"] == ["helmet", "vest", "Person"]
    assert plan["allowed_label_map"]["helmet"] == "Safety Helmet"
    assert plan["allowed_label_map"]["vest"] == "Reflective Vest"


def test_project_classification_label_options_allow_unmapped_weather_terms():
    labels = InferenceLogic._project_classification_label_options({
        "project_type": "Classification",
        "classification_type": "Single-Label",
        "annotation_group_terms": [
            {"name": "Sunny", "slug": "sunny", "unmapped": True},
            {"name": "Rainy", "slug": "rainy", "unmapped": True},
            {"name": "Snowy", "slug": "snowy", "unmapped": True},
        ],
    })
    assert labels == ["Sunny", "Rainy", "Snowy"]


def test_select_single_label_uses_highest_confidence_detection():
    detections = [
        {"label": "helmet", "confidence": 0.85},
        {"label": "vest", "confidence": 0.87},
    ]
    selected = InferenceLogic._select_classification_detections(detections, "Single-Label")
    assert selected == [{"label": "vest", "confidence": 0.87}]


def test_select_multi_label_keeps_all_instances():
    detections = [
        {"label": "helmet", "confidence": 0.85},
        {"label": "vest", "confidence": 0.87},
        {"label": "vest", "confidence": 0.72},
    ]
    selected = InferenceLogic._select_classification_detections(detections, "Multi-Label")
    assert [item["label"] for item in selected] == ["vest", "helmet", "vest"]


def test_classification_detection_model_ignores_classifier_weights():
    assert InferenceLogic.resolve_classification_detection_model_name("yolov8n-cls.pt") == "yolo26s.pt"
    assert InferenceLogic.resolve_classification_detection_model_name("custom-detector.pt") == "custom-detector.pt"
    assert InferenceLogic.resolve_classification_detection_model_name(
        "yolo26s.pt",
        classification_type="Multi-Label",
    ) == "yolov8m.pt"


class DummyTensor:
    def __init__(self, value):
        self._value = value

    def item(self):
        return self._value


class DummyArray:
    def __init__(self, values):
        self._values = values

    def tolist(self):
        return list(self._values)


class DummyBox:
    def __init__(self, cls_id=0, conf=0.92, xywhn=(0.5, 0.5, 0.25, 0.2)):
        self.cls = [DummyTensor(cls_id)]
        self.conf = [DummyTensor(conf)]
        self.xywhn = [DummyArray(xywhn)]


class DummyResult:
    names = {0: "helmet"}
    boxes = [DummyBox()]


class DummyModel:
    names = {0: "helmet"}

    def predict(self, *args, **kwargs):
        return [DummyResult()]


class FakeCollection:
    def __init__(self, find_one_result=None, find_results=None):
        self.find_one_result = find_one_result
        self.find_results = find_results or []
        self.inserted = []
        self.deleted_filters = []
        self.updates = []

    def find_one(self, query):
        return self.find_one_result

    def find(self, query):
        self.last_find_query = query
        return list(self.find_results)

    def delete_many(self, query):
        self.deleted_filters.append(query)

    def insert_many(self, docs):
        self.inserted.extend(docs)

    def update_one(self, query, update, upsert=False):
        self.updates.append((query, update, upsert))


class FakeDb:
    def __init__(self, asset=None, project=None, assets=None):
        self.assets = FakeCollection(asset, assets)
        self.projects = FakeCollection(project)
        self.annotations = FakeCollection()
        self.annotation_sessions = FakeCollection()
        self.jobs = FakeCollection()


def test_run_classification_labeling_persists_annotation(monkeypatch):
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/example.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Single-Label",
            "annotation_group_terms": [
                {"name": "Sunny", "slug": "sunny", "unmapped": True},
                {"name": "Rainy", "slug": "rainy", "unmapped": True},
                {"name": "Snowy", "slug": "snowy", "unmapped": True},
            ],
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(
        InferenceLogic,
        "classify_image_zero_shot",
        staticmethod(lambda *args, **kwargs: {
            "success": True,
            "labels": ["Sunny"],
            "scores": {"Sunny": 0.83, "Rainy": 0.12, "Snowy": 0.05},
            "model": "CLIP ViT-B/32",
            "classification_mode": "zero-shot",
        }),
    )

    result = InferenceLogic.run_classification_labeling(str(asset_oid), model_name="yolo26s.pt", confidence=0.5)

    assert result["success"] is True
    assert result["annotated_assets"] == 1
    assert result["count"] == 1
    assert len(fake_db.annotations.inserted) == 1
    assert fake_db.annotations.inserted[0]["asset_id"] == str(asset_oid)
    assert fake_db.annotations.inserted[0]["label"] == "Sunny"
    assert fake_db.annotations.inserted[0]["type"] == "tag"
    assert fake_db.annotations.inserted[0]["class_id"] == "Sunny"


def test_run_classification_labeling_allows_zero_detections(monkeypatch):
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    class EmptyModel:
        names = {0: "helmet"}

        def predict(self, *args, **kwargs):
            return [type("EmptyResult", (), {"names": self.names, "boxes": []})()]

    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/example.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Multi-Label",
            "annotation_group": "helmet",
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(InferenceLogic, "get_auto_label_model", classmethod(lambda cls, model_name=None, classes=None: EmptyModel()))
    monkeypatch.setattr(InferenceLogic, "_inference_runtime_options", staticmethod(lambda: {"device": "cpu", "batch": 1, "imgsz": 640, "half": False}))

    result = InferenceLogic.run_classification_labeling(str(asset_oid), model_name="yolo26s.pt", confidence=0.5)

    assert result["success"] is True
    assert result["annotated_assets"] == 0
    assert result["count"] == 0
    assert fake_db.annotations.inserted == []
    assert fake_db.assets.updates[-1][1]["$set"]["status"] == "unassigned"


def test_run_classification_labeling_single_label_ppe_persists_boxes(monkeypatch):
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    class PpeResult:
        names = {0: "helmet", 1: "vest", 2: "car"}
        boxes = [
            DummyBox(cls_id=0, conf=0.91, xywhn=(0.25, 0.25, 0.1, 0.1)),
            DummyBox(cls_id=1, conf=0.86, xywhn=(0.5, 0.5, 0.2, 0.2)),
            DummyBox(cls_id=2, conf=0.97, xywhn=(0.7, 0.7, 0.3, 0.3)),
        ]

    class PpeModel:
        names = PpeResult.names

        def predict(self, *args, **kwargs):
            self.kwargs = kwargs
            return [PpeResult()]

    ppe_model = PpeModel()
    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/example.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Single-Label",
            "annotation_group_terms": [
                {"name": "Safety Helmet", "slug": "safety helmet", "unmapped": True},
                {"name": "Safety Vest", "slug": "safety vest", "unmapped": True},
            ],
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(InferenceLogic, "get_auto_label_model", classmethod(lambda cls, model_name=None, classes=None: ppe_model))
    monkeypatch.setattr(InferenceLogic, "_classification_detection_runtime_options", staticmethod(lambda ppe_requested=False: {
        "device": "cpu", "batch": 1, "imgsz": 960, "half": False, "iou": 0.45, "augment": True, "max_det": 300
    }))

    result = InferenceLogic.run_classification_labeling(str(asset_oid), model_name="yolo26s.pt", confidence=0.5)

    assert result["success"] is True
    assert result["model"] == "yolov8m.pt"
    assert result["count"] == 2
    assert result["unmatched_classes"] == []
    assert [item["label"] for item in fake_db.annotations.inserted] == ["Safety Helmet", "Safety Vest"]
    assert all(item["type"] == "box" for item in fake_db.annotations.inserted)
    assert fake_db.annotations.inserted[0]["bbox"]["width"] == 0.1
    assert ppe_model.kwargs["conf"] == 0.2
    assert ppe_model.kwargs["augment"] is True


def test_run_assets_classification_labeling_rejects_empty_target_set():
    result = InferenceLogic.run_assets_classification_labeling([], model_name="yolo26s.pt")

    assert result["success"] is False
    assert result["asset_count"] == 0
    assert "No assets found" in result["error"]


def test_run_assets_classification_labeling_marks_all_failed_batch_unsuccessful(monkeypatch):
    monkeypatch.setattr(
        InferenceLogic,
        "run_classification_labeling",
        staticmethod(lambda *args, **kwargs: {"success": False, "error": "connection refused", "annotated_assets": 0, "count": 0}),
    )

    result = InferenceLogic.run_assets_classification_labeling(["asset-1", "asset-2"], model_name="yolo26s.pt")

    assert result["success"] is False
    assert result["asset_count"] == 2
    assert result["error"] == "connection refused"


def test_run_assets_classification_labeling_returns_annotations_for_canvas(monkeypatch):
    monkeypatch.setattr(
        InferenceLogic,
        "run_classification_labeling",
        staticmethod(lambda *args, **kwargs: {
            "success": True,
            "annotated_assets": 1,
            "count": 1,
            "classes": ["Helmet"],
            "model": "yolov8m.pt",
            "annotations": [
                {
                    "type": "box",
                    "label": "Helmet",
                    "x_center": 0.5,
                    "y_center": 0.5,
                    "width": 0.2,
                    "height": 0.2,
                    "confidence": 0.91,
                }
            ],
        }),
    )

    result = InferenceLogic.run_assets_classification_labeling(["asset-1"], model_name="yolo26s.pt")

    assert result["success"] is True
    assert result["model"] == "yolov8m.pt"
    assert result["results"][0]["annotations"][0]["type"] == "box"
    assert result["results"][0]["annotations"][0]["label"] == "Helmet"


def test_run_project_classification_labeling_rejects_empty_asset_query(monkeypatch):
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    project_oid = ObjectId()
    fake_db = FakeDb(
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Multi-Label",
            "annotation_group": "helmet",
        },
        assets=[],
    )
    monkeypatch.setattr(inference_module, "db", fake_db)

    with pytest.raises(ValueError, match="No assets found"):
        InferenceLogic.run_project_classification_labeling(str(project_oid), model_name="yolo26s.pt")


def test_run_classification_labeling_multi_label_persists_duplicate_class_boxes(monkeypatch):
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    class MultiBoxResult:
        names = {0: "helmet"}
        boxes = [
            DummyBox(cls_id=0, conf=0.91, xywhn=(0.25, 0.25, 0.1, 0.1)),
            DummyBox(cls_id=0, conf=0.82, xywhn=(0.75, 0.75, 0.2, 0.2)),
        ]

    class MultiBoxModel:
        names = {0: "helmet"}

        def predict(self, *args, **kwargs):
            return [MultiBoxResult()]

    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/example.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Multi-Label",
            "annotation_group": "helmet",
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(InferenceLogic, "get_auto_label_model", classmethod(lambda cls, model_name=None, classes=None: MultiBoxModel()))
    monkeypatch.setattr(InferenceLogic, "_inference_runtime_options", staticmethod(lambda: {"device": "cpu", "batch": 1, "imgsz": 640, "half": False}))

    result = InferenceLogic.run_classification_labeling(str(asset_oid), model_name="yolo26s.pt", confidence=0.5)

    assert result["success"] is True
    assert result["annotated_assets"] == 1
    assert result["count"] == 2
    assert [item["label"] for item in fake_db.annotations.inserted] == ["helmet", "helmet"]
    assert [item["x_center"] for item in fake_db.annotations.inserted] == [0.25, 0.75]
    assert all(item["type"] == "box" for item in fake_db.annotations.inserted)


def test_run_classification_labeling_multi_label_whitelists_annotation_group(monkeypatch):
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    class WhitelistResult:
        names = {0: "helmet", 1: "vest", 2: "car", 3: "dog"}
        boxes = [
            DummyBox(cls_id=0, conf=0.93, xywhn=(0.2, 0.2, 0.1, 0.1)),
            DummyBox(cls_id=1, conf=0.88, xywhn=(0.5, 0.5, 0.2, 0.2)),
            DummyBox(cls_id=2, conf=0.97, xywhn=(0.7, 0.7, 0.3, 0.3)),
            DummyBox(cls_id=3, conf=0.91, xywhn=(0.8, 0.8, 0.1, 0.1)),
        ]

    class WhitelistModel:
        names = WhitelistResult.names

        def predict(self, *args, **kwargs):
            return [WhitelistResult()]

    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/example.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Multi-Label",
            "annotation_group_terms": [
                {"name": "Helmet", "slug": "helmet", "unmapped": True},
                {"name": "Vest", "slug": "vest", "unmapped": True},
            ],
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(InferenceLogic, "get_auto_label_model", classmethod(lambda cls, model_name=None, classes=None: WhitelistModel()))
    monkeypatch.setattr(InferenceLogic, "_inference_runtime_options", staticmethod(lambda: {"device": "cpu", "batch": 1, "imgsz": 640, "half": False}))

    result = InferenceLogic.run_classification_labeling(str(asset_oid), model_name="yolo26s.pt", confidence=0.5)

    assert result["success"] is True
    assert result["model"] == "yolov8m.pt"
    assert result["count"] == 2
    assert [item["label"] for item in fake_db.annotations.inserted] == ["Helmet", "Vest"]
    assert all(item["type"] == "box" for item in fake_db.annotations.inserted)


# ===========================================================================
# REGRESSION TESTS
# Verify the PPE-vs-standard-classification routing split is correct.
# ===========================================================================


# ---------------------------------------------------------------------------
# Regression Test 1: Weather (Single-Label) → CLIP tag, NO boxes
# ---------------------------------------------------------------------------


def test_regression_weather_single_label_produces_tag_no_boxes(monkeypatch):
    """
    Weather project: Sunny / Cloudy / Rainy
    Expected:
      - Routes through CLIP zero-shot (not detector).
      - Persists a classification tag.
      - NO bounding boxes are produced.
      - ppe_requested is False.
    """
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/weather.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Single-Label",
            "annotation_group_terms": [
                {"name": "Sunny",  "slug": "sunny",  "unmapped": True},
                {"name": "Cloudy", "slug": "cloudy", "unmapped": True},
                {"name": "Rainy",  "slug": "rainy",  "unmapped": True},
            ],
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(
        InferenceLogic,
        "classify_image_zero_shot",
        staticmethod(lambda *args, **kwargs: {
            "success": True,
            "labels": ["Sunny"],
            "scores": {"Sunny": 0.88, "Cloudy": 0.08, "Rainy": 0.04},
            "model": "CLIP ViT-B/32",
            "classification_mode": "zero-shot",
        }),
    )

    result = InferenceLogic.run_classification_labeling(
        str(asset_oid), model_name="yolo26s.pt", confidence=0.5
    )

    assert result["success"] is True, result.get("error")
    assert result["count"] == 1
    assert result["annotated_assets"] == 1
    # Must be a tag, never a box
    for ann in fake_db.annotations.inserted:
        assert ann["type"] == "tag", f"Expected tag, got {ann['type']}"
    assert fake_db.annotations.inserted[0]["label"] == "Sunny"
    # The PPE branch must not have been triggered
    plan = InferenceLogic._classification_detection_plan(fake_db.projects.find_one_result)
    assert plan["ppe_requested"] is False


# ---------------------------------------------------------------------------
# Regression Test 2: Animal Multi-Label → detection boxes, NOT PPE model
# ---------------------------------------------------------------------------


def test_regression_animal_multi_label_produces_boxes_not_ppe(monkeypatch):
    """
    Animal project: Dog / Cat / Horse (Multi-Label)
    Expected:
      - Standard detection boxes (Multi-Label path).
      - PPE model is NOT activated.
      - ppe_requested is False.
    """
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    class AnimalResult:
        names = {0: "dog", 1: "cat", 2: "horse"}
        boxes = [
            DummyBox(cls_id=0, conf=0.91, xywhn=(0.3, 0.3, 0.15, 0.2)),
            DummyBox(cls_id=1, conf=0.85, xywhn=(0.6, 0.5, 0.1, 0.15)),
        ]

    class AnimalModel:
        names = AnimalResult.names

        def predict(self, *args, **kwargs):
            return [AnimalResult()]

    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/animals.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Multi-Label",
            "annotation_group_terms": [
                {"name": "Dog",   "slug": "dog",   "unmapped": False},
                {"name": "Cat",   "slug": "cat",   "unmapped": False},
                {"name": "Horse", "slug": "horse", "unmapped": False},
            ],
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(
        InferenceLogic,
        "get_auto_label_model",
        classmethod(lambda cls, model_name=None, classes=None: AnimalModel()),
    )
    monkeypatch.setattr(
        InferenceLogic,
        "_inference_runtime_options",
        staticmethod(lambda: {"device": "cpu", "batch": 1, "imgsz": 768, "half": False}),
    )

    result = InferenceLogic.run_classification_labeling(
        str(asset_oid), model_name="yolo26s.pt", confidence=0.5
    )

    assert result["success"] is True, result.get("error")
    assert result["count"] == 2
    # All annotations are bounding boxes
    for ann in fake_db.annotations.inserted:
        assert ann["type"] == "box", f"Expected box, got {ann['type']}"
    labels = {ann["label"] for ann in fake_db.annotations.inserted}
    assert "Dog" in labels
    assert "Cat" in labels
    # PPE must not be triggered
    plan = InferenceLogic._classification_detection_plan(fake_db.projects.find_one_result)
    assert plan["ppe_requested"] is False


# ---------------------------------------------------------------------------
# Regression Test 3: PPE Multi-Label → PPE model, boxes, original names kept
# ---------------------------------------------------------------------------


def test_regression_ppe_multi_label_produces_boxes_with_original_names(monkeypatch):
    """
    PPE project: Helmet / Safety Helmet / Vest / Safety Vest (Multi-Label)
    Expected:
      - PPE model (yolov8m.pt) activated.
      - Bounding boxes generated.
      - Original user-entered labels preserved (NOT normalised "helmet"/"vest").
      - unmatched_classes is empty.
      - ppe_requested is True.
    """
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    class PpeResult:
        names = {0: "helmet", 1: "vest"}
        boxes = [
            DummyBox(cls_id=0, conf=0.93, xywhn=(0.25, 0.20, 0.12, 0.10)),
            DummyBox(cls_id=1, conf=0.88, xywhn=(0.50, 0.55, 0.18, 0.22)),
        ]

    class PpeModel:
        names = PpeResult.names

        def predict(self, *args, **kwargs):
            self.last_kwargs = kwargs
            return [PpeResult()]

    ppe_model = PpeModel()
    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/workers.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Multi-Label",
            "annotation_group_terms": [
                {"name": "Helmet",        "slug": "helmet",       "unmapped": True},
                {"name": "Safety Helmet", "slug": "safety helmet","unmapped": True},
                {"name": "Vest",          "slug": "vest",         "unmapped": True},
                {"name": "Safety Vest",   "slug": "safety vest",  "unmapped": True},
            ],
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(
        InferenceLogic,
        "get_auto_label_model",
        classmethod(lambda cls, model_name=None, classes=None: ppe_model),
    )
    monkeypatch.setattr(
        InferenceLogic,
        "_classification_detection_runtime_options",
        staticmethod(lambda ppe_requested=False: {
            "device": "cpu", "batch": 1, "imgsz": 960, "half": False,
            "iou": 0.45, "augment": True, "max_det": 300,
        }),
    )

    result = InferenceLogic.run_classification_labeling(
        str(asset_oid), model_name="yolo26s.pt", confidence=0.5
    )

    assert result["success"] is True, result.get("error")
    # PPE model must have been selected
    assert result["model"] == "yolov8m.pt"
    assert result["count"] == 2
    assert result["unmatched_classes"] == []
    for ann in fake_db.annotations.inserted:
        assert ann["type"] == "box"
        assert "bbox" in ann
    # Original display names must be preserved (first-seen canonical wins per target_key)
    labels_stored = {ann["label"] for ann in fake_db.annotations.inserted}
    assert labels_stored == {"Helmet", "Vest"}
    # PPE plan flag
    plan = InferenceLogic._classification_detection_plan(fake_db.projects.find_one_result)
    assert plan["ppe_requested"] is True


# ---------------------------------------------------------------------------
# Regression Test 4: Mixed (Person + PPE) → PPE path, boxes for all classes
# ---------------------------------------------------------------------------


def test_regression_mixed_person_ppe_produces_boxes(monkeypatch):
    """
    Mixed project: Person / Helmet / Safety Vest (Multi-Label)
    Expected:
      - PPE path triggered because PPE classes are present.
      - Bounding boxes for all three classes.
      - Person label preserved as-is.
    """
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    class MixedResult:
        names = {0: "person", 1: "helmet", 2: "vest"}
        boxes = [
            DummyBox(cls_id=0, conf=0.95, xywhn=(0.5, 0.5, 0.4, 0.8)),
            DummyBox(cls_id=1, conf=0.90, xywhn=(0.5, 0.2, 0.12, 0.12)),
            DummyBox(cls_id=2, conf=0.87, xywhn=(0.5, 0.55, 0.20, 0.30)),
        ]

    class MixedModel:
        names = MixedResult.names

        def predict(self, *args, **kwargs):
            return [MixedResult()]

    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/site.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Multi-Label",
            "annotation_group_terms": [
                {"name": "Person",      "slug": "person",      "unmapped": False},
                {"name": "Helmet",      "slug": "helmet",      "unmapped": True},
                {"name": "Safety Vest", "slug": "safety vest", "unmapped": True},
            ],
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(
        InferenceLogic,
        "get_auto_label_model",
        classmethod(lambda cls, model_name=None, classes=None: MixedModel()),
    )
    monkeypatch.setattr(
        InferenceLogic,
        "_classification_detection_runtime_options",
        staticmethod(lambda ppe_requested=False: {
            "device": "cpu", "batch": 1, "imgsz": 960, "half": False,
            "iou": 0.45, "augment": True, "max_det": 300,
        }),
    )

    result = InferenceLogic.run_classification_labeling(
        str(asset_oid), model_name="yolo26s.pt", confidence=0.5
    )

    assert result["success"] is True, result.get("error")
    assert result["count"] == 3
    for ann in fake_db.annotations.inserted:
        assert ann["type"] == "box"
    labels_stored = {ann["label"] for ann in fake_db.annotations.inserted}
    assert "Person" in labels_stored
    assert "Helmet" in labels_stored
    assert "Safety Vest" in labels_stored
    plan = InferenceLogic._classification_detection_plan(fake_db.projects.find_one_result)
    assert plan["ppe_requested"] is True


# ---------------------------------------------------------------------------
# Regression Test 5: Unknown class → no fake boxes, unmatched_classes populated
# ---------------------------------------------------------------------------


def test_regression_unknown_class_returns_unmatched_no_fake_boxes(monkeypatch):
    """
    Project contains only "Alien Helmet" which has no PPE alias mapping and the
    model returns zero detections.
    Expected:
      - No fabricated bounding boxes.
      - unmatched_classes contains "Alien Helmet".
      - success is True (the inference ran correctly, just nothing matched).
    """
    from bson.objectid import ObjectId
    import services.inference_service as inference_module

    class EmptyResult:
        names = {0: "helmet", 1: "vest"}
        boxes = []  # model finds nothing for an unknown class

    class EmptyModel:
        names = EmptyResult.names

        def predict(self, *args, **kwargs):
            return [EmptyResult()]

    asset_oid = ObjectId()
    project_oid = ObjectId()
    fake_db = FakeDb(
        asset={"_id": asset_oid, "project_id": str(project_oid), "url": "/uploads/alien.jpg"},
        project={
            "_id": project_oid,
            "project_type": "Classification",
            "classification_type": "Multi-Label",
            "annotation_group_terms": [
                {"name": "Alien Helmet", "slug": "alien helmet", "unmapped": True},
            ],
        },
    )
    monkeypatch.setattr(inference_module, "db", fake_db)
    monkeypatch.setattr(InferenceLogic, "_resolve_asset_source", staticmethod(lambda asset: "dummy.jpg"))
    monkeypatch.setattr(
        InferenceLogic,
        "get_auto_label_model",
        classmethod(lambda cls, model_name=None, classes=None: EmptyModel()),
    )
    monkeypatch.setattr(
        InferenceLogic,
        "_inference_runtime_options",
        staticmethod(lambda: {"device": "cpu", "batch": 1, "imgsz": 768, "half": False}),
    )

    result = InferenceLogic.run_classification_labeling(
        str(asset_oid), model_name="yolo26s.pt", confidence=0.5
    )

    assert result["success"] is True, result.get("error")
    # No fake annotations must have been fabricated
    assert result["count"] == 0
    assert fake_db.annotations.inserted == []
    # The unrecognised class must be reported
    assert "Alien Helmet" in result.get("unmatched_classes", [])
