import { useAnnotation, COLORS } from '../AnnotationContext';
import logger from '../../../utils/logger';

export function useAnnotationAPI() {
  const {
    projectId, currentAsset, setAnnotations, setClasses, setLockAnnotationClasses,
    setActiveClassIdx, annotations, updateAsset, showFeedback, setIsSaving,
    setShowSaveToast, setFeedback, isClassification, classificationType,
    classes, lockAnnotationClasses, autoLabelModel, autoLabelAll, confidenceThreshold,
    setShowAutoLabelConflict, setPendingAutoLabelData, setAutoLabelDetectedClasses
  } = useAnnotation();

  const fetchProjectLabels = async () => {
    if (!projectId) return;
    logger.debug(`Fetching project labels for ${projectId}...`);
    try {
      const res = await fetch(`/api/projects/${projectId}/classes-tags`);
      if (!res.ok) {
        logger.error(`Failed to fetch project labels: ${res.status}`);
        return;
      }
      const data = await res.json();
      const nextClasses = Array.isArray(data.classes) ? data.classes : [];
      logger.info(`Loaded ${nextClasses.length} annotation classes`);
      setClasses(nextClasses.map((item, index) => ({
        name: item.name,
        color: item.color || COLORS[index % COLORS.length],
        attributes: item.attributes || [],
      })));
      setLockAnnotationClasses(Boolean(data.settings?.lock_annotation_classes));
      setActiveClassIdx(0);
    } catch (err) {
      logger.error("Error fetching project labels", err);
    }
  };

  const fetchAnnotations = async (assetId) => {
    if (!assetId) return;
    try {
      const res = await fetch(`/api/annotations/${assetId}`);
      if (res.ok) {
        const data = await res.json();
        // data contains { asset, annotations, classes }
        setAnnotations(data.annotations || []);
        // Optionally update classes if they changed, though they are usually project-wide
        if (Array.isArray(data.classes) && data.classes.length > 0) {
           setClasses(data.classes.map((item, index) => ({
             name: item.name,
             color: item.color || COLORS[index % COLORS.length],
             attributes: item.attributes || [],
           })));
        }
      } else {
        logger.error(`Failed to fetch annotations for ${assetId}: ${res.status}`);
        setAnnotations([]); // Fallback to empty
        showFeedback("Failed to load annotations.", "error");
      }
    } catch (err) {
      logger.error(`Error fetching annotations for ${assetId}`, err);
      setAnnotations([]); // Fallback
      showFeedback("Network error loading annotations.", "error");
    }
  };

  const ensureProjectClasses = async (classNames) => {
    const normalizedNames = [...new Set((classNames || []).map((item) => String(item || "").trim()).filter(Boolean))];
    if (!normalizedNames.length) return classes;

    let nextClasses = [...classes];
    for (const className of normalizedNames) {
      if (nextClasses.some((item) => item.name.toLowerCase() === className.toLowerCase())) continue;
      if (lockAnnotationClasses) continue;

      const res = await fetch(`/api/projects/${projectId}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: className }),
      });

      if (res.ok) {
        const data = await res.json();
        const serverClasses = Array.isArray(data.classes) ? data.classes : [];
        nextClasses = serverClasses.map((item, index) => ({
          name: item.name,
          color: item.color || COLORS[index % COLORS.length],
          attributes: item.attributes || [],
        }));
        setClasses(nextClasses);
      }
    }
    return nextClasses;
  };

  const saveAnnotations = async () => {
    if (!currentAsset) return false;
    logger.info(`Saving ${annotations.length} annotations for asset ${currentAsset.id}`);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/assets/${currentAsset.id}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations })
      });
      if (!res.ok) {
        const errorData = await res.json();
        logger.error(`Failed to save annotations for ${currentAsset.id}: ${res.status}`, errorData);
        throw new Error(errorData.error || "Failed to save annotations.");
      }
      logger.info(`Successfully saved annotations for ${currentAsset.id}`);
    } catch (err) {
      logger.error(`Error in saveAnnotations for ${currentAsset.id}`, err);
      showFeedback(err.message || "Failed to save annotations.");
      setIsSaving(false);
      return false;
    }
    
    if (typeof updateAsset === 'function') {
       updateAsset(currentAsset.id, annotations.length > 0);
    }
    
    setShowSaveToast(true);
    setTimeout(() => setShowSaveToast(false), 2000);
    setFeedback({ message: "Annotations saved.", type: "success" });
    setIsSaving(false);
    return true;
  };

  const handleAutoLabel = async (mode = null) => {
    if (!autoLabelAll && classes.length === 0) {
      showFeedback("Please define project classes first, or enable Detect All for open-vocabulary detection.");
      return;
    }

    if (annotations.length > 0 && !mode) {
       setShowAutoLabelConflict(true);
       return;
    }

    const activeQueryList = autoLabelAll ? [] : classes.map(c => c.name);
    setIsSaving(true);
    try {
      const endpoint = isClassification ? "/api/classify" : "/api/auto-label";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: currentAsset.url,
          model: autoLabelModel,
          queries: activeQueryList,
          auto_label_all: autoLabelAll,
          conf: confidenceThreshold
        })
      });

      if (!res.ok) throw new Error("Backend auto-label failed");

      const data = await res.json();
      if (isClassification) {
        if (data.success && Array.isArray(data.labels) && data.labels.length > 0) {
          const selectedLabels = classificationType === "Single-Label" ? [data.labels[0]] : data.labels;
          let updatedClasses = await ensureProjectClasses(selectedLabels);
          const newAnnotations = selectedLabels.map(label => {
            const clObj = updatedClasses.find(c => c.name.toLowerCase() === label.toLowerCase());
            return { type: 'tag', label: clObj.name, color: clObj.color };
          });
          setAnnotations(newAnnotations);
          setAutoLabelDetectedClasses(selectedLabels);
          showFeedback("Classification labels suggested.", "success");
        }
      } else {
        const incoming = Array.isArray(data.detections) ? data.detections : [];
        const mapped = incoming.map(det => ({
            type: det.type || 'box',
            label: det.label,
            bbox: det.bbox,
            points: det.points,
            x_center: det.x_center, y_center: det.y_center,
            width: det.width, height: det.height,
            confidence: det.confidence,
            color: classes.find(c => c.name.toLowerCase() === det.label.toLowerCase())?.color || COLORS[0]
        }));
        setAnnotations(mode === 'append' ? [...annotations, ...mapped] : mapped);
        showFeedback(`Added ${mapped.length} suggestions.`, "success");
      }
      setShowAutoLabelConflict(false);
      setPendingAutoLabelData(null);
    } catch (err) {
      console.error(err);
      showFeedback("AI labeling failed.");
    }
    setIsSaving(false);
  };

  return {
    fetchProjectLabels,
    fetchAnnotations,
    ensureProjectClasses,
    saveAnnotations,
    handleAutoLabel
  };
}
