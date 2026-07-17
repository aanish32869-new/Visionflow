import sys, json
sys.path.insert(0, 'services/inference_service')
from services.inference_service import InferenceLogic
from pymongo import MongoClient
client = MongoClient('mongodb://localhost:27017/')
db = client['visionflow']
InferenceLogic.db = db

demo_proj = db.projects.find_one({'name': 'demo'})
assets = list(db.assets.find({'project_id': str(demo_proj['_id'])}).limit(3))
asset_ids = [str(a['_id']) for a in assets]

for asset in assets:
    db.assets.update_one({'_id': asset['_id']}, {'$set': {'is_annotated': False, 'annotation_count': 0}})

res = InferenceLogic.run_assets_classification_labeling(asset_ids, model_name='yolo26s.pt', confidence=0.15)
for r in res.get('results', []):
    print(r.get('asset_id'), r.get('success'), r.get('error'))
