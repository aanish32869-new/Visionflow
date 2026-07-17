from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')
db = client['visionflow']
anns = list(db.annotations.find().sort('_id', -1).limit(15))
print('Last 15 annotations:')
for a in anns:
    print(f'  label={a.get("label")} project_id={a.get("project_id")} type={a.get("type")} asset_id={a.get("asset_id")}')
