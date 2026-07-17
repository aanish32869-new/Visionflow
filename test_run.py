import sys, traceback
sys.path.insert(0, 'services/inference_service')
from services.inference_service import InferenceLogic
from pymongo import MongoClient
client = MongoClient('mongodb://localhost:27017/')
db = client['visionflow']
InferenceLogic.db = db

demo_proj = db.projects.find_one({'name': 'demo'})
for asset in db.assets.find({'project_id': str(demo_proj['_id'])}):
    db.assets.update_one({'_id': asset['_id']}, {'$set': {'is_annotated': False, 'annotation_count': 0}})

assets = list(db.assets.find({'project_id': str(demo_proj['_id'])}).limit(2))
asset_ids = [str(a['_id']) for a in assets]

import ultralytics
orig_predict = ultralytics.YOLO.predict

def custom_predict(self, source, *args, **kwargs):
    print('Predicting on:', source)
    try:
        return orig_predict(self, source, *args, **kwargs)
    except Exception as e:
        traceback.print_exc()
        raise e

ultralytics.YOLO.predict = custom_predict
InferenceLogic.run_assets_classification_labeling(asset_ids, model_name='yolo26s.pt', confidence=0.15)
