/**
 * Extensible metric registry for scar analysis.
 *
 * Each metric has a uniform shape: key, labels, compute, format, csvHeader.
 * New metrics can be added here without modifying the analysis panel.
 *
 * @module geometry/metricRegistry
 */

import { formatDistanceConverted, formatAreaConverted } from '../utils/units.js';
import { radiansToDegrees } from './edgeAngles.js';

/**
 * @typedef {Object} MetricDefinition
 * @property {string} key
 * @property {string} label - Display label
 * @property {string} shortLabel - Short label for chart/column
 * @property {function(number, Map): number|null} compute - (scarId, metricsMap) => value
 * @property {function(number, Object): string} format - (value, unitCtx) => display string
 * @property {function(Object): string} csvHeader - (unitCtx) => CSV column name
 * @property {boolean} [nullsLast] - Push nulls to end when sorting (default true)
 */

export const METRIC_REGISTRY = [
    {
        key: 'vertexCount',
        label: 'Vertex Count',
        shortLabel: 'Vertices',
        compute: (scarId, m) => m.get(scarId)?.vertexCount ?? null,
        format: (v) => v != null ? v.toLocaleString() : '--',
        csvHeader: () => 'vertex_count',
    },
    {
        key: 'surfaceArea',
        label: 'Surface Area',
        shortLabel: 'Area',
        compute: (scarId, m) => m.get(scarId)?.surfaceArea ?? null,
        format: (v, u) => v != null ? formatAreaConverted(v, u.source, u.display) : '--',
        csvHeader: (u) => `surface_area_${u.symbol}2`,
    },
    {
        key: 'maxDimension',
        label: 'Max Dimension',
        shortLabel: 'Max Dim',
        compute: (scarId, m) => m.get(scarId)?.maxDimension ?? null,
        format: (v, u) => v != null ? formatDistanceConverted(v, u.source, u.display) : '--',
        csvHeader: (u) => `max_dimension_${u.symbol}`,
    },
    {
        key: 'meanCurvature',
        label: 'Mean Curvature',
        shortLabel: 'Curvature',
        compute: (scarId, m) => m.get(scarId)?.meanCurvature ?? null,
        format: (v) => v != null ? `${radiansToDegrees(v).toFixed(1)}°` : '--',
        csvHeader: () => 'mean_curvature_deg',
    },
    {
        key: 'temporalOrder',
        label: 'Temporal Order',
        shortLabel: 'Order',
        compute: (scarId, m) => m.get(scarId)?.temporalOrder ?? null,
        format: (v) => v != null ? String(v) : '--',
        csvHeader: () => 'temporal_order',
    },
];

/**
 * Look up a metric definition by key.
 * @param {string} key
 * @returns {MetricDefinition|undefined}
 */
export function getMetricByKey(key) {
    return METRIC_REGISTRY.find(m => m.key === key);
}

/**
 * Get metrics that have at least one non-null value in the data.
 * Filters out metrics that are entirely absent (e.g. temporal order when no ordering exists).
 * @param {Map<number, Object>} metricsMap - scarId → metric values
 * @returns {MetricDefinition[]}
 */
export function getAvailableMetrics(metricsMap) {
    return METRIC_REGISTRY.filter(def => {
        for (const [scarId] of metricsMap) {
            const val = def.compute(scarId, metricsMap);
            if (val != null) return true;
        }
        return false;
    });
}
