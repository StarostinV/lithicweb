/**
 * AnalysisPanel - Displays mesh, annotation, and segment statistics.
 *
 * Uses MeshView.segments and faceLabels directly (no scar graph dependency).
 *
 * @module AnalysisPanel
 */

import { eventBus, Events } from '../utils/EventBus.js';
import { getEffectiveUnit, getSourceUnit, formatDistanceConverted, formatAreaConverted, UNIT_DEFINITIONS } from '../utils/units.js';
import { computeSegmentMetrics } from '../geometry/scarMetrics.js';

export class AnalysisPanel {
    /**
     * @param {MeshView} meshView
     * @param {MeshLoader} meshLoader
     * @param {UserConfig} userConfig
     */
    constructor(meshView, meshLoader, userConfig) {
        this.meshView = meshView;
        this.meshLoader = meshLoader;
        this.userConfig = userConfig;

        // Cached segment metrics
        this._segmentMetrics = null;
        this._stale = true;
        this._debounceTimer = null;

        // DOM elements
        this._vertexCountEl = document.getElementById('analysisVertexCount');
        this._faceCountEl = document.getElementById('analysisFaceCount');
        this._bboxValueEl = document.getElementById('analysisBboxValue');
        this._unitDisplayEl = document.getElementById('analysisUnitDisplay');
        this._edgeCountEl = document.getElementById('analysisEdgeCount');
        this._arrowCountEl = document.getElementById('analysisArrowCount');
        this._scarBadgeEl = document.getElementById('analysisScarBadge');
        this._scarSummaryEl = document.getElementById('analysisScarSummary');
        this._scarStatsEl = document.getElementById('analysisScarStats');
        this._scarChartEl = document.getElementById('analysisScarChart');
        this._scarTableEl = document.getElementById('analysisScarTable');
        this._csvExportBtn = document.getElementById('analysisCsvExportBtn');

        this._setupEventBusSubscriptions();
        this._setupControls();
    }

    _setupEventBusSubscriptions() {
        eventBus.on(Events.MESH_LOADED, () => {
            this._stale = true;
            this._segmentMetrics = null;
            this._updateIfVisible();
        }, 'analysisPanel');

        eventBus.on(Events.STATE_CHANGED, () => {
            this._stale = true;
            this._debouncedUpdate();
        }, 'analysisPanel');

        eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, () => {
            this._stale = true;
            this._updateIfVisible();
        }, 'analysisPanel');

        eventBus.on(Events.CONFIG_CHANGED, (data) => {
            if (data.path?.startsWith('units.')) {
                this._updateIfVisible();
            }
        }, 'analysisPanel');

        eventBus.on(Events.RENDERING_CHANGED, () => {
            this._updateIfVisible();
        }, 'analysisPanel');
    }

    _setupControls() {
        if (this._csvExportBtn) {
            this._csvExportBtn.addEventListener('click', () => this.exportCsv());
        }
    }

    dispose() {
        eventBus.offNamespace('analysisPanel');
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
    }

    onShow() {
        this.updateUI();
    }

    _updateIfVisible() {
        const panel = document.getElementById('analysisPanel');
        if (panel && !panel.classList.contains('hidden')) {
            this.updateUI();
        }
    }

    _debouncedUpdate() {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this._updateIfVisible(), 500);
    }

    updateUI() {
        this._updateMeshInfo();
        this._updateAnnotationInfo();
        this._updateSegmentInfo();
    }

    // ── Mesh Information ──────────────────────────────────────────────

    _updateMeshInfo() {
        const vertexCount = this.meshView.vertexCount;
        const faceCount = Math.floor((this.meshView.indices?.length || 0) / 3);

        if (this._vertexCountEl) {
            this._vertexCountEl.textContent = vertexCount > 0 ? vertexCount.toLocaleString() : '--';
        }
        if (this._faceCountEl) {
            this._faceCountEl.textContent = faceCount > 0 ? faceCount.toLocaleString() : '--';
        }

        if (this._bboxValueEl) {
            if (vertexCount > 0) {
                const bbox = this.meshView.basicMesh.computeBoundingInfo();
                const sourceUnit = getSourceUnit(this.meshView.metadata, this.userConfig);
                const displayUnit = getEffectiveUnit(this.meshView.metadata, this.userConfig);
                const dx = formatDistanceConverted(bbox.size.x, sourceUnit, displayUnit);
                const dy = formatDistanceConverted(bbox.size.y, sourceUnit, displayUnit);
                const dz = formatDistanceConverted(bbox.size.z, sourceUnit, displayUnit);
                this._bboxValueEl.textContent = `${dx} × ${dy} × ${dz}`;
            } else {
                this._bboxValueEl.textContent = '--';
            }
        }

        if (this._unitDisplayEl) {
            const displayUnit = getEffectiveUnit(this.meshView.metadata, this.userConfig);
            const def = UNIT_DEFINITIONS[displayUnit];
            this._unitDisplayEl.textContent = `Unit: ${def?.label || displayUnit}`;
        }
    }

    // ── Annotation Summary ────────────────────────────────────────────

    _updateAnnotationInfo() {
        if (this._edgeCountEl) {
            const count = this.meshView.currentEdgeIndices?.size || 0;
            this._edgeCountEl.textContent = count > 0 ? count.toLocaleString() : '0';
        }
        if (this._arrowCountEl) {
            const count = this.meshView.workingAnnotation?.arrows?.length || 0;
            this._arrowCountEl.textContent = count.toString();
        }
    }

    // ── Segment Statistics ────────────────────────────────────────────

    _updateSegmentInfo() {
        const segments = this.meshView.segments;

        if (this.meshView.vertexCount === 0) {
            this._showEmptyState('Load a mesh to see scar statistics');
            return;
        }

        if (!segments || segments.length === 0) {
            this._showEmptyState('Draw edges to segment the mesh into scars');
            return;
        }

        // Recompute metrics if stale
        if (this._stale) {
            this._recomputeMetrics();
        }

        const metrics = this._segmentMetrics || [];
        if (metrics.length === 0) {
            this._showEmptyState('No scars detected');
            return;
        }

        const vertexCount = this.meshView.vertexCount;

        if (this._scarBadgeEl) {
            this._scarBadgeEl.textContent = metrics.length.toString();
        }

        if (this._scarSummaryEl) {
            const totalVertices = metrics.reduce((sum, m) => sum + m.vertexCount, 0);
            const coverage = ((totalVertices / vertexCount) * 100).toFixed(1);
            this._scarSummaryEl.textContent = `${metrics.length} scars covering ${coverage}% of mesh`;
        }

        const sizes = metrics.map(m => m.vertexCount).sort((a, b) => a - b);
        this._renderStats(sizes);
        this._renderChart(metrics);
        this._renderTable(metrics);
    }

    _showEmptyState(message) {
        if (this._scarBadgeEl) this._scarBadgeEl.textContent = '0';
        if (this._scarSummaryEl) this._scarSummaryEl.textContent = message;
        if (this._scarStatsEl) this._scarStatsEl.innerHTML = '';
        if (this._scarChartEl) this._scarChartEl.innerHTML = '';
        if (this._scarTableEl) this._scarTableEl.innerHTML = '';
    }

    _recomputeMetrics() {
        try {
            this._segmentMetrics = computeSegmentMetrics(
                this.meshView.segments,
                this.meshView.faceLabels,
                this.meshView.positions,
                this.meshView.indices
            );
            this._stale = false;
        } catch (e) {
            console.error('[AnalysisPanel] Error computing segment metrics:', e);
            this._segmentMetrics = null;
        }
    }

    /**
     * Get the color for a segment from MeshView.faceColors.
     */
    _getSegmentColor(segmentId) {
        const color = this.meshView.faceColors?.get(segmentId);
        return color ? `#${color.getHexString()}` : null;
    }

    _renderStats(sizes) {
        if (!this._scarStatsEl || sizes.length === 0) return;

        const min = sizes[0];
        const max = sizes[sizes.length - 1];
        const mean = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
        const median = sizes.length % 2 === 0
            ? Math.round((sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2)
            : sizes[Math.floor(sizes.length / 2)];

        this._scarStatsEl.innerHTML = `
            <div class="stat-item"><span class="stat-value">${min.toLocaleString()}</span><span class="stat-label">Min</span></div>
            <div class="stat-item"><span class="stat-value">${max.toLocaleString()}</span><span class="stat-label">Max</span></div>
            <div class="stat-item"><span class="stat-value">${mean.toLocaleString()}</span><span class="stat-label">Mean</span></div>
            <div class="stat-item"><span class="stat-value">${median.toLocaleString()}</span><span class="stat-label">Median</span></div>
        `;
    }

    _renderChart(metrics) {
        if (!this._scarChartEl) return;

        const maxSize = Math.max(...metrics.map(m => m.vertexCount));

        this._scarChartEl.innerHTML = metrics.map((m, i) => {
            const pct = ((m.vertexCount / maxSize) * 100).toFixed(1);
            const colorCss = this._getSegmentColor(m.segmentId) || 'var(--primary)';
            return `
                <div class="analysis-scar-bar-row">
                    <span class="analysis-scar-bar-label">${i + 1}</span>
                    <div class="analysis-scar-bar-track">
                        <div class="analysis-scar-bar-fill" style="width:${pct}%;background:${colorCss}"></div>
                    </div>
                    <span class="analysis-scar-bar-value">${m.vertexCount.toLocaleString()}</span>
                </div>
            `;
        }).join('');
    }

    _renderTable(metrics) {
        if (!this._scarTableEl || metrics.length === 0) return;

        const sourceUnit = getSourceUnit(this.meshView.metadata, this.userConfig);
        const displayUnit = getEffectiveUnit(this.meshView.metadata, this.userConfig);
        const unitDef = UNIT_DEFINITIONS[displayUnit];
        const unitSuffix = unitDef?.symbol ? ` (${unitDef.symbol})` : '';
        const areaSuffix = unitDef?.symbol ? ` (${unitDef.symbol}²)` : '';
        const totalVertices = this.meshView.vertexCount;

        let html = `<table>
            <thead><tr>
                <th>#</th>
                <th>Vertices</th>
                <th>Area${areaSuffix}</th>
                <th>Max Dim${unitSuffix}</th>
                <th>%</th>
            </tr></thead>
            <tbody>`;

        metrics.forEach((m, i) => {
            const colorCss = this._getSegmentColor(m.segmentId) || '#999';
            const area = formatAreaConverted(m.surfaceArea, sourceUnit, displayUnit);
            const maxDim = formatDistanceConverted(m.maxDimension, sourceUnit, displayUnit);
            const pct = ((m.vertexCount / totalVertices) * 100).toFixed(1);

            html += `<tr>
                <td><span class="scar-color-swatch" style="background:${colorCss}"></span>${i + 1}</td>
                <td>${m.vertexCount.toLocaleString()}</td>
                <td>${area}</td>
                <td>${maxDim}</td>
                <td>${pct}%</td>
            </tr>`;
        });

        html += '</tbody></table>';
        this._scarTableEl.innerHTML = html;
    }

    // ── CSV Export ────────────────────────────────────────────────────

    exportCsv() {
        if (!this._segmentMetrics || this._segmentMetrics.length === 0) return;

        const sourceUnit = getSourceUnit(this.meshView.metadata, this.userConfig);
        const displayUnit = getEffectiveUnit(this.meshView.metadata, this.userConfig);
        const unitDef = UNIT_DEFINITIONS[displayUnit];
        const unitLabel = unitDef?.symbol || 'raw';
        const totalVertices = this.meshView.vertexCount;

        const headers = [
            'scar_id',
            'vertex_count',
            `surface_area_${unitLabel}2`,
            `max_dimension_${unitLabel}`,
            'percent_of_mesh',
            `centroid_x_${unitLabel}`,
            `centroid_y_${unitLabel}`,
            `centroid_z_${unitLabel}`
        ];

        const from = UNIT_DEFINITIONS[sourceUnit] || UNIT_DEFINITIONS['raw'];
        const to = UNIT_DEFINITIONS[displayUnit] || UNIT_DEFINITIONS['raw'];
        const factor = from.factor / to.factor;

        const rows = this._segmentMetrics.map((m, i) => {
            const area = m.surfaceArea * factor * factor;
            const maxDim = m.maxDimension * factor;
            const cx = m.centroid.x * factor;
            const cy = m.centroid.y * factor;
            const cz = m.centroid.z * factor;
            const pct = ((m.vertexCount / totalVertices) * 100).toFixed(2);

            return [i + 1, m.vertexCount, area.toFixed(4), maxDim.toFixed(4), pct, cx.toFixed(4), cy.toFixed(4), cz.toFixed(4)].join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const meshName = this.meshLoader?.currentFileName?.replace(/\.[^.]+$/, '') || 'lithic';
        a.download = `${meshName}_scar_metrics.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
