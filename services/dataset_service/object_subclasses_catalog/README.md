Split object subclass catalog for `multi_model_detector.py`.

Guidelines:
- Keep each file as a single JSON object mapping root object names to grouped aliases.
- Root object names must be unique across all `.json` files in this folder.
- Prefer adding new objects to the closest domain file instead of `misc.json`.
- The detector loads all `.json` files in this folder in sorted order.
- If this folder is missing or invalid, the detector falls back to `object_subclasses.json`.
