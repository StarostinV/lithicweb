/**
 * AnalysisPanel - Displays mesh, annotation, and scar statistics.
 *
 * Sections:
 * - Mesh Information: vertex/face count, bounding box
 * - Annotation Summary: edge vertex count, arrow count
 * - Scar Statistics: count, size distribution, bar chart, attribute table, CSV export
 *
 * @module AnalysisPanel
 */

import { eventBus, Events } from '../utils/EventBus.js';
import { buildScarGraph } from '../geometry/ScarGraph.js';
import { getEffectiveUnit, getSourceUnit, formatDistance, formatDistanceConverted, formatAreaConverted, UNIT_DEFINITIONS } from '../utils/units.js';
import { computeScarMetrics } from '../geometry/scarMetrics.js';

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

        // Cached scar data
        this._scarGraph = null;
        this._scarMetrics = null;
        this._scarStale = true;
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
            this._scarStale = true;
            this._scarGraph = null;
            this._scarMetrics = null;
            this._updateIfVisible();
        }, 'analysisPanel');

        eventBus.on(Events.STATE_CHANGED, () => {
            this._scarStale = true;
            this._debouncedUpdate();
        }, 'analysisPanel');

        eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, () => {
            this._scarStale = true;
            this._updateIfVisible();
        }, 'analysisPanel');

        eventBus.on(Events.CONFIG_CHANGED, (data) => {
            if (data.path?.startsWith('units.')) {
                this._updateIfVisible();
            }
        }, 'analysisPanel');

        // Re-render when colors change (colormap, rendering mode, etc.)
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

    /**
     * Called when panel becomes visible.
     */
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
        this._updateScarInfo();
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

        // Bounding box
        if (this._bboxValueEl) {
            if (vertexCount > 0) {
                const bbox = this._computeBoundingBox();
                const sourceUnit = getSourceUnit(this.meshView.metadata, this.userConfig);
                const displayUnit = getEffectiveUnit(this.meshView.metadata, this.userConfig);
                const dx = formatDistanceConverted(bbox.dx, sourceUnit, displayUnit);
                const dy = formatDistanceConverted(bbox.dy, sourceUnit, displayUnit);
                const dz = formatDistanceConverted(bbox.dz, sourceUnit, displayUnit);
                this._bboxValueEl.textContent = `${dx} × ${dy} × ${dz}`;
            } else {
                this._bboxValueEl.textContent = '--';
            }
        }

        // Unit display
        if (this._unitDisplayEl) {
            const displayUnit = getEffectiveUnit(this.meshView.metadata, this.userConfig);
            const def = UNIT_DEFINITIONS[displayUnit];
            this._unitDisplayEl.textContent = `Unit: ${def?.label || displayUnit}`;
        }
    }

    _computeBoundingBox() {
        const positions = this.meshView.positions;
        if (!positions || positions.length === 0) return { dx: 0, dy: 0, dz: 0 };

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i], y = positions[i + 1], z = positions[i + 2];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }

        return {
            dx: maxX - minX,
            dy: maxY - minY,
            dz: maxZ - minZ
        };
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

    // ── Scar Statistics ───────────────────────────────────────────────

    _updateScarInfo() {
        if (this.meshView.vertexCount === 0) {
            this._showEmptyScarState('Load a mesh to see scar statistics');
            return;
        }

        if (!this.meshView.currentEdgeIndices || this.meshView.currentEdgeIndices.size === 0) {
            this._showEmptyScarState('Draw edges to segment the mesh into scars');
            return;
        }

        // Recompute if stale
        if (this._scarStale) {
            this._recomputeScars();
        }

        if (!this._scarGraph || this._scarGraph.scars.length === 0) {
            this._showEmptyScarState('No scars detected');
            return;
        }

        const scars = this._scarGraph.scars;
        const metrics = this._scarMetrics || [];
        const vertexCount = this.meshView.vertexCount;

        // Badge
        if (this._scarBadgeEl) {
            this._scarBadgeEl.textContent = scars.length.toString();
        }

        // Summary
        if (this._scarSummaryEl) {
            const totalVertices = scars.reduce((sum, s) => sum + s.vertexCount, 0);
            const coverage = ((totalVertices / vertexCount) * 100).toFixed(1);
            this._scarSummaryEl.textContent = `${scars.length} scars covering ${coverage}% of mesh`;
        }

        // Distribution stats
        const sizes = scars.map(s => s.vertexCount).sort((a, b) => a - b);
        this._renderScarStats(sizes);

        // Bar chart
        this._renderScarChart(scars);

        // Attribute table
        this._renderScarTable(metrics);
    }

    _showEmptyScarState(message) {
        if (this._scarBadgeEl) this._scarBadgeEl.textContent = '0';
        if (this._scarSummaryEl) this._scarSummaryEl.textContent = message;
        if (this._scarStatsEl) this._scarStatsEl.innerHTML = '';
        if (this._scarChartEl) this._scarChartEl.innerHTML = '';
        if (this._scarTableEl) this._scarTableEl.innerHTML = '';
    }

    _recomputeScars() {
        try {
            this._scarGraph = buildScarGraph(
                this.meshView.faceLabels,
                this.meshView.currentEdgeIndices,
                this.meshView.adjacencyGraph,
                this.meshView.vertexCount,
                this.meshView.positions,
                this.meshView.indices
            );
            this._scarMetrics = computeScarMetrics(
                this._scarGraph,
                this.meshView.positions,
                this.meshView.indices,
                this._scarGraph.workingLabels
            );
            this._scarStale = false;
        } catch (e) {
            console.error('[AnalysisPanel] Error computing scar graph:', e);
            this._scarGraph = null;
            this._scarMetrics = null;
        }
    }

    _renderScarStats(sizes) {
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

    /**
     * Get the actual rendered color for a scar by reading its representative vertex
     * from the mesh color buffer. This always matches the on-screen color regardless
     * of colormap, ordering, or rendering mode changes.
     */
    _getScarColor(scar) {
        const colors = this.meshView.meshColors;
        if (!colors || scar.representativeVertex == null) return null;
        const idx = scar.representativeVertex * 3;
        if (idx + 2 >= colors.length) return null;
        const r = Math.round(colors[idx] * 255);
        const g = Math.round(colors[idx + 1] * 255);
        const b = Math.round(colors[idx + 2] * 255);
        return `rgb(${r},${g},${b})`;
    }

    _renderScarChart(scars) {
        if (!this._scarChartEl) return;

        const maxSize = Math.max(...scars.map(s => s.vertexCount));

        this._scarChartEl.innerHTML = scars.map((scar, i) => {
            const pct = ((scar.vertexCount / maxSize) * 100).toFixed(1);
            const colorCss = this._getScarColor(scar) || 'var(--primary)';
            return `
                <div class="analysis-scar-bar-row">
                    <span class="analysis-scar-bar-label">${i + 1}</span>
                    <div class="analysis-scar-bar-track">
                        <div class="analysis-scar-bar-fill" style="width:${pct}%;background:${colorCss}"></div>
                    </div>
                    <span class="analysis-scar-bar-value">${scar.vertexCount.toLocaleString()}</span>
                </div>
            `;
        }).join('');
    }

    _renderScarTable(metrics) {
        if (!this._scarTableEl || !metrics || metrics.length === 0) return;

        const sourceUnit = getSourceUnit(this.meshView.metadata, this.userConfig);
        const displayUnit = getEffectiveUnit(this.meshView.metadata, this.userConfig);
        const unitDef = UNIT_DEFINITIONS[displayUnit];
        const unitSuffix = unitDef?.symbol ? ` (${unitDef.symbol})` : '';
        const areaSuffix = unitDef?.symbol ? ` (${unitDef.symbol}²)` : '';
        const scars = this._scarGraph?.scars || [];
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
            const scar = scars.find(s => s.scarId === m.scarId);
            const colorCss = scar ? this._getScarColor(scar) : null;
            const colorHex = colorCss || '#999';
            const area = formatAreaConverted(m.surfaceArea, sourceUnit, displayUnit);
            const maxDim = formatDistanceConverted(m.maxDimension, sourceUnit, displayUnit);
            const pct = ((m.vertexCount / totalVertices) * 100).toFixed(1);

            html += `<tr>
                <td><span class="scar-color-swatch" style="background:${colorHex}"></span>${i + 1}</td>
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
        if (!this._scarMetrics || this._scarMetrics.length === 0) return;

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

        const rows = this._scarMetrics.map((m, i) => {
            const from = UNIT_DEFINITIONS[sourceUnit] || UNIT_DEFINITIONS['raw'];
            const to = UNIT_DEFINITIONS[displayUnit] || UNIT_DEFINITIONS['raw'];
            const factor = from.factor / to.factor;
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
