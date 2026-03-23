import * as THREE from 'three';
import { MODES } from '../utils/mode.js';
import { eventBus, Events } from '../utils/EventBus.js';
import { buildScarGraph } from '../geometry/ScarGraph.js';
import { ScarOrdering } from '../geometry/ScarOrdering.js';
import { sampleColormap, colormapHexColors } from '../utils/colormaps.js';

const YOUNGER_COLOR = new THREE.Color(0x22c55e);
const OLDER_COLOR = new THREE.Color(0xef4444);
const LABEL_OFFSET_PX = 45;
const LABEL_MIN_DIST = 32; // min distance between labels before repulsion
const LABEL_REPULSION_ITERS = 4;

/**
 * ScarOrderPanel - UI for temporal ordering of lithic scars.
 *
 * Two-click directional interaction:
 * 1. Click the younger scar (highlights green)
 * 2. Click the older adjacent scar (comparison auto-recorded)
 */
export class ScarOrderPanel {
    constructor(meshView, mode) {
        this.meshView = meshView;
        this.mode = mode;
        this.scarGraph = null;
        this.ordering = null;
        this._panelActive = false; // whether the panel is currently shown

        // Lookup maps
        this._labelToScarId = new Map();
        this._scarIdToVertices = new Map();
        this._adjacencySet = new Set();

        // Selection state
        this._selectedYoungerScarId = null;
        this._highlights = [];

        // Colormap state
        this._colormapEnabled = true;
        this._colormapName = 'blueRed';

        // Label overlay state
        this._scarSurfaceData = new Map(); // scarId → { position: Vector3, normal: Vector3 }
        this._labelElements = new Map();
        this._lineElements = new Map();
        this._labelRAF = null;
        this._overlayEl = document.getElementById('scarLabelsOverlay');
        this._svgEl = document.getElementById('scarLabelsSvg');

        // Cache DOM elements
        this._statusEl = document.getElementById('scarOrderStatus');
        this._statusTextEl = document.getElementById('scarOrderStatusText');
        this._statusIconEl = document.getElementById('scarOrderStatusIcon');
        this._scarListEl = document.getElementById('scarList');
        this._scarCountEl = document.getElementById('scarCount');
        this._compListEl = document.getElementById('comparisonList');
        this._compCountEl = document.getElementById('comparisonCount');
        this._initBtn = document.getElementById('scarOrderInit');
        this._preseedBtn = document.getElementById('scarOrderPreseed');
        this._clearPreseedBtn = document.getElementById('scarOrderClearPreseed');
        this._saveBtn = document.getElementById('scarOrderSave');
        this._colormapCheckbox = document.getElementById('scarOrderColormap');
        this._colormapSelect = document.getElementById('scarOrderColormapSelect');
        this._colormapLegendEl = document.getElementById('scarColormapLegend');
        this._colormapLegendBarEl = document.getElementById('colormapLegendBar');
        this._modeToggleEl = document.getElementById('scarOrderToggleIndicator');

        this._setupEventListeners();
        this._setupEventBusSubscriptions();
        this._setupCanvasListeners();
    }

    // ========================================
    // Setup
    // ========================================

    _setupEventListeners() {
        this._initBtn?.addEventListener('click', () => this._initializeGraph());
        this._preseedBtn?.addEventListener('click', () => this._preseed());
        this._clearPreseedBtn?.addEventListener('click', () => this._clearPreseed());
        this._saveBtn?.addEventListener('click', () => this._save());

        this._colormapCheckbox?.addEventListener('change', () => {
            this._colormapEnabled = this._colormapCheckbox.checked;
            if (this._colormapEnabled) {
                this._applyOrderColormap();
            } else {
                this._restoreOriginalColors();
            }
            this._updateUI();
        });
        this._colormapSelect?.addEventListener('change', () => {
            this._colormapName = this._colormapSelect.value;
            this._updateColormapLegend();
            if (this._colormapEnabled) {
                this._applyOrderColormap();
            }
            this._updateUI();
        });

        // Mode toggle click handler
        this._modeToggleEl?.addEventListener('click', () => {
            if (this.mode.currentMode === MODES.SCAR_ORDER) {
                this.mode.setMode(MODES.VIEW);
            } else {
                this.mode.setMode(MODES.SCAR_ORDER, true);
            }
        });
    }

    _setupEventBusSubscriptions() {
        eventBus.on(Events.MESH_LOADED, () => this._clearState(), 'scarOrderPanel');
        eventBus.on(Events.STATE_CHANGED, () => this._clearState(), 'scarOrderPanel');
        eventBus.on(Events.MODE_CHANGED, (data) => {
            if (data.previousMode === MODES.SCAR_ORDER && data.mode !== MODES.SCAR_ORDER) {
                this._cancelSelection();
            }
            this._updateModeToggle();
        }, 'scarOrderPanel');
    }

    _setupCanvasListeners() {
        const canvas = this.meshView.scene?.canvas;
        if (!canvas) return;

        canvas.addEventListener('pointerdown', (event) => {
            if (this.mode != MODES.SCAR_ORDER) return;
            if (event.button === 0) this._handleMeshClick(event);
            if (event.button === 2) this._cancelSelection();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.mode == MODES.SCAR_ORDER) {
                this._cancelSelection();
            }
        });
    }

    dispose() {
        this._stopLabelLoop();
        this._removeLabelElements();
        eventBus.offNamespace('scarOrderPanel');
    }

    // ========================================
    // Mode toggle indicator
    // ========================================

    _updateModeToggle() {
        if (!this._modeToggleEl) return;

        if (!this._panelActive || !this.scarGraph) {
            this._modeToggleEl.classList.remove('visible');
            return;
        }

        if (this.mode.currentMode === MODES.SCAR_ORDER) {
            // In order mode → show "→ View"
            this._modeToggleEl.innerHTML = '<i class="fas fa-arrow-right switch-arrow"></i><i class="fas fa-eye"></i> View';
            this._modeToggleEl.title = 'Switch to View mode';
            this._modeToggleEl.classList.add('view-mode');
            this._modeToggleEl.classList.add('visible');
        } else if (this.mode.currentMode === MODES.VIEW) {
            // In view mode → show "→ Order"
            this._modeToggleEl.innerHTML = '<i class="fas fa-arrow-right switch-arrow"></i><i class="fas fa-sort-numeric-down"></i> Order';
            this._modeToggleEl.title = 'Switch to Order mode';
            this._modeToggleEl.classList.remove('view-mode');
            this._modeToggleEl.classList.add('visible');
        } else {
            this._modeToggleEl.classList.remove('visible');
        }
    }

    // ========================================
    // Panel lifecycle
    // ========================================

    onShow() {
        this._panelActive = true;
        if (this.scarGraph) {
            this.mode.setMode(MODES.SCAR_ORDER, true);
            if (this._colormapEnabled) this._applyOrderColormap();
            this._createLabelElements();
            this._startLabelLoop();
        }
        this._updateModeToggle();
    }

    onHide() {
        this._panelActive = false;
        this._cancelSelection();
        this._stopLabelLoop();
        this._removeLabelElements();
        this._restoreOriginalColors();
        this._updateModeToggle();
        if (this.mode.currentMode === MODES.SCAR_ORDER) {
            this.mode.setMode(MODES.VIEW, true);
        }
    }

    // ========================================
    // Graph initialization
    // ========================================

    _initializeGraph() {
        if (this.meshView.segments.length < 2) {
            this._setStatus('Need at least 2 segments. Draw edges first.', 'warning');
            return;
        }

        this.scarGraph = buildScarGraph(
            this.meshView.faceLabels,
            this.meshView.currentEdgeIndices,
            this.meshView.adjacencyGraph,
            this.meshView.vertexCount,
            this.meshView.positions,
            this.meshView.indices
        );

        this._labelToScarId.clear();
        this._scarIdToVertices.clear();
        this._adjacencySet.clear();

        for (const scar of this.scarGraph.scars) {
            const label = this.scarGraph.workingLabels[scar.representativeVertex];
            this._labelToScarId.set(label, scar.scarId);
        }

        const wl = this.scarGraph.workingLabels;
        for (let v = 0; v < wl.length; v++) {
            if (wl[v] === 0) continue;
            const scarId = this._labelToScarId.get(wl[v]);
            if (scarId === undefined) continue;
            if (!this._scarIdToVertices.has(scarId)) this._scarIdToVertices.set(scarId, []);
            this._scarIdToVertices.get(scarId).push(v);
        }

        for (const edge of this.scarGraph.edges) {
            const a = Math.min(edge.scarA, edge.scarB);
            const b = Math.max(edge.scarA, edge.scarB);
            this._adjacencySet.add(`${a}_${b}`);
        }

        this.ordering = new ScarOrdering(this.scarGraph);

        const existing = this.meshView.workingAnnotation?.getMetadata('scarOrder');
        if (existing && existing.version === 1) {
            this.ordering = ScarOrdering.fromMetadata(existing, this.scarGraph);
        }

        this._preseedBtn.disabled = false;
        this._clearPreseedBtn.disabled = false;
        this._saveBtn.disabled = false;
        this.mode.setMode(MODES.SCAR_ORDER, true);

        this._computeSurfacePoints();
        this._recolorAllScars(); // show eroded edges with segment colors
        this._setStatus('Click the YOUNGER scar first', 'ready');
        this._updateColormapLegend();
        this._updateUI();
        this._createLabelElements();
        this._startLabelLoop();
        this._updateModeToggle();
    }

    // ========================================
    // Mesh click interaction
    // ========================================

    _handleMeshClick(event) {
        if (!this.scarGraph || !this.ordering) return;

        const vertexIndex = this.meshView.getClosestVertexIndex(event);
        if (vertexIndex === -1 || vertexIndex === undefined) return;

        const label = this.scarGraph.workingLabels[vertexIndex];
        if (label === 0) return;

        const scarId = this._labelToScarId.get(label);
        if (scarId === undefined) return;

        if (this._selectedYoungerScarId === null) {
            this._selectedYoungerScarId = scarId;
            this._highlightScar(scarId, YOUNGER_COLOR);
            this._setStatus('Selected as younger. Now click the OLDER scar.', 'selecting');
        } else if (scarId === this._selectedYoungerScarId) {
            this._cancelSelection();
        } else {
            const younger = this._selectedYoungerScarId;
            const older = scarId;

            if (!this._areAdjacent(younger, older)) {
                this._setStatus('Scars not adjacent. Selection cleared.', 'warning');
                this._cancelSelection();
                setTimeout(() => {
                    if (this.scarGraph) this._setStatus('Click the YOUNGER scar first', 'ready');
                }, 2000);
                return;
            }

            const result = this.ordering.addComparison(younger, older, 'expert');

            if (!result.success) {
                this._highlightScar(older, OLDER_COLOR);
                if (result.error === 'cycle') {
                    this._setStatus('Contradiction! Conflicts with existing expert comparisons.', 'error');
                    alert(`Cannot add this comparison: ${result.message}`);
                } else {
                    this._setStatus(result.message, 'error');
                }
                setTimeout(() => this._cancelSelection(), 1500);
                setTimeout(() => {
                    if (this.scarGraph) this._setStatus('Click the YOUNGER scar first', 'ready');
                }, 2000);
                return;
            }

            this._highlightScar(older, OLDER_COLOR);
            this._setStatus('Comparison recorded.', 'success');
            this._updateUI();

            setTimeout(() => {
                this._restoreAllHighlights();
                this._selectedYoungerScarId = null;
                if (this.scarGraph) this._setStatus('Click the YOUNGER scar first', 'ready');
            }, 800);
        }
    }

    _areAdjacent(a, b) {
        return this._adjacencySet.has(`${Math.min(a, b)}_${Math.max(a, b)}`);
    }

    // ========================================
    // Highlight management
    // ========================================

    _highlightScar(scarId, color) {
        const vertices = this._scarIdToVertices.get(scarId);
        if (!vertices || vertices.length === 0) return;

        const meshColors = this.meshView.meshColors;
        if (!meshColors) return;

        const savedColors = new Float32Array(vertices.length * 3);
        for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            savedColors[i * 3] = meshColors[v * 3];
            savedColors[i * 3 + 1] = meshColors[v * 3 + 1];
            savedColors[i * 3 + 2] = meshColors[v * 3 + 2];
        }

        this._highlights.push({ scarId, vertices, savedColors });
        this.meshView.colorVertices(vertices, color);
    }

    _restoreAllHighlights() {
        const meshColors = this.meshView.meshColors;
        if (!meshColors) return;

        for (const { vertices, savedColors } of this._highlights) {
            for (let i = 0; i < vertices.length; i++) {
                const v = vertices[i];
                meshColors[v * 3] = savedColors[i * 3];
                meshColors[v * 3 + 1] = savedColors[i * 3 + 1];
                meshColors[v * 3 + 2] = savedColors[i * 3 + 2];
            }
        }

        if (this.meshView.threeMesh?.geometry?.attributes?.color) {
            this.meshView.threeMesh.geometry.attributes.color.needsUpdate = true;
        }
        this._highlights = [];
    }

    _cancelSelection() {
        this._restoreAllHighlights();
        this._selectedYoungerScarId = null;
        if (this.scarGraph) {
            this._setStatus('Click the YOUNGER scar first', 'ready');
        }
    }

    // ========================================
    // Status display
    // ========================================

    _setStatus(text, type = '') {
        if (!this._statusEl || !this._statusTextEl) return;
        this._statusTextEl.textContent = text;
        this._statusEl.className = 'scar-order-status';
        if (type) this._statusEl.classList.add(`status-${type}`);

        const iconMap = {
            ready: 'fa-hand-pointer', selecting: 'fa-crosshairs',
            success: 'fa-check-circle', warning: 'fa-exclamation-triangle',
            error: 'fa-times-circle',
        };
        if (this._statusIconEl) {
            this._statusIconEl.className = `fas ${iconMap[type] || 'fa-info-circle'}`;
        }
    }

    // ========================================
    // Actions
    // ========================================

    _preseed() {
        if (!this.ordering || !this.scarGraph) return;
        this.ordering.preseedFromGraph(this.scarGraph);
        this._updateUI();
        this._setStatus('Preseed comparisons added (size heuristic)', 'success');
    }

    _clearPreseed() {
        if (!this.ordering) return;
        this.ordering.clearPreseedComparisons();
        this._updateUI();
        this._setStatus('Preseed comparisons removed', 'ready');
    }

    _save() {
        if (!this.ordering) return;
        const annotation = this.meshView.workingAnnotation;
        if (!annotation) return;
        annotation.setMetadata('scarOrder', this.ordering.toMetadata());
        this._setStatus('Ordering saved to annotation metadata', 'success');
    }

    // ========================================
    // State management
    // ========================================

    _clearState() {
        this._cancelSelection();
        this._stopLabelLoop();
        this._removeLabelElements();
        this._restoreOriginalColors();
        this.scarGraph = null;
        this.ordering = null;
        this._labelToScarId.clear();
        this._scarIdToVertices.clear();
        this._adjacencySet.clear();
        this._scarSurfaceData.clear();

        if (this._preseedBtn) this._preseedBtn.disabled = true;
        if (this._clearPreseedBtn) this._clearPreseedBtn.disabled = true;
        if (this._saveBtn) this._saveBtn.disabled = true;
        if (this._colormapLegendEl) this._colormapLegendEl.style.display = 'none';

        this._setStatus('Click Initialize to begin', '');
        this._renderEmpty();
        this._updateModeToggle();
    }

    _renderEmpty() {
        if (this._scarListEl) this._scarListEl.innerHTML = '<p class="empty-state">Click Initialize to build scar graph</p>';
        if (this._scarCountEl) this._scarCountEl.textContent = '0';
        if (this._compListEl) this._compListEl.innerHTML = '<p class="empty-state">No adjacency edges yet</p>';
        if (this._compCountEl) this._compCountEl.textContent = '0/0';
    }

    // ========================================
    // UI rendering
    // ========================================

    /**
     * Short display label for a scar — uses vertex count instead of arbitrary index.
     */
    _scarLabel(scarId) {
        if (!this.scarGraph) return '?';
        const scar = this.scarGraph.scars[scarId];
        if (!scar) return '?';
        return `${scar.vertexCount}v`;
    }

    _getScarDisplayColor(scarId) {
        if (this._colormapEnabled) {
            const hex = this._getColormapHex(scarId);
            if (hex !== '#888') return hex;
        }
        if (!this.scarGraph) return '#888';
        const scar = this.scarGraph.scars[scarId];
        if (!scar) return '#888';
        const label = this.scarGraph.workingLabels[scar.representativeVertex];
        const color = this.meshView.faceColors.get(label);
        if (!color) return '#888';
        return `#${color.getHexString()}`;
    }

    _updateUI() {
        this._renderScarList();
        this._renderComparisonList();
        if (this._colormapEnabled) this._applyOrderColormap();
        this._createLabelElements();
    }

    _getOrderedScars() {
        if (!this.ordering) return null;
        const order = this.ordering.getTopologicalOrder();
        if (order.length === 0) return null;
        const reversed = [...order].reverse(); // oldest first
        return reversed.map((scarId, idx) => ({
            scarId, rank: idx + 1, total: reversed.length,
        }));
    }

    _renderScarList() {
        if (!this._scarListEl || !this.scarGraph) return;

        const scars = this.scarGraph.scars;
        this._scarCountEl.textContent = String(scars.length);

        if (scars.length === 0) {
            this._scarListEl.innerHTML = '<p class="empty-state">No scars found</p>';
            return;
        }

        const orderedScars = this._getOrderedScars();
        const rankMap = new Map();
        if (orderedScars) {
            for (const { scarId, rank } of orderedScars) {
                rankMap.set(scarId, rank);
            }
        }

        const sortedScars = [...scars].sort((a, b) => {
            const ra = rankMap.get(a.scarId);
            const rb = rankMap.get(b.scarId);
            if (ra !== undefined && rb !== undefined) return ra - rb;
            if (ra !== undefined) return -1;
            if (rb !== undefined) return 1;
            return a.scarId - b.scarId;
        });

        let html = '<div class="section-legend">Ordered oldest (1) → youngest</div>';
        html += sortedScars.map(scar => {
            const color = this._getScarDisplayColor(scar.scarId);
            const selected = this._selectedYoungerScarId === scar.scarId ? ' selected' : '';
            const rank = rankMap.get(scar.scarId);
            const rankStr = rank !== undefined ? `${rank}.` : '–';
            return `<div class="scar-list-item${selected}" data-scar-id="${scar.scarId}">
                <span class="scar-rank">${rankStr}</span>
                <span class="scar-color-dot" style="background: ${color}"></span>
                <span class="scar-name">${scar.vertexCount} vertices</span>
            </div>`;
        }).join('');

        this._scarListEl.innerHTML = html;

        this._scarListEl.querySelectorAll('.scar-list-item').forEach(el => {
            el.addEventListener('click', () => {
                const scarId = parseInt(el.dataset.scarId, 10);
                this._restoreAllHighlights();
                this._highlightScar(scarId, YOUNGER_COLOR);
                this._selectedYoungerScarId = scarId;
                this._setStatus('Selected as younger. Now click the OLDER scar.', 'selecting');
                this._renderScarList();
            });
        });
    }

    _renderComparisonList() {
        if (!this._compListEl || !this.scarGraph || !this.ordering) return;

        const edges = this.scarGraph.edges;
        const comparisons = this.ordering.getComparisons();

        const compLookup = new Map();
        for (const comp of comparisons) {
            const a = Math.min(comp.younger, comp.older);
            const b = Math.max(comp.younger, comp.older);
            compLookup.set(`${a}_${b}`, comp);
        }

        this._compCountEl.textContent = `${compLookup.size}/${edges.length}`;

        if (edges.length === 0) {
            this._compListEl.innerHTML = '<p class="empty-state">No adjacency edges</p>';
            return;
        }

        let html = '<div class="section-legend"><i class="fas fa-arrow-right" style="font-size:9px"></i> younger → older</div>';
        html += edges.map(edge => {
            const a = Math.min(edge.scarA, edge.scarB);
            const b = Math.max(edge.scarA, edge.scarB);
            const comp = compLookup.get(`${a}_${b}`);

            if (comp) {
                const youngerColor = this._getScarDisplayColor(comp.younger);
                const olderColor = this._getScarDisplayColor(comp.older);
                const sourceClass = comp.source === 'preseed' ? ' source-preseed' : '';
                return `<div class="comparison-item done" data-scar-a="${edge.scarA}" data-scar-b="${edge.scarB}">
                    <span class="comparison-icon"><i class="fas fa-check"></i></span>
                    <span class="scar-color-dot" style="background: ${youngerColor}"></span>
                    <span>${this._scarLabel(comp.younger)}</span>
                    <span class="comparison-arrow"><i class="fas fa-arrow-right"></i></span>
                    <span class="scar-color-dot" style="background: ${olderColor}"></span>
                    <span>${this._scarLabel(comp.older)}</span>
                    <span class="comparison-source${sourceClass}">${comp.source}</span>
                    <span class="comparison-delete" data-younger="${comp.younger}" data-older="${comp.older}" title="Remove"><i class="fas fa-times"></i></span>
                </div>`;
            } else {
                return `<div class="comparison-item pending" data-scar-a="${edge.scarA}" data-scar-b="${edge.scarB}">
                    <span class="comparison-icon"><i class="fas fa-question"></i></span>
                    <span class="scar-color-dot" style="background: ${this._getScarDisplayColor(edge.scarA)}"></span>
                    <span>${this._scarLabel(edge.scarA)}</span>
                    <span class="comparison-arrow"><i class="fas fa-minus"></i></span>
                    <span class="scar-color-dot" style="background: ${this._getScarDisplayColor(edge.scarB)}"></span>
                    <span>${this._scarLabel(edge.scarB)}</span>
                </div>`;
            }
        }).join('');

        this._compListEl.innerHTML = html;

        this._compListEl.querySelectorAll('.comparison-delete').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.ordering.removeComparison(
                    parseInt(el.dataset.younger, 10),
                    parseInt(el.dataset.older, 10)
                );
                this._updateUI();
            });
        });

        this._compListEl.querySelectorAll('.comparison-item.pending').forEach(el => {
            el.addEventListener('click', () => {
                this._restoreAllHighlights();
                this._highlightScar(parseInt(el.dataset.scarA, 10), YOUNGER_COLOR);
                this._highlightScar(parseInt(el.dataset.scarB, 10), OLDER_COLOR);
            });
        });
    }

    // ========================================
    // Colormap
    // ========================================

    _getOrderMap() {
        if (!this.ordering) return null;
        const order = this.ordering.getTopologicalOrder();
        if (order.length === 0) return null;
        const reversed = [...order].reverse();
        const map = new Map();
        for (let i = 0; i < reversed.length; i++) {
            map.set(reversed[i], reversed.length > 1 ? i / (reversed.length - 1) : 0.5);
        }
        return map;
    }

    /**
     * Recolor all scar vertices using their segment colors from faceColors.
     * This makes eroded edge vertices adopt the segment color, visually
     * removing the drawn edges on the mesh.
     */
    _recolorAllScars() {
        if (!this.scarGraph) return;
        for (const scar of this.scarGraph.scars) {
            const label = this.scarGraph.workingLabels[scar.representativeVertex];
            const color = this.meshView.faceColors.get(label);
            const vertices = this._scarIdToVertices.get(scar.scarId);
            if (color && vertices) this.meshView.colorVertices(vertices, color);
        }
    }

    _applyOrderColormap() {
        if (!this.scarGraph || !this.ordering) return;
        const orderMap = this._getOrderMap();
        if (!orderMap) return;

        for (const scar of this.scarGraph.scars) {
            const t = orderMap.get(scar.scarId);
            if (t === undefined) continue;
            const [r, g, b] = sampleColormap(this._colormapName, t);
            const vertices = this._scarIdToVertices.get(scar.scarId);
            if (vertices) this.meshView.colorVertices(vertices, new THREE.Color(r, g, b));
        }
    }

    _restoreOriginalColors() {
        if (!this.scarGraph) return;
        for (const scar of this.scarGraph.scars) {
            const label = this.scarGraph.workingLabels[scar.representativeVertex];
            const color = this.meshView.faceColors.get(label);
            const vertices = this._scarIdToVertices.get(scar.scarId);
            if (color && vertices) this.meshView.colorVertices(vertices, color);
        }
    }

    _getColormapHex(scarId) {
        const orderMap = this._getOrderMap();
        if (!orderMap) return '#888';
        const t = orderMap.get(scarId);
        if (t === undefined) return '#888';
        const [r, g, b] = sampleColormap(this._colormapName, t);
        const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    _updateColormapLegend() {
        if (!this._colormapLegendEl || !this._colormapLegendBarEl) return;
        const colors = colormapHexColors(this._colormapName, 20);
        this._colormapLegendBarEl.style.background =
            `linear-gradient(to right, ${colors.join(', ')})`;
        this._colormapLegendEl.style.display = '';
    }

    // ========================================
    // Label overlay
    // ========================================

    _computeSurfacePoints() {
        this._scarSurfaceData.clear();
        if (!this.scarGraph) return;

        const positions = this.meshView.positions;
        if (!positions || positions.length === 0) return;

        for (const scar of this.scarGraph.scars) {
            const vertices = this._scarIdToVertices.get(scar.scarId);
            if (!vertices || vertices.length === 0) continue;

            let cx = 0, cy = 0, cz = 0;
            for (const v of vertices) {
                cx += positions[v * 3];
                cy += positions[v * 3 + 1];
                cz += positions[v * 3 + 2];
            }
            cx /= vertices.length;
            cy /= vertices.length;
            cz /= vertices.length;

            let bestDist = Infinity;
            let bestV = vertices[0];
            for (const v of vertices) {
                const dx = positions[v * 3] - cx;
                const dy = positions[v * 3 + 1] - cy;
                const dz = positions[v * 3 + 2] - cz;
                const d = dx * dx + dy * dy + dz * dz;
                if (d < bestDist) { bestDist = d; bestV = v; }
            }

            const normal = this.meshView.basicMesh.getVertexNormal(bestV);
            const nx = normal?.x || 0, ny = normal?.y || 0, nz = normal?.z || 0;
            const offset = 0.15;

            this._scarSurfaceData.set(scar.scarId, {
                position: new THREE.Vector3(
                    positions[bestV * 3] + nx * offset,
                    positions[bestV * 3 + 1] + ny * offset,
                    positions[bestV * 3 + 2] + nz * offset
                ),
                normal: new THREE.Vector3(nx, ny, nz),
            });
        }
    }

    _createLabelElements() {
        this._removeLabelElements();
        if (!this._overlayEl || !this._svgEl || !this.ordering) return;

        const orderedScars = this._getOrderedScars();
        if (!orderedScars) return;

        for (const { scarId, rank } of orderedScars) {
            if (!this._scarSurfaceData.has(scarId)) continue;

            const bgColor = this._getScarDisplayColor(scarId);

            const el = document.createElement('div');
            el.className = 'scar-label';
            el.innerHTML = `<span class="scar-label-badge" style="background:${bgColor}">${rank}</span>`;
            el.style.display = 'none';
            this._overlayEl.appendChild(el);
            this._labelElements.set(scarId, el);

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('stroke', bgColor);
            line.style.display = 'none';
            this._svgEl.appendChild(line);
            this._lineElements.set(scarId, line);
        }
    }

    _removeLabelElements() {
        for (const el of this._labelElements.values()) el.remove();
        this._labelElements.clear();
        for (const el of this._lineElements.values()) el.remove();
        this._lineElements.clear();
    }

    _updateLabelPositions() {
        if (!this._overlayEl || this._labelElements.size === 0) return;

        const camera = this.meshView.scene?.camera;
        const canvas = this.meshView.scene?.canvas;
        const mesh = this.meshView.threeMesh;
        if (!camera || !canvas || !mesh) return;

        const rect = canvas.getBoundingClientRect();
        const canvasCx = rect.width / 2;
        const canvasCy = rect.height / 2;
        const tempVec = new THREE.Vector3();
        const tempNormal = new THREE.Vector3();
        const tempToCamera = new THREE.Vector3();

        // Phase 1: compute all anchor + label positions, check visibility
        const labelData = []; // { scarId, anchorX, anchorY, labelX, labelY, visible }

        for (const [scarId] of this._labelElements) {
            const data = this._scarSurfaceData.get(scarId);
            if (!data) {
                labelData.push({ scarId, visible: false });
                continue;
            }

            // Apply mesh world transform
            tempVec.copy(data.position).applyMatrix4(mesh.matrixWorld);

            // Back-face check: is the surface facing the camera?
            tempNormal.copy(data.normal).transformDirection(mesh.matrixWorld);
            tempToCamera.copy(camera.position).sub(tempVec).normalize();
            if (tempNormal.dot(tempToCamera) < 0.05) {
                labelData.push({ scarId, visible: false });
                continue;
            }

            const worldPos = tempVec.clone();
            tempVec.project(camera);

            if (tempVec.z > 1 || tempVec.z < 0 ||
                tempVec.x < -1.2 || tempVec.x > 1.2 ||
                tempVec.y < -1.2 || tempVec.y > 1.2) {
                labelData.push({ scarId, visible: false });
                continue;
            }

            const anchorX = (tempVec.x + 1) * rect.width / 2;
            const anchorY = (-tempVec.y + 1) * rect.height / 2;

            // Offset label outward from canvas center
            let dx = anchorX - canvasCx;
            let dy = anchorY - canvasCy;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 1) { dx /= len; dy /= len; }
            else { dx = 1; dy = 0; }

            labelData.push({
                scarId,
                visible: true,
                anchorX,
                anchorY,
                labelX: anchorX + dx * LABEL_OFFSET_PX,
                labelY: anchorY + dy * LABEL_OFFSET_PX,
            });
        }

        // Phase 2: repulsion to prevent overlap
        const visible = labelData.filter(d => d.visible);
        for (let iter = 0; iter < LABEL_REPULSION_ITERS; iter++) {
            for (let i = 0; i < visible.length; i++) {
                for (let j = i + 1; j < visible.length; j++) {
                    const a = visible[i], b = visible[j];
                    const dx = b.labelX - a.labelX;
                    const dy = b.labelY - a.labelY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < LABEL_MIN_DIST && dist > 0.1) {
                        const push = (LABEL_MIN_DIST - dist) / 2;
                        const nx = dx / dist, ny = dy / dist;
                        a.labelX -= nx * push;
                        a.labelY -= ny * push;
                        b.labelX += nx * push;
                        b.labelY += ny * push;
                    }
                }
            }
        }

        // Phase 3: apply to DOM
        for (const d of labelData) {
            const el = this._labelElements.get(d.scarId);
            const line = this._lineElements.get(d.scarId);

            if (!d.visible) {
                if (el) el.style.display = 'none';
                if (line) line.style.display = 'none';
                continue;
            }

            if (el) {
                el.style.display = '';
                el.style.left = `${d.labelX}px`;
                el.style.top = `${d.labelY}px`;
            }
            if (line) {
                line.style.display = '';
                line.setAttribute('x1', String(d.anchorX));
                line.setAttribute('y1', String(d.anchorY));
                line.setAttribute('x2', String(d.labelX));
                line.setAttribute('y2', String(d.labelY));
            }
        }
    }

    _startLabelLoop() {
        if (this._labelRAF) return;
        const update = () => {
            this._updateLabelPositions();
            this._labelRAF = requestAnimationFrame(update);
        };
        this._labelRAF = requestAnimationFrame(update);
    }

    _stopLabelLoop() {
        if (this._labelRAF) {
            cancelAnimationFrame(this._labelRAF);
            this._labelRAF = null;
        }
    }
}
