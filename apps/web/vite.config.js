import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function loadVisionflowConfig() {
  const configPath = path.resolve(__dirname, '../../visionflow.conf')
  if (!fs.existsSync(configPath)) {
    return {}
  }

  const config = {}
  let inVisionflowSection = false

  for (const rawLine of fs.readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      inVisionflowSection = line.toLowerCase() === '[visionflow]'
      continue
    }

    if (!inVisionflowSection) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim().toUpperCase()
    const value = line.slice(separatorIndex + 1).trim()
    config[key] = value
  }

  return config
}

const visionflowConfig = loadVisionflowConfig()
const authTarget = `http://localhost:${Number(visionflowConfig.PORT_AUTH_SERVICE || 5001)}`
const datasetTarget = `http://localhost:${Number(visionflowConfig.PORT_DATASET_SERVICE || 5003)}`
const projectTarget = `http://localhost:${Number(visionflowConfig.PORT_PROJECT_SERVICE || 5004)}`
const trainingTarget = `http://localhost:${Number(visionflowConfig.PORT_TRAINING_SERVICE || 5005)}`
const inferenceTarget = `http://localhost:${Number(visionflowConfig.PORT_INFERENCE_SERVICE || 5006)}`
const notificationTarget = `http://localhost:${Number(visionflowConfig.PORT_NOTIFICATION_SERVICE || 5009)}`
const notificationsEnabled = String(visionflowConfig.NOTIFICATIONS_ENABLED ?? 'true').toLowerCase() !== 'false'
const ppeMultiLabelModel = String(visionflowConfig.PPE_MULTI_LABEL_MODEL || 'yolov8m.pt')

const createProxy = (target) => ({
  target,
  changeOrigin: true,
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_NOTIFICATIONS_ENABLED': JSON.stringify(String(notificationsEnabled)),
    'import.meta.env.VITE_PPE_MULTI_LABEL_MODEL': JSON.stringify(ppeMultiLabelModel),
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      // Route directly to backend services so `npm run dev` in `apps/web`
      // works even when the optional local gateway on port 5000 is not running.
      '^/api/(signup|login)(?:$|[/?])': createProxy(authTarget),
      
      // Inference Service. Keep the concrete infer route before the generic
      // project model registry route below.
      '^/api/projects/[^/]+/models/[^/]+/infer(?:$|[/?])': createProxy(inferenceTarget),
      '^/api/projects/[^/]+/infer-batch(?:$|[/?])': createProxy(inferenceTarget),
      '^/api/projects/[^/]+/inference-history(?:$|[/?])': createProxy(inferenceTarget),
      '^/api/kpi/inference-stream(?:$|[/?])': createProxy(inferenceTarget),
      '^/api/(auto-label|classify|infer(?:/.*)?)(?:$|[/?])': createProxy(inferenceTarget),

      // Notification Service
      '^/api/notifications(?:$|[/?])': createProxy(notificationTarget),

      // Training Service (Registry, Jobs, Config)
      '^/api/training(?:$|[/?])': createProxy(trainingTarget),
      '^/api/models(?:$|[/?])': createProxy(trainingTarget),
      '^/api/projects/[^/]+/(train|jobs)(?:$|[/?])': createProxy(trainingTarget),
      '^/api/projects/[^/]+/models(?:$|[/?])': createProxy(trainingTarget),
      
      // Dataset Service
      '^/api/projects/[^/]+/(versions|annotation-status|dataset|analytics)(?:$|[/?])': createProxy(datasetTarget),
      '^/api/versions(?:$|[/?])': createProxy(datasetTarget),
      '^/api/annotations(?:$|[/?])': createProxy(datasetTarget),
      '^/api/batches/[^/]+/export(?:$|[/?])': createProxy(datasetTarget),
      '^/api/projects/[^/]+/dataset/export(?:$|[/?])': createProxy(datasetTarget),
      '^/api/projects/[^/]+/export-dataset(?:$|[/?])': createProxy(datasetTarget),
      '^/api/dataset/exports(?:$|[/?])': createProxy(datasetTarget),
      
      // Project Service (Node)
      '^/api/annotation-groups(?:$|[/?])': createProxy(projectTarget),
      '^/api/(projects|assets|folders|workspace-overview|jobs|batches|deployments|workflows|system-metrics)(?:$|[/?])': createProxy(projectTarget),
      '^/api/kpi/live/stream(?:$|[/?])': createProxy(projectTarget),
      '/uploads': createProxy(projectTarget),
      '/datasets': createProxy(datasetTarget),
    },
  },
})
