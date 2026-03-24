/**
 * AnalysisPanel - Interactive scar analysis with scar graph integration.
 *
 * Features: sortable metrics, colormap recoloring, canvas labels,
 * click-to-select with per-scar detail, individual color overrides.
 *
 * @module AnalysisPanel
 */

import * as THREE from 'three';
import { eventBus, Events } from '../utils/EventBus.js';
import { MODES } from '../utils/mode.js';
import { getEffectiveUnit, getSourceUnit, formatDistanceConverted, formatAreaConverted, UNIT_DEFINITIONS } from '../utils/units.js';
import { ScarGraphContext } from '../geometry/ScarGraphContext.js';
import { computeScarMetrics } from '../geometry/scarMetrics.js';
import { ScarOrdering } from '../geometry/ScarOrdering.js';
import { METRIC_REGISTRY, getMetricByKey, getAvailableMetrics } from '../geometry/metricRegistry.js';
import { sampleColormap, colormapHexColors } from '../utils/colormaps.js';

export class AnalysisPanel {
    /**
     * @param {import('./MeshView.js').MeshView} meshView
     * @param {import('../utils/meshLoader.js').MeshLoader} meshLoader
     * @param {import('../utils/UserConfig.js').UserConfig} userConfig
     * @param {import('../utils/mode.js').Mode} mode
     */
    constructor(meshView, meshLoader, userConfig, mode) {
        this.meshView = meshView;
        this.meshLoader = meshLoader;
        this.userConfig = userConfig;
        this.mode = mode;

        // Scar graph context
        this._graphContext = null;
        this._scarMetrics = null; // Map<scarId, metrics>
        this._stale = true;
        this._debounceTimer = null;

        // Metric & sort state
        this._activeMetricKey = 'surfaceArea';
        this._sortAscending = false;
        this._sortByKey = 'surfaceArea'; // which column is sorted in the table

        // Colormap state
        this._colormapEnabled = false;
        this._colormapName = 'blueRed';

        // Label state
        this._labelsVisible = false;

        // Selection state
        this._selectedScarId = null;

        // Canvas click handler bound reference
        this._boundClickHandler = null;
        this._panelActive = false;

        // DOM elements - Mesh info
        this._vertexCountEl = document.getElementById('analysisVertexCount');
        this._faceCountEl = document.getElementById('analysisFaceCount');
        this._bboxValueEl = document.getElementById('analysisBboxValue');
        this._unitDisplayEl = document.getElementById('analysisUnitDisplay');
        this._edgeCountEl = document.getElementById('analysisEdgeCount');
        this._arrowCountEl = document.getElementById('analysisArrowCount');

        // DOM elements - Scar statistics
        this._scarBadgeEl = document.getElementById('analysisScarBadge');
        this._scarEmptyEl = document.getElementById('analysisScarEmpty');
        this._scarControlsEl = document.getElementById('analysisScarControls');
        this._metricSelectEl = document.getElementById('analysisMetricSelect');
        this._sortToggleEl = document.getElementById('analysisSortToggle');
        this._colormapCheckEl = document.getElementById('analysisColormapEnabled');
        this._colormapSelectEl = document.getElementById('analysisColormapSelect');
        this._labelsCheckEl = document.getElementById('analysisLabelsEnabled');
        this._colormapLegendEl = document.getElementById('analysisColormapLegend');
        this._colormapLegendBarEl = document.getElementById('analysisColormapLegendBar');
        this._scarStatsEl = document.getElementById('analysisScarStats');
        this._scarChartEl = document.getElementById('analysisScarChart');
        this._scarTableEl = document.getElementById('analysisScarTable');
        this._csvExportBtn = document.getElementById('analysisCsvExportBtn');

        // DOM elements - Selected scar detail
        this._selectedDetailEl = document.getElementById('analysisSelectedScar');
        this._selectedTitleEl = document.getElementById('analysisSelectedTitle');
        this._selectedMetricsEl = document.getElementById('analysisSelectedMetrics');
        this._selectedColorEl = document.getElementById('analysisSelectedColor');
        this._selectedFocusEl = document.getElementById('analysisSelectedFocus');
        this._selectedCloseEl = document.getElementById('analysisSelectedClose');

        // Label overlay elements (shared with order panel)
        this._overlayEl = document.getElementById('scarLabelsOverlay');
        this._svgEl = document.getElementById('scarLabelsSvg');

        this._setupEventBusSubscriptions();
        this._setupControls();
    }

    _setupEventBusSubscriptions() {
        eventBus.on(Events.MESH_LOADED, () => {
            this._stale = true;
            this._clearGraphState();
            this._updateIfVisible();
        }, 'analysisPanel');

        eventBus.on(Events.STATE_CHANGED, () => {
            this._stale = true;
            this._debouncedUpdate();
        }, 'analysisPanel');

        eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, () => {
            this._stale = true;
            this._clearGraphState();
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
        if (this._metricSelectEl) {
            this._metricSelectEl.addEventListener('change', () => {
                this._activeMetricKey = this._metricSelectEl.value;
                this._sortByKey = this._activeMetricKey;
                this._updateScarUI();
            });
        }
        if (this._sortToggleEl) {
            this._sortToggleEl.addEventListener('click', () => {
                this._sortAscending = !this._sortAscending;
                this._updateSortIcon();
                this._updateScarUI();
            });
        }
        if (this._colormapCheckEl) {
            this._colormapCheckEl.addEventListener('change', () => {
                this._colormapEnabled = this._colormapCheckEl.checked;
                this._applyColormapState();
            });
        }
        if (this._colormapSelectEl) {
            this._colormapSelectEl.addEventListener('change', () => {
                this._colormapName = this._colormapSelectEl.value;
                if (this._colormapEnabled) this._applyColormapState();
            });
        }
        if (this._labelsCheckEl) {
            this._labelsCheckEl.addEventListener('change', () => {
                this._labelsVisible = this._labelsCheckEl.checked;
                this._applyLabelState();
            });
        }
        if (this._selectedCloseEl) {
            this._selectedCloseEl.addEventListener('click', () => this._deselectScar());
        }
        if (this._selectedFocusEl) {
            this._selectedFocusEl.addEventListener('click', () => {
                if (this._selectedScarId != null && this._graphContext) {
                    this._graphContext.focusCameraOnScar(this._selectedScarId);
                }
            });
        }
        if (this._selectedColorEl) {
            this._selectedColorEl.addEventListener('input', (e) => {
                if (this._selectedScarId != null && this._graphContext) {
                    const hex = e.target.value;
                    this._graphContext.colorScar(this._selectedScarId, new THREE.Color(hex));
                }
            });
        }
    }

    dispose() {
        eventBus.offNamespace('analysisPanel');
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._teardownCanvasClick();
        this._graphContext?.dispose();
    }

    // ── Panel lifecycle ───────────────────────────────────────────────

    onShow() {
        this._panelActive = true;
        this.updateUI();
        this._setupCanvasClick();
        // Always visually remove edges when entering the panel
        if (this._graphContext?.isInitialized) {
            this._graphContext.recolorAllScars();
            if (this._colormapEnabled) this._applyColormapColors();
        }
        if (this._labelsVisible) this._applyLabelState();
    }

    onHide() {
        this._panelActive = false;
        this._teardownCanvasClick();
        this._deselectScar();
        if (this._graphContext) {
            this._graphContext.stopLabelLoop();
            this._graphContext.removeLabels();
            this._graphContext.restoreAllHighlights();
            // Always restore normal view (edges visible) when leaving
            this._graphContext.restoreNormalView();
        }
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

    _clearGraphState() {
        if (this._graphContext) {
            this._graphContext.stopLabelLoop();
            this._graphContext.removeLabels();
            this._graphContext.restoreAllHighlights();
            this._graphContext.clear();
        }
        this._graphContext = null;
        this._scarMetrics = null;
        this._selectedScarId = null;
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

    // ── Scar Statistics ───────────────────────────────────────────────

    _updateScarInfo() {
        const segments = this.meshView.segments;

        if (this.meshView.vertexCount === 0) {
            this._showEmptyState('Load a mesh to see scar statistics');
            return;
        }

        if (!segments || segments.length < 2) {
            this._showEmptyState('Draw edges to segment the mesh into scars');
            return;
        }

        // Initialize graph if needed
        if (this._stale || !this._graphContext?.isInitialized) {
            this._initGraph();
        }

        if (!this._graphContext?.isInitialized || !this._scarMetrics) {
            this._showEmptyState('No scars detected');
            return;
        }

        // Show controls, hide empty state
        if (this._scarEmptyEl) this._scarEmptyEl.style.display = 'none';
        if (this._scarControlsEl) this._scarControlsEl.classList.remove('hidden');

        const scars = this._graphContext.scarGraph.scars;
        if (this._scarBadgeEl) this._scarBadgeEl.textContent = String(scars.length);

        // Populate metric dropdown
        this._populateMetricSelect();
        this._updateSortIcon();
        this._updateScarUI();
    }

    _initGraph() {
        if (!this._graphContext) {
            this._graphContext = new ScarGraphContext(this.meshView);
        } else {
            this._graphContext.clear();
        }

        const ok = this._graphContext.initialize();
        if (!ok) {
            this._scarMetrics = null;
            return;
        }

        // Try loading temporal ordering from annotation metadata
        let ordering = null;
        const existing = this.meshView.workingAnnotation?.getMetadata('scarOrder');
        if (existing && existing.version === 1 && existing.scars) {
            const savedVerts = new Set(existing.scars.map(s => s.representativeVertex));
            const currentVerts = new Set(this._graphContext.scarGraph.scars.map(s => s.representativeVertex));
            const match = savedVerts.size === currentVerts.size &&
                          [...savedVerts].every(v => currentVerts.has(v));
            if (match) {
                ordering = ScarOrdering.fromMetadata(existing, this._graphContext.scarGraph);
            }
        }

        this._scarMetrics = computeScarMetrics(
            this._graphContext,
            this.meshView.positions,
            this.meshView.indices,
            this.meshView.basicMesh,
            ordering
        );

        this._stale = false;

        // Apply visual state
        this._graphContext.recolorAllScars();
        if (this._colormapEnabled) this._applyColormapColors();
        if (this._labelsVisible && this._panelActive) this._applyLabelState();
    }

    _showEmptyState(message) {
        if (this._scarBadgeEl) this._scarBadgeEl.textContent = '0';
        if (this._scarEmptyEl) {
            this._scarEmptyEl.style.display = '';
            this._scarEmptyEl.textContent = message;
        }
        if (this._scarControlsEl) this._scarControlsEl.classList.add('hidden');
        if (this._scarStatsEl) this._scarStatsEl.innerHTML = '';
        if (this._scarChartEl) this._scarChartEl.innerHTML = '';
        if (this._scarTableEl) this._scarTableEl.innerHTML = '';
        if (this._selectedDetailEl) this._selectedDetailEl.classList.add('hidden');
        if (this._colormapLegendEl) this._colormapLegendEl.classList.add('hidden');
    }

    // ── Metric dropdown ───────────────────────────────────────────────

    _populateMetricSelect() {
        if (!this._metricSelectEl || !this._scarMetrics) return;
        const available = getAvailableMetrics(this._scarMetrics);
        const current = this._metricSelectEl.value;

        this._metricSelectEl.innerHTML = available.map(m =>
            `<option value="${m.key}"${m.key === this._activeMetricKey ? ' selected' : ''}>${m.label}</option>`
        ).join('');

        // If active key not in available, reset to first
        if (!available.find(m => m.key === this._activeMetricKey) && available.length > 0) {
            this._activeMetricKey = available[0].key;
            this._sortByKey = this._activeMetricKey;
            this._metricSelectEl.value = this._activeMetricKey;
        }
    }

    _updateSortIcon() {
        if (!this._sortToggleEl) return;
        const icon = this._sortToggleEl.querySelector('i');
        if (icon) {
            icon.className = this._sortAscending ? 'fas fa-sort-amount-up' : 'fas fa-sort-amount-down';
        }
    }

    // ── Sorting ───────────────────────────────────────────────────────

    _getSortedScars() {
        if (!this._graphContext?.scarGraph || !this._scarMetrics) return [];
        const metricDef = getMetricByKey(this._sortByKey);
        if (!metricDef) return [...this._graphContext.scarGraph.scars];

        const scars = [...this._graphContext.scarGraph.scars];
        const metrics = this._scarMetrics;
        const asc = this._sortAscending;

        scars.sort((a, b) => {
            const va = metricDef.compute(a.scarId, metrics);
            const vb = metricDef.compute(b.scarId, metrics);
            // Nulls last
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            return asc ? va - vb : vb - va;
        });

        return scars;
    }

    // ── UI rendering ──────────────────────────────────────────────────

    _updateScarUI() {
        const sorted = this._getSortedScars();
        this._renderStats(sorted);
        this._renderChart(sorted);
        this._renderTable(sorted);
        if (this._colormapEnabled) this._applyColormapColors();
        if (this._labelsVisible && this._panelActive) this._refreshLabels();
    }

    _getUnitContext() {
        const sourceUnit = getSourceUnit(this.meshView.metadata, this.userConfig);
        const displayUnit = getEffectiveUnit(this.meshView.metadata, this.userConfig);
        const unitDef = UNIT_DEFINITIONS[displayUnit];
        return {
            source: sourceUnit,
            display: displayUnit,
            symbol: unitDef?.symbol || 'raw',
        };
    }

    _renderStats(sortedScars) {
        if (!this._scarStatsEl || sortedScars.length === 0) return;

        const metricDef = getMetricByKey(this._activeMetricKey);
        if (!metricDef) return;

        const values = sortedScars.map(s => metricDef.compute(s.scarId, this._scarMetrics)).filter(v => v != null);
        if (values.length === 0) {
            this._scarStatsEl.innerHTML = '';
            return;
        }

        values.sort((a, b) => a - b);
        const unitCtx = this._getUnitContext();

        const min = values[0];
        const max = values[values.length - 1];
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const median = values.length % 2 === 0
            ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];

        this._scarStatsEl.innerHTML = `
            <div class="stat-item"><span class="stat-value">${metricDef.format(min, unitCtx)}</span><span class="stat-label">Min</span></div>
            <div class="stat-item"><span class="stat-value">${metricDef.format(max, unitCtx)}</span><span class="stat-label">Max</span></div>
            <div class="stat-item"><span class="stat-value">${metricDef.format(mean, unitCtx)}</span><span class="stat-label">Mean</span></div>
            <div class="stat-item"><span class="stat-value">${metricDef.format(median, unitCtx)}</span><span class="stat-label">Median</span></div>
        `;
    }

    _renderChart(sortedScars) {
        if (!this._scarChartEl) return;

        const metricDef = getMetricByKey(this._activeMetricKey);
        if (!metricDef || sortedScars.length === 0) {
            this._scarChartEl.innerHTML = '';
            return;
        }

        const values = sortedScars.map(s => metricDef.compute(s.scarId, this._scarMetrics) ?? 0);
        const maxVal = Math.max(...values);
        if (maxVal === 0) {
            this._scarChartEl.innerHTML = '';
            return;
        }

        const unitCtx = this._getUnitContext();

        this._scarChartEl.innerHTML = sortedScars.map((scar, i) => {
            const val = values[i];
            const pct = ((val / maxVal) * 100).toFixed(1);
            const colorCss = this._getScarDisplayColor(scar.scarId);
            const selected = scar.scarId === this._selectedScarId ? ' selected' : '';
            return `
                <div class="analysis-scar-bar-row${selected}" data-scar-id="${scar.scarId}">
                    <span class="analysis-scar-bar-label">${i + 1}</span>
                    <div class="analysis-scar-bar-track">
                        <div class="analysis-scar-bar-fill" style="width:${pct}%;background:${colorCss}"></div>
                    </div>
                    <span class="analysis-scar-bar-value">${metricDef.format(val, unitCtx)}</span>
                </div>
            `;
        }).join('');
    }

    _renderTable(sortedScars) {
        if (!this._scarTableEl || sortedScars.length === 0) {
            if (this._scarTableEl) this._scarTableEl.innerHTML = '';
            return;
        }

        const available = getAvailableMetrics(this._scarMetrics);
        const unitCtx = this._getUnitContext();

        // Table headers
        let html = '<table><thead><tr><th>#</th>';
        for (const m of available) {
            const sorted = m.key === this._sortByKey;
            const arrow = sorted ? (this._sortAscending ? '&#9650;' : '&#9660;') : '&#9650;';
            const cls = `sortable${sorted ? ' sorted' : ''}`;
            html += `<th class="${cls}" data-sort-key="${m.key}">${m.shortLabel} <span class="sort-indicator">${arrow}</span></th>`;
        }
        html += '</tr></thead><tbody>';

        // Table rows
        sortedScars.forEach((scar, i) => {
            const colorCss = this._getScarDisplayColor(scar.scarId);
            const selected = scar.scarId === this._selectedScarId ? ' class="selected"' : '';
            html += `<tr${selected} data-scar-id="${scar.scarId}">`;
            html += `<td><span class="scar-color-swatch" style="background:${colorCss}"></span>${i + 1}</td>`;
            for (const m of available) {
                const val = m.compute(scar.scarId, this._scarMetrics);
                html += `<td>${m.format(val, unitCtx)}</td>`;
            }
            html += '</tr>';
        });

        html += '</tbody></table>';
        this._scarTableEl.innerHTML = html;

        // Attach sort handlers on headers
        this._scarTableEl.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sortKey;
                if (this._sortByKey === key) {
                    this._sortAscending = !this._sortAscending;
                } else {
                    this._sortByKey = key;
                    this._sortAscending = false;
                }
                this._updateSortIcon();
                this._updateScarUI();
            });
        });

        // Attach row click handlers
        this._scarTableEl.querySelectorAll('tbody tr').forEach(tr => {
            tr.addEventListener('click', () => {
                const scarId = parseInt(tr.dataset.scarId, 10);
                if (!isNaN(scarId)) this._selectScar(scarId);
            });
        });
    }

    // ── Scar display color ────────────────────────────────────────────

    _getScarDisplayColor(scarId) {
        // Colormap color
        if (this._colormapEnabled) {
            const colormapMap = this._buildColormapMap();
            const t = colormapMap.get(scarId);
            if (t !== undefined) {
                const [r, g, b] = sampleColormap(this._colormapName, t);
                const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
                return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            }
        }
        // Segment color
        if (this._graphContext) {
            return this._graphContext.getScarSegmentColor(scarId);
        }
        return '#888';
    }

    // ── Colormap ──────────────────────────────────────────────────────

    _buildColormapMap() {
        const sorted = this._getSortedScars();
        const map = new Map();
        for (let i = 0; i < sorted.length; i++) {
            map.set(sorted[i].scarId, sorted.length > 1 ? i / (sorted.length - 1) : 0.5);
        }
        return map;
    }

    _applyColormapState() {
        if (!this._graphContext?.isInitialized) return;

        if (this._colormapEnabled) {
            this._applyColormapColors();
            this._updateColormapLegend();
            if (this._colormapLegendEl) this._colormapLegendEl.classList.remove('hidden');
        } else {
            // Restore segment colors (reads from faceColors, which includes any custom colors)
            this._graphContext.recolorAllScars();
            if (this._colormapLegendEl) this._colormapLegendEl.classList.add('hidden');
        }

        // Re-render chart/table for updated colors
        const sorted = this._getSortedScars();
        this._renderChart(sorted);
        this._renderTable(sorted);
        if (this._labelsVisible && this._panelActive) this._refreshLabels();
    }

    _applyColormapColors() {
        if (!this._graphContext) return;
        const colormapMap = this._buildColormapMap();
        this._graphContext.applyColormap(this._colormapName, colormapMap);
    }

    _updateColormapLegend() {
        if (!this._colormapLegendBarEl) return;
        const colors = colormapHexColors(this._colormapName, 20);
        this._colormapLegendBarEl.style.background =
            `linear-gradient(to right, ${colors.join(', ')})`;
    }

    // ── Labels ────────────────────────────────────────────────────────

    _applyLabelState() {
        if (!this._graphContext?.isInitialized) return;

        if (this._labelsVisible && this._panelActive) {
            this._refreshLabels();
            this._graphContext.startLabelLoop();
        } else {
            this._graphContext.stopLabelLoop();
            this._graphContext.removeLabels();
        }
    }

    _refreshLabels() {
        if (!this._graphContext?.isInitialized) return;
        const sorted = this._getSortedScars();
        const rankMap = new Map();
        sorted.forEach((scar, i) => rankMap.set(scar.scarId, i + 1));

        this._graphContext.createLabels(this._overlayEl, this._svgEl, (scarId) => {
            const rank = rankMap.get(scarId);
            if (rank === undefined) return null;
            return {
                text: String(rank),
                color: this._getScarDisplayColor(scarId),
            };
        });
    }

    // ── Canvas click interaction ──────────────────────────────────────

    _setupCanvasClick() {
        if (this._boundClickHandler) return;
        const canvas = this.meshView.scene?.canvas;
        if (!canvas) return;

        this._boundClickHandler = (event) => {
            if (event.button !== 0) return; // left click only
            // Don't intercept when in drawing modes
            const m = this.mode.currentMode;
            if (m !== MODES.VIEW && m !== MODES.SCAR_ORDER) return;

            this._handleMeshClick(event);
        };
        canvas.addEventListener('pointerdown', this._boundClickHandler);
    }

    _teardownCanvasClick() {
        if (!this._boundClickHandler) return;
        const canvas = this.meshView.scene?.canvas;
        if (canvas) canvas.removeEventListener('pointerdown', this._boundClickHandler);
        this._boundClickHandler = null;
    }

    _handleMeshClick(event) {
        if (!this._graphContext?.isInitialized) return;
        const vertexIndex = this.meshView.getClosestVertexIndex(event);
        if (vertexIndex < 0) return;

        const scarId = this._graphContext.vertexToScarId(vertexIndex);
        if (scarId === undefined) return;

        this._selectScar(scarId);
    }

    // ── Scar selection ────────────────────────────────────────────────

    _selectScar(scarId) {
        // Deselect previous
        this._graphContext?.restoreAllHighlights();

        this._selectedScarId = scarId;

        // Highlight on mesh
        if (this._graphContext) {
            this._graphContext.highlightScar(scarId, new THREE.Color(0x3b82f6));
        }

        // Show detail panel
        this._renderSelectedDetail(scarId);

        // Highlight in table
        if (this._scarTableEl) {
            this._scarTableEl.querySelectorAll('tr.selected').forEach(tr => tr.classList.remove('selected'));
            const row = this._scarTableEl.querySelector(`tr[data-scar-id="${scarId}"]`);
            if (row) row.classList.add('selected');
        }
    }

    _deselectScar() {
        if (this._graphContext) {
            this._graphContext.restoreAllHighlights();
        }
        this._selectedScarId = null;
        if (this._selectedDetailEl) this._selectedDetailEl.classList.add('hidden');
        if (this._scarTableEl) {
            this._scarTableEl.querySelectorAll('tr.selected').forEach(tr => tr.classList.remove('selected'));
        }
    }

    _renderSelectedDetail(scarId) {
        if (!this._selectedDetailEl || !this._scarMetrics) return;

        const metrics = this._scarMetrics.get(scarId);
        if (!metrics) return;

        // Title
        const sorted = this._getSortedScars();
        const rank = sorted.findIndex(s => s.scarId === scarId) + 1;
        if (this._selectedTitleEl) {
            this._selectedTitleEl.textContent = `Scar #${rank} (${metrics.vertexCount} vertices)`;
        }

        // Metrics
        const available = getAvailableMetrics(this._scarMetrics);
        const unitCtx = this._getUnitContext();

        if (this._selectedMetricsEl) {
            this._selectedMetricsEl.innerHTML = available.map(m => {
                const val = m.compute(scarId, this._scarMetrics);
                return `<div class="analysis-selected-metric">
                    <span class="analysis-selected-metric-label">${m.label}</span>
                    <span class="analysis-selected-metric-value">${m.format(val, unitCtx)}</span>
                </div>`;
            }).join('');
        }

        // Color picker - set to current color
        if (this._selectedColorEl) {
            this._selectedColorEl.value = this._getScarDisplayColor(scarId);
        }

        this._selectedDetailEl.classList.remove('hidden');
    }

    // ── CSV Export ────────────────────────────────────────────────────

    exportCsv() {
        if (!this._scarMetrics || this._scarMetrics.size === 0) return;

        const unitCtx = this._getUnitContext();
        const from = UNIT_DEFINITIONS[unitCtx.source] || UNIT_DEFINITIONS['raw'];
        const to = UNIT_DEFINITIONS[unitCtx.display] || UNIT_DEFINITIONS['raw'];
        const factor = from.factor / to.factor;
        const sorted = this._getSortedScars();

        // Headers from registry
        const available = getAvailableMetrics(this._scarMetrics);
        const headers = ['rank', ...available.map(m => m.csvHeader(unitCtx))];

        const rows = sorted.map((scar, i) => {
            const m = this._scarMetrics.get(scar.scarId);
            const vals = available.map(def => {
                const v = def.compute(scar.scarId, this._scarMetrics);
                if (v == null) return '';
                // Apply unit conversion for distance/area metrics
                if (def.key === 'surfaceArea') return (v * factor * factor).toFixed(4);
                if (def.key === 'maxDimension') return (v * factor).toFixed(4);
                if (def.key === 'meanCurvature') return (v * 180 / Math.PI).toFixed(2); // degrees
                return String(v);
            });
            return [i + 1, ...vals].join(',');
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
