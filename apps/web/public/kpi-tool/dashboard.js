'use strict';

const HISTORY_LEN = 24;
const SNAPSHOT_CACHE_KEY = 'visionflow_kpi_snapshot_cache_v1';
const TELEMETRY_SESSION_KEY = 'visionflow_kpi_session_id_v1';
const TELEMETRY_VISITOR_KEY = 'visionflow_kpi_visitor_id_v1';
const METRIC_DEFS = [
  {
    key: 'traffic',
    name: 'TrafficTool',
    unit: 'hits/min',
    color: '#38bdf8',
    warningThreshold: 1.0,
    criticalThreshold: 0.1,
    higherIsWorse: false,
    description: 'Records page hits with timestamps and reports total hits, hits per minute, hits per hour, and unique visitors.',
  },
  {
    key: 'uptime',
    name: 'UptimeTool',
    unit: '%',
    color: '#2dd4bf',
    warningThreshold: 99.9,
    criticalThreshold: 99.0,
    higherIsWorse: false,
    description: 'Records health-check pings and reports the percentage of successful checks.',
  },
  {
    key: 'cpu',
    name: 'CPU',
    unit: '%',
    color: '#60a5fa',
    warningThreshold: 70.0,
    criticalThreshold: 90.0,
    higherIsWorse: true,
    description: 'Live host CPU utilization from the system metrics stream.',
  },
  {
    key: 'bounce_rate',
    name: 'BounceRateTool',
    unit: '%',
    color: '#fb7185',
    warningThreshold: 40.0,
    criticalThreshold: 60.0,
    higherIsWorse: true,
    description: 'Records session events and calculates single-page sessions divided by total sessions.',
  },
  {
    key: 'conversion_rate',
    name: 'ConversionRateTool',
    unit: '%',
    color: '#a78bfa',
    warningThreshold: 3.0,
    criticalThreshold: 1.0,
    higherIsWorse: false,
    description: 'Records visit and conversion events and calculates conversions divided by total visits.',
  },
  {
    key: 'error_rate',
    name: 'ErrorRateTool',
    unit: '%',
    color: '#fb923c',
    warningThreshold: 5.0,
    criticalThreshold: 10.0,
    higherIsWorse: true,
    description: 'Records HTTP responses with status codes and calculates 4xx and 5xx responses over total responses.',
  },
  {
    key: 'response_time',
    name: 'ResponseTimeTool',
    unit: 'ms (p95)',
    color: '#f59e0b',
    warningThreshold: 500,
    criticalThreshold: 1000,
    higherIsWorse: true,
    description: 'Records request durations and reports average, median, P95, P99, minimum, and maximum response time.',
  },
  {
    key: 'page_load_time',
    name: 'PageLoadTimeTool',
    unit: 'ms (avg)',
    color: '#f472b6',
    warningThreshold: 3000,
    criticalThreshold: 5000,
    higherIsWorse: true,
    description: 'Records full page load durations including assets and reports average, median, P95, and P99 load time.',
  },
  {
    key: 'user_engagement',
    name: 'UserEngagementTool',
    unit: 'score',
    color: '#34d399',
    warningThreshold: 40.0,
    criticalThreshold: 20.0,
    higherIsWorse: false,
    description: 'Records session events and calculates a composite score from session duration, pages per session, and interaction rate.',
  },
];

const state = {
  metrics: {},
  lastSnapshot: null,
  activeDetail: null,
  requestTimings: [],
  refreshInFlight: false,
  refreshQueued: false,
  projectKpiSource: null,
  inferenceKpiSource: null,
  systemMetricsSource: null,
};
const telemetryState = {
  startedAt: Date.now(),
  interactions: 0,
};

const DEFAULT_PROJECT_API_BASE = 'http://localhost:5004';
const DEFAULT_INFERENCE_API_BASE = 'http://localhost:5006';
const STATIC_FILE_PROTOCOL = window.location.protocol === 'file:';

function getServiceBase(service = 'project') {
  const configured = service === 'inference'
    ? window.__VISIONFLOW_INFERENCE_API_BASE__
    : window.__VISIONFLOW_PROJECT_API_BASE__;
  if (configured) return String(configured).replace(/\/$/, '');
  if (STATIC_FILE_PROTOCOL) {
    return service === 'inference' ? DEFAULT_INFERENCE_API_BASE : DEFAULT_PROJECT_API_BASE;
  }
  return '';
}

function resolveApiUrl(path, service = 'project') {
  const raw = String(path || '');
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = getServiceBase(service);
  if (!base) return raw;
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function makeEmptyMetric(def) {
  return {
    current: 0,
    history: Array.from({ length: HISTORY_LEN }, () => 0),
    status: 'no_data',
    details: {},
    samples: 0,
    def,
  };
}

function fmtTime(value) {
  return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString('en-US');
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getStoredTelemetryId(key) {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch (_error) {
    return crypto.randomUUID();
  }
}

function getTelemetrySessionId() {
  return getStoredTelemetryId(TELEMETRY_SESSION_KEY);
}

function getTelemetryVisitorId() {
  return getStoredTelemetryId(TELEMETRY_VISITOR_KEY);
}

function getTelemetryHeaders() {
  return {
    'X-Visionflow-Session': getTelemetrySessionId(),
    'X-Visionflow-Visitor': getTelemetryVisitorId(),
    'X-Visionflow-Source': 'kpi-tool',
  };
}

function registerTelemetryInteraction() {
  telemetryState.interactions += 1;
}

function sendTelemetryEvent(event) {
  const payload = JSON.stringify({
    ...event,
    session_id: getTelemetrySessionId(),
    visitor_id: getTelemetryVisitorId(),
    source: 'kpi-tool',
    ts: Date.now(),
  });
  const blob = new Blob([payload], { type: 'application/json' });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(resolveApiUrl('/api/kpi/events'), blob);
    return;
  }
  fetch(resolveApiUrl('/api/kpi/events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getTelemetryHeaders() },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(String(value).replace('Z', '+00:00'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function percentile(sortedValues, pct) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * (pct / 100);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sortedValues[low];
  return sortedValues[low] * (high - index) + sortedValues[high] * (index - low);
}

function formatMetricNumber(value, digits = 2) {
  if (Number.isFinite(value)) return value.toFixed(digits);
  if (digits <= 0) return '0';
  return `0.${'0'.repeat(digits)}`;
}

function deriveStatus(def, value, sampleCount) {
  if (!sampleCount) return 'no_data';
  if (def.higherIsWorse) {
    if (value >= def.criticalThreshold) return 'critical';
    if (value >= def.warningThreshold) return 'warning';
    return 'good';
  }
  if (value <= def.criticalThreshold) return 'critical';
  if (value <= def.warningThreshold) return 'warning';
  return 'good';
}

function measurePageLoadMs() {
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) {
    return Math.max(0, nav.loadEventEnd - nav.startTime);
  }
  if (performance.timing) {
    const t = performance.timing;
    return Math.max(0, t.loadEventEnd - t.navigationStart);
  }
  return 0;
}

async function fetchJSON(url, label, service = 'project') {
  const started = performance.now();
  try {
    const response = await fetch(resolveApiUrl(url, service), {
      cache: 'no-store',
      headers: getTelemetryHeaders(),
    });
    const durationMs = performance.now() - started;
    state.requestTimings.push({ label, ok: response.ok, durationMs });
    if (!response.ok) {
      return { ok: false, status: response.status, data: null, durationMs };
    }
    const data = await response.json();
    return { ok: true, status: response.status, data, durationMs };
  } catch (error) {
    const durationMs = performance.now() - started;
    state.requestTimings.push({ label, ok: false, durationMs });
    return { ok: false, status: 0, data: null, durationMs, error };
  }
}

function loadSnapshotCache() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function saveSnapshotCache(metrics) {
  try {
    localStorage.setItem(
      SNAPSHOT_CACHE_KEY,
      JSON.stringify({
        updatedAt: Date.now(),
        metrics,
      })
    );
  } catch (_error) {}
}

async function collectSnapshot() {
  state.requestTimings = [];
  const [workspaceRes, deploymentsRes, jobsRes, systemRes] = await Promise.all([
    fetchJSON('/api/workspace-overview', 'workspace-overview'),
    fetchJSON('/api/deployments/summary', 'deployments-summary'),
    fetchJSON('/api/jobs', 'jobs'),
    fetchJSON('/api/system-metrics', 'system-metrics'),
  ]);

  const workspace = workspaceRes.data || {};
  const deployments = deploymentsRes.data || {};
  const jobs = Array.isArray(jobsRes.data) ? jobsRes.data : [];
  const system = systemRes.data || {};
  const projects = Array.isArray(workspace.projects) ? workspace.projects : [];
  const deploymentItems = Array.isArray(deployments.deployments) ? deployments.deployments : [];
  const projectIds = projects.map((project) => project.id).filter(Boolean).slice(0, 5);

  const inferenceResults = await Promise.all(
    projectIds.map((projectId) =>
      fetchJSON(`/api/projects/${encodeURIComponent(projectId)}/inference-history?limit=20`, `inference-${projectId}`, 'inference')
    )
  );
  const inferenceHistory = inferenceResults
    .flatMap((result) => {
      const history = result.data?.history;
      return Array.isArray(history) ? history : [];
    })
    .filter(Boolean);

  const loadMs = measurePageLoadMs();
  const apiTimings = state.requestTimings.map((entry) => entry.durationMs);
  const allTimings = inferenceHistory
    .map((item) => safeNum(item.time, 0) * 1000)
    .filter((value) => Number.isFinite(value) && value > 0)
    .concat(apiTimings.filter((value) => Number.isFinite(value) && value > 0));

  const timestamps = [
    ...projects.map((item) => parseTimestamp(item.updated_at || item.created_at || item.updated)),
    ...deploymentItems.map((item) => parseTimestamp(item.updated_at || item.created_at)),
    ...jobs.map((item) => parseTimestamp(item.updated_at || item.created_at)),
    ...inferenceHistory.map((item) => parseTimestamp(item.timestamp)),
  ].filter(Boolean);

  return {
    workspace,
    deployments,
    jobs,
    system,
    projects,
    deploymentItems,
    inferenceHistory,
    loadMs,
    allTimings,
    timestamps,
    checks: state.requestTimings.slice(),
  };
}

function countByStatus(items, key = 'status') {
  return items.reduce((acc, item) => {
    const raw = String(item?.[key] || '').toLowerCase();
    acc[raw] = (acc[raw] || 0) + 1;
    return acc;
  }, {});
}

function buildProjectActivityStats(projects, deploymentItems, jobs, inferenceHistory) {
  const projectStats = projects.map((project) => {
    const relatedDeployments = deploymentItems.filter((item) => item.project_id && String(item.project_id) === String(project.id)).length;
    const relatedJobs = jobs.filter((item) => item.project_id && String(item.project_id) === String(project.id)).length;
    const relatedInferences = inferenceHistory.filter((item) => item.project_id && String(item.project_id) === String(project.id)).length;
    const pageCount = Math.max(
      1,
      safeNum(project.images) +
        safeNum(project.versions_count) +
        relatedDeployments +
        relatedJobs +
        relatedInferences
    );
    const created = parseTimestamp(project.created_at || project.created);
    const updated = parseTimestamp(project.updated_at || project.updated || project.created_at || project.created);
    const durationSeconds = created && updated ? Math.max(0, (updated.getTime() - created.getTime()) / 1000) : 0;
    const interactions = safeNum(project.deployments_count) + safeNum(project.jobs_count) + relatedDeployments + relatedJobs + relatedInferences;
    return {
      project,
      pageCount,
      durationSeconds,
      interactions,
    };
  });

  const totalSessions = projectStats.length;
  const singlePageSessions = projectStats.filter((item) => item.pageCount <= 1).length;
  const totalPages = projectStats.reduce((sum, item) => sum + item.pageCount, 0);
  const totalDurationSeconds = projectStats.reduce((sum, item) => sum + item.durationSeconds, 0);
  const totalInteractions = projectStats.reduce((sum, item) => sum + item.interactions, 0);
  const avgPagesPerSession = totalSessions ? totalPages / totalSessions : 0;
  const avgSessionDurationSeconds = totalSessions ? totalDurationSeconds / totalSessions : 0;
  const interactionRate = totalSessions ? totalInteractions / totalSessions : 0;

  return {
    projectStats,
    totalSessions,
    singlePageSessions,
    totalPages,
    avgPagesPerSession,
    avgSessionDurationSeconds,
    totalInteractions,
    interactionRate,
  };
}

function buildTrafficStats(timestamps, projects, deploymentItems, jobs, inferenceHistory) {
  const eventTimestamps = timestamps.map((date) => date.getTime()).filter((value) => Number.isFinite(value));
  const earliest = eventTimestamps.length ? new Date(Math.min(...eventTimestamps)) : null;
  const latest = eventTimestamps.length ? new Date(Math.max(...eventTimestamps)) : null;
  const activeSpanMinutes = earliest && latest ? Math.max(1, (latest.getTime() - earliest.getTime()) / 60000) : 1;
  const totalHits = eventTimestamps.length;
  const hitsPerMinute = totalHits / activeSpanMinutes;
  const hitsPerHour = hitsPerMinute * 60;
  const uniqueVisitors = new Set(
    [
      ...projects.map((item) => item.id),
      ...deploymentItems.map((item) => item.project_id),
      ...jobs.map((item) => item.project_id),
      ...inferenceHistory.map((item) => item.project_id),
    ].filter(Boolean).map(String)
  ).size;

  return {
    totalHits,
    hitsPerMinute,
    hitsPerHour,
    uniqueVisitors,
    activeSpanMinutes,
  };
}

function buildSnapshotMetrics(snapshot) {
  const {
    workspace,
    deployments,
    jobs,
    system,
    projects,
    deploymentItems,
    inferenceHistory,
    loadMs,
    allTimings,
    timestamps,
    checks,
  } = snapshot;

  const projectCount = projects.length;
  const imageCount = safeNum(workspace.stats?.images, projects.reduce((sum, project) => sum + safeNum(project.images), 0));
  const versionCount = safeNum(workspace.stats?.versions, projects.reduce((sum, project) => sum + safeNum(project.versions_count), 0));
  const deploymentCount = deploymentItems.length;
  const jobCount = jobs.length;
  const inferenceCount = inferenceHistory.length;
  const successfulDeployments = deploymentItems.filter((item) => String(item.status || '').toLowerCase() === 'running').length;
  const successfulJobs = jobs.filter((item) => String(item.status || '').toLowerCase() === 'completed').length;
  const failedJobs = jobs.filter((item) => String(item.status || '').toLowerCase() === 'failed').length;
  const failedDeployments = deploymentItems.filter((item) => String(item.status || '').toLowerCase() === 'failed').length;
  const healthChecks = checks.length;
  const healthyChecks = checks.filter((item) => item.ok).length;
  const failedChecks = healthChecks - healthyChecks;
  const trafficStats = buildTrafficStats(timestamps, projects, deploymentItems, jobs, inferenceHistory);
  const projectActivityStats = buildProjectActivityStats(projects, deploymentItems, jobs, inferenceHistory);
  const cpu = Number.isFinite(system.cpu?.percent) ? safeNum(system.cpu.percent) : 0;
  const uptime = healthChecks > 0 ? (healthyChecks / healthChecks) * 100 : 100;
  const bounceRate = projectCount > 0 ? (projectActivityStats.singlePageSessions / projectCount) * 100 : 0;
  const visitEvents = projectCount + deploymentCount + jobCount + inferenceCount;
  const conversionEvents = successfulJobs + successfulDeployments;
  const conversionRate = visitEvents > 0 ? (conversionEvents / visitEvents) * 100 : 0;
  const errorRate = healthChecks > 0 ? (failedChecks / healthChecks) * 100 : 0;

  const responseSamples = checks.map((item) => safeNum(item.durationMs)).filter((value) => Number.isFinite(value) && value >= 0);
  const sortedTimings = responseSamples.slice().sort((a, b) => a - b);
  const responseAverage = sortedTimings.length ? sortedTimings.reduce((sum, value) => sum + value, 0) / sortedTimings.length : 0;
  const responseMedian = percentile(sortedTimings, 50);
  const responseP95 = percentile(sortedTimings, 95);
  const responseP99 = percentile(sortedTimings, 99);
  const responseMin = sortedTimings.length ? sortedTimings[0] : 0;
  const responseMax = sortedTimings.length ? sortedTimings[sortedTimings.length - 1] : 0;
  const responseTime = responseP95;
  const pageLoadTime = loadMs || 0;

  const avgSessionDurationSeconds = projectActivityStats.avgSessionDurationSeconds;
  const avgPagesPerSession = projectActivityStats.avgPagesPerSession;
  const interactionRate = projectActivityStats.interactionRate;
  const durationScore = clamp((avgSessionDurationSeconds / 120) * 100, 0, 100);
  const pagesScore = clamp(avgPagesPerSession * 12, 0, 100);
  const interactionScore = clamp(interactionRate * 15, 0, 100);
  const userEngagement = clamp(durationScore * 0.4 + pagesScore * 0.35 + interactionScore * 0.25, 0, 100);

  return {
    traffic: {
      current: trafficStats.hitsPerMinute,
      status: deriveStatus(METRIC_DEFS[0], trafficStats.hitsPerMinute, trafficStats.totalHits),
      samples: trafficStats.totalHits,
      details: {
        'Total Hits': trafficStats.totalHits.toLocaleString(),
        'Hits / Minute': formatMetricNumber(trafficStats.hitsPerMinute),
        'Hits / Hour': formatMetricNumber(trafficStats.hitsPerHour),
        'Unique Visitors': trafficStats.uniqueVisitors.toLocaleString(),
        'Active Window': `${formatMetricNumber(trafficStats.activeSpanMinutes, 1)} min`,
      },
    },
    uptime: {
      current: uptime,
      status: deriveStatus(METRIC_DEFS[1], uptime, healthChecks),
      samples: healthChecks,
      details: {
        'Up Checks': healthyChecks.toLocaleString(),
        'Total Checks': healthChecks.toLocaleString(),
        'Down Checks': failedChecks.toLocaleString(),
        'Uptime %': `${formatMetricNumber(uptime)}%`,
      },
    },
    cpu: {
      current: cpu,
      status: deriveStatus(METRIC_DEFS[2], cpu, Number.isFinite(system.cpu?.percent) ? 1 : 0),
      samples: Number.isFinite(system.cpu?.percent) ? 1 : 0,
      details: {
        'Current CPU': Number.isFinite(system.cpu?.percent) ? `${system.cpu.percent.toFixed(2)}%` : '--',
        'RAM': Number.isFinite(system.ram?.percent) ? `${system.ram.percent.toFixed(2)}%` : '--',
        'Disk': Number.isFinite(system.disk?.percent) ? `${system.disk.percent.toFixed(2)}%` : '--',
        'GPU': Number.isFinite(system.gpu?.percent) ? `${system.gpu.percent.toFixed(2)}%` : 'Not detected',
      },
    },
    bounce_rate: {
      current: bounceRate,
      status: deriveStatus(METRIC_DEFS[3], bounceRate, projectCount),
      samples: projectCount,
      details: {
        'Single-page Sessions': projectActivityStats.singlePageSessions.toLocaleString(),
        'Total Sessions': projectCount.toLocaleString(),
        'Avg Pages / Session': formatMetricNumber(projectActivityStats.avgPagesPerSession),
        'Session Proxy': 'Project activity bundles',
      },
    },
    conversion_rate: {
      current: conversionRate,
      status: deriveStatus(METRIC_DEFS[4], conversionRate, visitEvents),
      samples: visitEvents,
      details: {
        'Conversions': conversionEvents.toLocaleString(),
        'Total Visits': visitEvents.toLocaleString(),
        'Successful Jobs': successfulJobs.toLocaleString(),
        'Running Deployments': successfulDeployments.toLocaleString(),
      },
    },
    error_rate: {
      current: errorRate,
      status: deriveStatus(METRIC_DEFS[5], errorRate, healthChecks),
      samples: healthChecks,
      details: {
        'Failed Checks': failedChecks.toLocaleString(),
        'Total Responses': healthChecks.toLocaleString(),
        'HTTP Error %': `${formatMetricNumber(errorRate)}%`,
        'Response Proxy': 'Dashboard API responses',
      },
    },
    response_time: {
      current: responseTime,
      status: deriveStatus(METRIC_DEFS[6], responseP95, sortedTimings.length),
      samples: sortedTimings.length,
      details: sortedTimings.length
        ? {
            Count: sortedTimings.length.toLocaleString(),
            'Average (ms)': formatMetricNumber(responseAverage),
            Median: formatMetricNumber(responseMedian),
            'P95 (ms)': formatMetricNumber(responseP95),
            'P99 (ms)': formatMetricNumber(responseP99),
            'Min (ms)': formatMetricNumber(responseMin),
            'Max (ms)': formatMetricNumber(responseMax),
          }
        : {
            Count: '0',
            'Average (ms)': '--',
            Median: '--',
            'P95 (ms)': '--',
            'P99 (ms)': '--',
            'Min (ms)': '--',
            'Max (ms)': '--',
          },
    },
    page_load_time: {
      current: pageLoadTime,
      status: deriveStatus(METRIC_DEFS[7], pageLoadTime, loadMs ? 1 : 0),
      samples: 1,
      details: {
        'Navigation Load': `${Math.round(loadMs).toLocaleString()} ms`,
        'Full Load': `${Math.round(pageLoadTime).toLocaleString()} ms`,
        'Assets Included': 'Yes',
        'Visible Page': 'KPI metrics page',
      },
    },
    user_engagement: {
      current: userEngagement,
      status: deriveStatus(METRIC_DEFS[8], userEngagement, projectCount),
      samples: projectCount,
      details: {
        'Avg Session Duration': `${formatMetricNumber(avgSessionDurationSeconds)} s`,
        'Pages / Session': formatMetricNumber(avgPagesPerSession),
        'Interaction Rate': formatMetricNumber(interactionRate),
        'Composite Inputs': 'Duration, page count, interactions',
      },
    },
  };
}

function applySystemMetricsUpdate(system) {
  if (!state.lastSnapshot) return;
  state.lastSnapshot = {
    ...state.lastSnapshot,
    system,
  };
  const metrics = buildSnapshotMetrics(state.lastSnapshot);
  const liveKeys = ['uptime', 'cpu'];
  updateMetricState(metrics, liveKeys);
  updateCards(liveKeys);
  updateTrends(liveKeys);
  renderSummaryBar();
  updateLastUpdated();
  if (liveKeys.includes(state.activeDetail)) {
    openDetail(state.activeDetail);
  }
}

function formatValue(def, value) {
  if (def.unit === '%' || def.unit === 'score') return value.toFixed(2);
  if (def.unit.includes('ms')) return Math.round(value).toLocaleString();
  return value.toFixed(2);
}

function thresholdPercent(def, value) {
  if (def.higherIsWorse) {
    return Math.min(100, (value / (def.criticalThreshold * 1.2)) * 100);
  }
  const ref = def.warningThreshold * 1.1;
  return Math.min(100, Math.max(0, (value / ref) * 100));
}

function statusClass(status) {
  return `status-${status} ${status}`;
}

function drawSparkline(canvas, data, color, fillAlpha = 0.18) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  if (!data || data.length < 2) return;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const x = (index) => pad + (index / (data.length - 1)) * w;
  const y = (value) => pad + h - ((value - min) / range) * h;

  const gradient = ctx.createLinearGradient(0, pad, 0, height);
  gradient.addColorStop(0, `${color}${Math.round(fillAlpha * 255).toString(16).padStart(2, '0')}`);
  gradient.addColorStop(1, `${color}00`);

  ctx.beginPath();
  ctx.moveTo(x(0), y(data[0]));
  for (let i = 1; i < data.length; i += 1) {
    const cpx = (x(i - 1) + x(i)) / 2;
    ctx.bezierCurveTo(cpx, y(data[i - 1]), cpx, y(data[i]), x(i), y(data[i]));
  }
  ctx.lineTo(x(data.length - 1), height);
  ctx.lineTo(x(0), height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x(0), y(data[0]));
  for (let i = 1; i < data.length; i += 1) {
    const cpx = (x(i - 1) + x(i)) / 2;
    ctx.bezierCurveTo(cpx, y(data[i - 1]), cpx, y(data[i]), x(i), y(data[i]));
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  const lx = x(data.length - 1);
  const ly = y(data[data.length - 1]);
  ctx.beginPath();
  ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx, ly, 6, 0, Math.PI * 2);
  ctx.fillStyle = `${color}30`;
  ctx.fill();
}

function drawBarChart(canvas, data, color) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  if (!data || !data.length) return;

  const max = Math.max(...data) || 1;
  const gap = 3;
  const barWidth = (width - gap * (data.length - 1)) / data.length;

  data.forEach((value, index) => {
    const barHeight = (value / max) * height;
    const x = index * (barWidth + gap);
    const y = height - barHeight;
    const alpha = index === data.length - 1 ? 'ff' : '8c';
    ctx.fillStyle = `${color}${alpha}`;
    const radius = Math.min(3, barWidth / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + barWidth - radius, y);
    ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
    ctx.lineTo(x + barWidth, height);
    ctx.lineTo(x, height);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  });
}

function ensureMetricState() {
  METRIC_DEFS.forEach((def) => {
    if (!state.metrics[def.key]) {
      state.metrics[def.key] = makeEmptyMetric(def);
    }
  });
}

function updateMetricState(metrics, keys = null) {
  const keySet = keys ? new Set(keys) : null;
  METRIC_DEFS.forEach((def) => {
    if (keySet && !keySet.has(def.key)) return;
    const next = metrics[def.key] || makeEmptyMetric(def);
    const current = safeNum(next.current, 0);
    const existing = state.metrics[def.key] || makeEmptyMetric(def);
    const history = [...existing.history.slice(-HISTORY_LEN + 1), current].slice(-HISTORY_LEN);
    state.metrics[def.key] = {
      ...existing,
      ...next,
      current,
      history,
      status: next.status || deriveStatus(def, current, next.samples || 0),
      def,
    };
  });
}

function renderSummaryBar() {
  const total = document.getElementById('count-total');
  if (total) total.textContent = String(METRIC_DEFS.length);
  let good = 0;
  let warning = 0;
  let critical = 0;
  METRIC_DEFS.forEach((def) => {
    const metric = state.metrics[def.key];
    if (metric.status === 'good') good += 1;
    else if (metric.status === 'warning') warning += 1;
    else if (metric.status === 'critical') critical += 1;
  });
  animateCount('count-good', good);
  animateCount('count-warning', warning);
  animateCount('count-critical', critical);
}

function animateCount(id, target) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = String(target);
}

function renderCards() {
  const grid = document.getElementById('metrics-grid');
  grid.innerHTML = '';
  METRIC_DEFS.forEach((def, index) => {
    const metric = state.metrics[def.key];
    const card = createMetricCard(def, metric, index);
    grid.appendChild(card);
  });

  requestAnimationFrame(() => {
    METRIC_DEFS.forEach((def) => {
      const canvas = document.getElementById(`spark-${def.key}`);
      if (canvas) drawSparkline(canvas, state.metrics[def.key].history, def.color);
    });
  });
}

function createMetricCard(def, metric, index) {
  const card = document.createElement('article');
  card.className = `metric-card ${metric.status}`;
  card.style.animationDelay = '0ms';
  card.dataset.key = def.key;
  card.innerHTML = metricCardInnerHTML(def, metric);
  card.addEventListener('click', () => {
    registerTelemetryInteraction();
    openDetail(def.key);
  });
  return card;
}

function metricCardInnerHTML(def, metric) {
  return `
    <div class="card-accent-bar"></div>
    <div class="card-header">
      <div class="card-icon-wrap ${statusClass(metric.status)}" style="background:${def.color}22;color:${def.color}">
        ${iconForMetric(def.key)}
      </div>
      <div class="${statusClass(metric.status)}">
        <div class="card-status-badge">
          <span class="badge-dot"></span>
          ${metric.status.replaceAll('_', ' ')}
        </div>
      </div>
    </div>
    <div class="card-name">${def.name}</div>
    <div class="card-value-row">
      <div class="card-value" style="color:${def.color}">${formatValue(def, metric.current)}</div>
      <div class="card-unit">${def.unit}</div>
    </div>
    <div class="card-samples">${metric.samples || 0} samples recorded</div>
    <div class="card-sparkline"><canvas id="spark-${def.key}" height="50"></canvas></div>
    <div class="threshold-bar-wrap">
      <div class="threshold-bar-labels">
        <span>0</span>
        <span>warn: ${def.warningThreshold}</span>
        <span>crit: ${def.criticalThreshold}</span>
      </div>
      <div class="threshold-bar">
        <div class="threshold-fill" style="width:${thresholdPercent(def, metric.current).toFixed(1)}%"></div>
      </div>
    </div>
    <div class="card-click-hint">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      Click to inspect details
    </div>
  `;
}

function updateCards(keys = null) {
  const defs = keys ? METRIC_DEFS.filter((def) => keys.includes(def.key)) : METRIC_DEFS;
  defs.forEach((def) => {
    const metric = state.metrics[def.key];
    const card = document.querySelector(`.metric-card[data-key="${def.key}"]`);
    if (!card) return;
    card.className = `metric-card ${metric.status}`;
    card.innerHTML = metricCardInnerHTML(def, metric);
    card.addEventListener('click', () => {
      registerTelemetryInteraction();
      openDetail(def.key);
    });
  });

  requestAnimationFrame(() => {
    defs.forEach((def) => {
      const canvas = document.getElementById(`spark-${def.key}`);
      if (canvas) drawSparkline(canvas, state.metrics[def.key].history, def.color);
    });
  });
}

function renderTrends() {
  const grid = document.getElementById('trend-grid');
  grid.innerHTML = '';
  METRIC_DEFS.forEach((def) => {
    const metric = state.metrics[def.key];
    const history = metric.history;
    const last = history[history.length - 1] || 0;
    const prev = history[history.length - 4] || last;
    const delta = last - prev;
    const deltaClass = Math.abs(delta) < 0.001 ? 'flat' : def.higherIsWorse ? (delta < 0 ? 'up' : 'down') : (delta < 0 ? 'down' : 'up');
    const deltaSign = delta > 0 ? '+' : '';
    const card = document.createElement('article');
    card.className = 'trend-card';
    card.innerHTML = `
      <div class="trend-card-header">
        <div class="trend-card-name">${def.name}</div>
        <div class="trend-card-delta ${deltaClass}">${deltaSign}${delta.toFixed(2)} ${def.unit}</div>
      </div>
      <canvas id="trend-${def.key}" height="90"></canvas>
    `;
    grid.appendChild(card);
  });

  requestAnimationFrame(() => {
    METRIC_DEFS.forEach((def) => {
      const canvas = document.getElementById(`trend-${def.key}`);
      if (canvas) drawBarChart(canvas, state.metrics[def.key].history, def.color);
    });
  });
}

function trendCardInnerHTML(def, metric) {
  const history = metric.history;
  const last = history[history.length - 1] || 0;
  const prev = history[history.length - 4] || last;
  const delta = last - prev;
  const deltaClass = Math.abs(delta) < 0.001 ? 'flat' : def.higherIsWorse ? (delta < 0 ? 'up' : 'down') : (delta < 0 ? 'down' : 'up');
  const deltaSign = delta > 0 ? '+' : '';
  return `
    <div class="trend-card-header">
      <div class="trend-card-name">${def.name}</div>
      <div class="trend-card-delta ${deltaClass}">${deltaSign}${delta.toFixed(2)} ${def.unit}</div>
    </div>
    <canvas id="trend-${def.key}" height="90"></canvas>
  `;
}

function updateTrends(keys = null) {
  const defs = keys ? METRIC_DEFS.filter((def) => keys.includes(def.key)) : METRIC_DEFS;
  defs.forEach((def) => {
    const metric = state.metrics[def.key];
    const card = document.getElementById(`trend-${def.key}`)?.closest('.trend-card');
    if (!card) return;
    card.innerHTML = trendCardInnerHTML(def, metric);
  });

  requestAnimationFrame(() => {
    defs.forEach((def) => {
      const canvas = document.getElementById(`trend-${def.key}`);
      if (canvas) drawBarChart(canvas, state.metrics[def.key].history, def.color);
    });
  });
}

function openDetail(key) {
  const def = METRIC_DEFS.find((item) => item.key === key);
  const metric = state.metrics[key];
  if (!def || !metric) return;

  state.activeDetail = key;
  const section = document.getElementById('detail-section');
  const title = document.getElementById('detail-title');
  const dot = document.getElementById('detail-status-dot');
  const body = document.getElementById('detail-body');

  const statusColors = {
    good: 'var(--good)',
    warning: 'var(--warning)',
    critical: 'var(--critical)',
    no_data: 'var(--muted)',
  };

  title.textContent = `${def.name} - Detail View`;
  dot.style.background = statusColors[metric.status] || 'var(--muted)';
  dot.style.boxShadow = `0 0 12px ${statusColors[metric.status] || 'var(--muted)'}`;

  const statCards = Object.entries(metric.details || {})
    .map(([label, value]) => `
      <div class="detail-stat-card">
        <div class="detail-stat-label">${label}</div>
        <div class="detail-stat-value" style="color:${def.color}">${value}</div>
      </div>
    `)
    .join('');

  body.innerHTML = `
    <div class="detail-chart-wrap">
      <div class="detail-chart-title">Trend - Last ${HISTORY_LEN} refreshes</div>
      <canvas id="detail-canvas" height="200"></canvas>
    </div>
    <div class="detail-stats-wrap">
      <div class="detail-stat-card" style="border-color:${def.color}44;background:${def.color}10">
        <div class="detail-stat-label">Description</div>
        <div class="detail-stat-value" style="font-family:Inter,sans-serif;font-size:12px;line-height:1.5;color:var(--muted);text-align:left">
          ${def.description}
        </div>
      </div>
      <div class="detail-stat-card" style="border-color:${def.color}44">
        <div class="detail-stat-label">Current Value</div>
        <div class="detail-stat-value" style="color:${def.color};font-size:22px">${formatValue(def, metric.current)} <span style="font-size:12px;color:var(--faint)">${def.unit}</span></div>
      </div>
      ${statCards || '<div class="empty-state">No detail data available yet.</div>'}
      <div class="detail-stat-card">
        <div class="detail-stat-label">Warning Threshold</div>
        <div class="detail-stat-value" style="color:var(--warning)">${def.warningThreshold} ${def.unit}</div>
      </div>
      <div class="detail-stat-card">
        <div class="detail-stat-label">Critical Threshold</div>
        <div class="detail-stat-value" style="color:var(--critical)">${def.criticalThreshold} ${def.unit}</div>
      </div>
    </div>
  `;

  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  requestAnimationFrame(() => {
    const canvas = document.getElementById('detail-canvas');
    if (canvas) drawSparkline(canvas, metric.history, def.color, 0.22);
  });
}

function updateClock() {
  const element = document.getElementById('current-time');
  if (element) element.textContent = fmtTime(Date.now());
}

function updateLastUpdated() {
  const element = document.getElementById('last-updated');
  if (element) {
    element.textContent = `Last updated: ${fmtTime(Date.now())}`;
  }
}

async function refreshDashboard() {
  if (state.refreshInFlight) {
    state.refreshQueued = true;
    return;
  }

  state.refreshInFlight = true;
  try {
    const snapshot = await collectSnapshot();
    state.lastSnapshot = snapshot;
    const metrics = buildSnapshotMetrics(snapshot);
    updateMetricState(metrics);
    saveSnapshotCache(metrics);
    if (!document.querySelector('.metric-card[data-key="traffic"]')) {
      renderCards();
      renderTrends();
    }
    updateCards();
    updateTrends();
    renderSummaryBar();
    updateLastUpdated();
    if (state.activeDetail) {
      openDetail(state.activeDetail);
    }
  } finally {
    state.refreshInFlight = false;
    if (state.refreshQueued) {
      state.refreshQueued = false;
      refreshDashboard().catch(() => {});
    }
  }
}

function closeDetail() {
  const section = document.getElementById('detail-section');
  section.hidden = true;
  state.activeDetail = null;
}

function trafficIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M17 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" stroke="currentColor" stroke-width="2"/><path d="M7 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" stroke="currentColor" stroke-width="2"/><path d="M5 9V6h14l2 5H5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 9H3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 14H9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}
function uptimeIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function cpuIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}
function bounceIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 14l-4-4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10h11a4 4 0 0 1 0 8h-1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}
function conversionIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8l-6.2 3.2 1.2-6.9-5-4.9 6.9-1L12 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
}
function errorIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
}
function responseIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}
function pageLoadIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}
function engagementIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/><path d="M23 21v-2a4 4 0 0 0-3-3.9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 3.1a4 4 0 0 1 0 7.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}

function iconForMetric(key) {
  switch (key) {
    case 'traffic':
      return trafficIcon();
    case 'uptime':
      return uptimeIcon();
    case 'cpu':
      return cpuIcon();
    case 'bounce_rate':
      return bounceIcon();
    case 'conversion_rate':
      return conversionIcon();
    case 'error_rate':
      return errorIcon();
    case 'response_time':
      return responseIcon();
    case 'page_load_time':
      return pageLoadIcon();
    case 'user_engagement':
      return engagementIcon();
    default:
      return trafficIcon();
  }
}

function bindEvents() {
  document.getElementById('btn-refresh').addEventListener('click', () => {
    const button = document.getElementById('btn-refresh');
    button.style.transform = 'translateY(-1px) rotate(0deg)';
    setTimeout(() => { button.style.transform = ''; }, 220);
    registerTelemetryInteraction();
    refreshDashboard().catch(() => {});
  });

  document.getElementById('btn-download-excel').addEventListener('click', async () => {
    const button = document.getElementById('btn-download-excel');
    const originalText = button.innerHTML;
    try {
      button.innerHTML = 'Generating...';
      button.disabled = true;
      registerTelemetryInteraction();
      
      const response = await fetch(resolveApiUrl('/api/system-metrics/stop'), { method: 'POST' });
      if (!response.ok) throw new Error('Failed to stop and generate metrics');
      
      const data = await response.json();
      if (!data.summary) {
         alert(data.message || 'No metrics gathered yet.');
         return;
      }
      
      // Trigger download
      const a = document.createElement('a');
      a.href = resolveApiUrl('/api/system-metrics/download');
      a.download = 'system-metrics.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Optionally restart gathering here
      // await fetch(resolveApiUrl('/api/system-metrics/start'), { method: 'POST' });
    } catch (err) {
      alert('Error generating Excel file: ' + err.message);
    } finally {
      button.innerHTML = originalText;
      button.disabled = false;
    }
  });
  document.getElementById('btn-close-detail').addEventListener('click', closeDetail);

  document.getElementById('btn-download-kpi')?.addEventListener('click', () => {
    registerTelemetryInteraction();
    const rows = [
      ['Metric Name', 'Key', 'Current Value', 'Unit', 'Status', 'Samples', 'Warning Threshold', 'Critical Threshold', 'Sum (History)', 'Min (History)', 'Max (History)', 'Avg (History)']
    ];

    let totalMin = 0, totalMax = 0, totalAvg = 0, totalSum = 0;
    let metricCount = 0;

    METRIC_DEFS.forEach(def => {
      const metric = state.metrics[def.key];
      if (metric) {
        const history = (metric.history || []).filter(v => typeof v === 'number' && !isNaN(v));
        const sum = history.reduce((a, b) => a + b, 0);
        const min = history.length ? Math.min(...history) : 0;
        const max = history.length ? Math.max(...history) : 0;
        const avg = history.length ? sum / history.length : 0;

        totalSum += sum;
        totalMin += min;
        totalMax += max;
        totalAvg += avg;
        metricCount++;

        rows.push([
          def.name,
          def.key,
          metric.current,
          def.unit,
          metric.status,
          metric.samples || 0,
          def.warningThreshold,
          def.criticalThreshold,
          parseFloat(sum.toFixed(4)),
          parseFloat(min.toFixed(4)),
          parseFloat(max.toFixed(4)),
          parseFloat(avg.toFixed(4))
        ]);
      }
    });

    // Blank separator row
    rows.push([]);

    // Summary totals row
    rows.push([
      'SUMMARY TOTALS', '', '', '', '', '',  '', '',
      parseFloat(totalSum.toFixed(4)),
      parseFloat(totalMin.toFixed(4)),
      parseFloat(totalMax.toFixed(4)),
      metricCount > 0 ? parseFloat((totalAvg / metricCount).toFixed(4)) : 0
    ]);

    // Individual summary rows for clarity
    rows.push(['Sum of All Minimums', '', '', '', '', '', '', '', '', parseFloat(totalMin.toFixed(4)), '', '']);
    rows.push(['Sum of All Maximums', '', '', '', '', '', '', '', '', '', parseFloat(totalMax.toFixed(4)), '']);
    rows.push(['Average of All Averages', '', '', '', '', '', '', '', '', '', '', metricCount > 0 ? parseFloat((totalAvg / metricCount).toFixed(4)) : 0]);

    if (typeof XLSX !== 'undefined') {
      const ws = XLSX.utils.aoa_to_sheet(rows);

      // Style header row bold (column widths)
      ws['!cols'] = [
        { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 10 },
        { wch: 9 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'KPI Metrics');
      XLSX.writeFile(wb, 'kpi-metrics.xlsx');
    } else {
      const csvContent = rows.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kpi-metrics.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  });

  window.addEventListener('visionflow_data_changed', () => {
    refreshDashboard().catch(() => {});
  });

  window.addEventListener('beforeunload', () => {
    sendTelemetryEvent({
      type: 'session_summary',
      route_group: 'kpi-metrics',
      page: 'kpi-metrics',
      page_count: 1,
      pages_viewed: 1,
      duration_seconds: Math.max(0, (Date.now() - telemetryState.startedAt) / 1000),
      interactions: telemetryState.interactions,
    });
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      METRIC_DEFS.forEach((def) => {
        const spark = document.getElementById(`spark-${def.key}`);
        const trend = document.getElementById(`trend-${def.key}`);
        if (spark) drawSparkline(spark, state.metrics[def.key].history, def.color);
        if (trend) drawBarChart(trend, state.metrics[def.key].history, def.color);
      });
      if (state.activeDetail) {
        const canvas = document.getElementById('detail-canvas');
        const def = METRIC_DEFS.find((item) => item.key === state.activeDetail);
        if (canvas && def) drawSparkline(canvas, state.metrics[state.activeDetail].history, def.color, 0.22);
      }
    }, 180);
  });
}

function bindLiveSignalSource(source, url, service = 'project') {
  if (source) return source;
  try {
    const eventSource = new EventSource(resolveApiUrl(url, service));
    eventSource.addEventListener('snapshot', () => {
      refreshDashboard().catch(() => {});
    });
    eventSource.onerror = () => {};
    return eventSource;
  } catch (_error) {}
  return null;
}

function bindLiveSystemStream() {
  if (state.systemMetricsSource) return;
  try {
    const source = new EventSource(resolveApiUrl('/api/system-metrics/stream'));
    source.onmessage = (event) => {
      try {
        const system = JSON.parse(event.data || '{}');
        applySystemMetricsUpdate(system);
      } catch (_error) {}
    };
    source.onerror = () => {};
    state.systemMetricsSource = source;
  } catch (_error) {}
}

function bindLiveKpiStreams() {
  if (!state.projectKpiSource) {
    state.projectKpiSource = bindLiveSignalSource(state.projectKpiSource, '/api/kpi/live/stream', 'project');
  }
  if (!state.inferenceKpiSource) {
    state.inferenceKpiSource = bindLiveSignalSource(state.inferenceKpiSource, '/api/kpi/inference-stream', 'inference');
  }
}

async function boot() {
  ensureMetricState();
  const cached = loadSnapshotCache();
  if (cached?.metrics && typeof cached.metrics === 'object') {
    updateMetricState(cached.metrics);
  }
  bindEvents();
  bindLiveKpiStreams();
  bindLiveSystemStream();
  sendTelemetryEvent({
    type: 'page_hit',
    route_group: 'kpi-metrics',
    page: 'kpi-metrics',
    page_count: 1,
    pages_viewed: 1,
    interactions: 0,
  });
  updateClock();
  setInterval(updateClock, 1000);
  renderCards();
  renderTrends();
  renderSummaryBar();
  updateLastUpdated();
  refreshDashboard().catch(() => {});
}

boot();
