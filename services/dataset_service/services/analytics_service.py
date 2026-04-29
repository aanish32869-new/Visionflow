import numpy as np
from models.db import db
from utils.logger import logger

class AnalyticsService:
    @staticmethod
    def get_class_distribution(project_id):
        """
        Calculates frequency of each class in the project.
        """
        pipeline = [
            {"$match": {"project_id": project_id}},
            {"$group": {"_id": "$label", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}
        ]
        results = list(db.annotations.aggregate(pipeline))
        return {r["_id"]: r["count"] for r in results if r["_id"]}

    @staticmethod
    def get_spatial_heatmap(project_id, grid_size=20):
        """
        Generates a 2D density map of object centers.
        """
        annotations = list(db.annotations.find(
            {"project_id": project_id, "x_center": {"$exists": True}, "y_center": {"$exists": True}},
            {"x_center": 1, "y_center": 1}
        ))
        
        heatmap = np.zeros((grid_size, grid_size), dtype=int)
        for ann in annotations:
            x = min(int(ann["x_center"] * grid_size), grid_size - 1)
            y = min(int(ann["y_center"] * grid_size), grid_size - 1)
            heatmap[y][x] += 1
            
        return heatmap.tolist()

    @staticmethod
    def get_negative_samples(project_id):
        """
        Identifies assets with no annotations.
        """
        # Find all asset IDs for the project
        all_assets = list(db.assets.find({"project_id": project_id}, {"_id": 1}))
        all_ids = [str(a["_id"]) for a in all_assets]
        
        # Find IDs of assets with annotations
        annotated_ids = db.annotations.distinct("asset_id", {"project_id": project_id})
        
        # Negatives = Total - Annotated
        negative_ids = list(set(all_ids) - set(annotated_ids))
        
        return {
            "total": len(all_ids),
            "negative_count": len(negative_ids),
            "negative_ratio": round(len(negative_ids) / len(all_ids), 4) if all_ids else 0,
            "negative_sample_ids": negative_ids[:100] # Limit for response size
        }

    @staticmethod
    def get_health_score(project_id):
        """
        Calculates an overall health score (0-100) based on:
        - Class balance (Shannon Entropy)
        - Annotation coverage
        - Negative sample ratio (ideal is 5-15%)
        """
        dist = AnalyticsService.get_class_distribution(project_id)
        negatives = AnalyticsService.get_negative_samples(project_id)
        
        if not dist:
            return {"score": 0, "status": "No data"}
            
        # 1. Balance Score
        counts = list(dist.values())
        total_anns = sum(counts)
        probs = [c / total_anns for c in counts]
        entropy = -sum(p * np.log2(p) for p in probs)
        max_entropy = np.log2(len(counts)) if len(counts) > 1 else 1
        balance_score = (entropy / max_entropy) * 100 if max_entropy > 0 else 100
        
        # 2. Coverage Score (how many images are annotated)
        coverage_score = (1 - negatives["negative_ratio"]) * 100
        
        # 3. Negative Sample Ratio Score
        # Penalty if outside 5-15% range
        ratio = negatives["negative_ratio"]
        if 0.05 <= ratio <= 0.15:
            neg_score = 100
        else:
            neg_score = max(0, 100 - abs(ratio - 0.1) * 200)
            
        final_score = (balance_score * 0.4) + (coverage_score * 0.4) + (neg_score * 0.2)
        
        return {
            "score": round(final_score, 2),
            "components": {
                "balance": round(balance_score, 2),
                "coverage": round(coverage_score, 2),
                "negatives": round(neg_score, 2)
            },
            "recommendations": AnalyticsService._get_recommendations(balance_score, coverage_score, ratio)
        }

    @staticmethod
    def _get_recommendations(balance, coverage, neg_ratio):
        recs = []
        if balance < 60:
            recs.append("Class imbalance detected. Consider collecting more data for rare classes.")
        if coverage < 80:
            recs.append("High number of unannotated images. Finish labeling to improve model recall.")
        if neg_ratio < 0.05:
            recs.append("Too few negative samples. Add more background images to reduce false positives.")
        elif neg_ratio > 0.20:
            recs.append("Too many negative samples. Ensure you haven't missed annotations in your data.")
        return recs
