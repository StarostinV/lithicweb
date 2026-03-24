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

        // Rearrange state
        this._rearrangeMode = false;
        this._rearrangeOrder = null; // Array<scarId> during rearrange
        this._showOnSelect = false;

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
        this._preseedBtn = document.getElementById('scarOrderPreseed');
        this._clearPreseedBtn = document.getElementById('scarOrderClearPreseed');

        this._colormapCheckbox = document.getElementById('scarOrderColormap');
        this._colormapSelect = document.getElementById('scarOrderColormapSelect');
        this._colormapLegendEl = document.getElementById('scarColormapLegend');
        this._colormapLegendBarEl = document.getElementById('colormapLegendBar');
        this._modeToggleEl = document.getElementById('scarOrderToggleIndicator');
        this._rearrangeBtn = document.getElementById('scarOrderRearrange');
        this._applyBtn = document.getElementById('scarOrderApply');
        this._cancelRearrangeBtn = document.getElementById('scarOrderCancelRearrange');
        this._showOnSelectCheckbox = document.getElementById('scarShowOnSelect');
        this._startCompareBtn = document.getElementById('scarOrderStartCompare');

        this._setupEventListeners();
        this._setupEventBusSubscriptions();
        this._setupCanvasListeners();
    }

    // ========================================
    // Setup
    // ========================================

    _setupEventListeners() {
        this._preseedBtn?.addEventListener('click', () => this._preseed());
        this._clearPreseedBtn?.addEventListener('click', () => this._clearPreseed());


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

        this._rearrangeBtn?.addEventListener('click', () => this._enterRearrangeMode());
        this._applyBtn?.addEventListener('click', () => this._applyRearrange());
        this._cancelRearrangeBtn?.addEventListener('click', () => this._cancelRearrange());
        this._startCompareBtn?.addEventListener('click', () => {
            if (this.mode.currentMode === MODES.SCAR_ORDER) {
                this.mode.setMode(MODES.VIEW, true);
            } else {
                this.mode.setMode(MODES.SCAR_ORDER, true);
                this._setStatus('Click the YOUNGER scar first', 'ready');
            }
        });
        this._showOnSelectCheckbox?.addEventListener('change', () => {
            this._showOnSelect = this._showOnSelectCheckbox.checked;
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
        eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, () => this._clearState(), 'scarOrderPanel');
        eventBus.on(Events.MODE_CHANGED, (data) => {
            if (data.previousMode === MODES.SCAR_ORDER && data.mode !== MODES.SCAR_ORDER) {
                this._cancelSelection();
            }
            this._updateModeToggle();
            this._updateCompareButton();
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

        // Only show the toggle when in SCAR_ORDER mode (to offer "→ View").
        // In VIEW mode, the main mode indicator click already toggles back,
        // and the transform indicator ("Rotate") handles the secondary slot.
        if (this._panelActive && this.scarGraph && this.mode.currentMode === MODES.SCAR_ORDER) {
            this._modeToggleEl.innerHTML = '<i class="fas fa-arrow-right switch-arrow"></i><i class="fas fa-eye"></i> View';
            this._modeToggleEl.title = 'Switch to View mode';
            this._modeToggleEl.classList.add('visible');
        } else {
            this._modeToggleEl.classList.remove('visible');
        }
    }

    _updateCompareButton() {
        if (!this._startCompareBtn) return;
        if (this.mode.currentMode === MODES.SCAR_ORDER) {
            this._startCompareBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Pairwise Compare';
        } else {
            this._startCompareBtn.innerHTML = '<i class="fas fa-hand-pointer"></i> Start Pairwise Compare';
        }
    }

    // ========================================
    // Panel lifecycle
    // ========================================

    onShow() {
        this._panelActive = true;
        if (this.scarGraph) {
            // Already initialized — restore visuals
            if (this._colormapEnabled) this._applyOrderColormap();
            this._createLabelElements();
            this._startLabelLoop();
        } else if (this.meshView.segments.length >= 2) {
            // Auto-initialize if we have segments (loads saved ordering from metadata if valid)
            this._initializeGraph();
        }
        this._updateModeToggle();
    }

    onHide() {
        this._panelActive = false;
        this._cancelSelection();
        this._stopLabelLoop();
        this._removeLabelElements();
        this._restoreNormalView();
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

        // Load saved ordering only if scars match current segmentation
        const existing = this.meshView.workingAnnotation?.getMetadata('scarOrder');
        if (existing && existing.version === 1 && existing.scars) {
            const savedVerts = new Set(existing.scars.map(s => s.representativeVertex));
            const currentVerts = new Set(this.scarGraph.scars.map(s => s.representativeVertex));
            const match = savedVerts.size === currentVerts.size &&
                          [...savedVerts].every(v => currentVerts.has(v));
            if (match) {
                this.ordering = ScarOrdering.fromMetadata(existing, this.scarGraph);
            }
        }

        this._preseedBtn.disabled = false;
        this._clearPreseedBtn.disabled = false;

        if (this._rearrangeBtn) this._rearrangeBtn.disabled = false;
        if (this._startCompareBtn) this._startCompareBtn.disabled = false;

        this._computeSurfacePoints();
        this._recolorAllScars(); // show eroded edges with segment colors
        this._setStatus('Graph built. Use Pairwise Compare or Rearrange.', 'success');
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
        if (!this.scarGraph || !this.ordering || this._rearrangeMode) return;

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
            this._persistMetadata();

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
        this._persistMetadata();
        this._setStatus('Preseed comparisons added (size heuristic)', 'success');
    }

    // ========================================
    // Rearrange mode
    // ========================================

    _enterRearrangeMode() {
        if (!this.scarGraph || !this.ordering) return;
        this._rearrangeMode = true;

        // Build current order: use topological order if available, otherwise by scarId
        const orderedScars = this._getOrderedScars();
        if (orderedScars) {
            this._rearrangeOrder = orderedScars.map(o => o.scarId);
        } else {
            this._rearrangeOrder = this.scarGraph.scars.map(s => s.scarId);
        }

        // Switch to VIEW so the user can rotate the mesh
        this.mode.setMode(MODES.VIEW);

        // Toggle button visibility
        if (this._rearrangeBtn) this._rearrangeBtn.style.display = 'none';
        if (this._applyBtn) this._applyBtn.style.display = '';
        if (this._cancelRearrangeBtn) this._cancelRearrangeBtn.style.display = '';

        this._setStatus('Drag scars to reorder — oldest at top, youngest at bottom', 'selecting');
        this._renderScarList();
        this._applyRearrangePreview();
    }

    _applyRearrange() {
        if (!this._rearrangeMode || !this._rearrangeOrder || !this.ordering) return;

        this.ordering.setGlobalOrder(this._rearrangeOrder);
        this._rearrangeMode = false;
        this._rearrangeOrder = null;

        // Restore button visibility
        if (this._rearrangeBtn) this._rearrangeBtn.style.display = '';
        if (this._applyBtn) this._applyBtn.style.display = 'none';
        if (this._cancelRearrangeBtn) this._cancelRearrangeBtn.style.display = 'none';

        this._setStatus('Global order applied.', 'success');
        this._updateUI();
        this._persistMetadata();
    }

    /**
     * Preview the rearrange order on the 3D canvas: recolor scars and
     * recreate labels using _rearrangeOrder as the ordering basis.
     */
    _applyRearrangePreview() {
        if (!this._rearrangeOrder || !this.scarGraph) return;
        const order = this._rearrangeOrder; // oldest first

        // Recolor mesh using rearrange order
        if (this._colormapEnabled) {
            for (let i = 0; i < order.length; i++) {
                const t = order.length > 1 ? i / (order.length - 1) : 0.5;
                const [r, g, b] = sampleColormap(this._colormapName, t);
                const vertices = this._scarIdToVertices.get(order[i]);
                if (vertices) this.meshView.colorVertices(vertices, new THREE.Color(r, g, b));
            }
        }

        // Recreate labels using rearrange order
        this._removeLabelElements();
        if (this._overlayEl && this._svgEl) {
            for (let i = 0; i < order.length; i++) {
                const scarId = order[i];
                if (!this._scarSurfaceData.has(scarId)) continue;
                const rank = i + 1;
                const t = order.length > 1 ? i / (order.length - 1) : 0.5;
                const [r, g, b] = sampleColormap(this._colormapName, t);
                const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
                const bgColor = this._colormapEnabled ? `#${toHex(r)}${toHex(g)}${toHex(b)}` : '#666';

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
    }

    _cancelRearrange() {
        if (!this._rearrangeMode) return;
        this._rearrangeMode = false;
        this._rearrangeOrder = null;

        if (this._rearrangeBtn) this._rearrangeBtn.style.display = '';
        if (this._applyBtn) this._applyBtn.style.display = 'none';
        if (this._cancelRearrangeBtn) this._cancelRearrangeBtn.style.display = 'none';

        this._setStatus('Click the YOUNGER scar first', 'ready');
        this._updateUI(); // restores colors and labels from actual ordering
    }

    _clearPreseed() {
        if (!this.ordering) return;
        this.ordering.clearPreseedComparisons();
        this._updateUI();
        this._persistMetadata();
        this._setStatus('Preseed comparisons removed', 'ready');
    }

    _persistMetadata() {
        if (!this.ordering) return;
        this.meshView.setCurrentStateMetadata('scarOrder', this.ordering.toMetadata());
    }

    // ========================================
    // State management
    // ========================================

    _clearState() {
        this._cancelSelection();
        this._stopLabelLoop();
        this._removeLabelElements();
        // Don't call _restoreOriginalColors here — this is triggered by
        // MESH_LOADED / ANNOTATION_ACTIVE_CHANGED, where MeshView has already
        // applied correct colors. Painting old scar vertices would corrupt the display.
        this.scarGraph = null;
        this.ordering = null;
        this._labelToScarId.clear();
        this._scarIdToVertices.clear();
        this._adjacencySet.clear();
        this._scarSurfaceData.clear();

        if (this._preseedBtn) this._preseedBtn.disabled = true;
        if (this._clearPreseedBtn) this._clearPreseedBtn.disabled = true;

        if (this._rearrangeBtn) this._rearrangeBtn.disabled = true;
        if (this._startCompareBtn) this._startCompareBtn.disabled = true;
        this._cancelRearrange();
        if (this._colormapLegendEl) this._colormapLegendEl.style.display = 'none';

        this._setStatus('Initialize first', '');
        this._renderEmpty();
        this._updateModeToggle();
    }

    _renderEmpty() {
        if (this._scarListEl) this._scarListEl.innerHTML = '<p class="empty-state">Draw edges to create segments</p>';
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
            // In rearrange mode, derive color from rearrange order
            if (this._rearrangeMode && this._rearrangeOrder) {
                const idx = this._rearrangeOrder.indexOf(scarId);
                if (idx !== -1) {
                    const t = this._rearrangeOrder.length > 1 ? idx / (this._rearrangeOrder.length - 1) : 0.5;
                    const [r, g, b] = sampleColormap(this._colormapName, t);
                    const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
                    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
                }
            }
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
        const oldestFirst = this.ordering.getOldestFirstOrder();
        if (!oldestFirst || oldestFirst.length === 0) return null;
        return oldestFirst.map((scarId, idx) => ({
            scarId, rank: idx + 1, total: oldestFirst.length,
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

        // In rearrange mode, use the rearrange order; otherwise topological order
        let displayOrder;
        if (this._rearrangeMode && this._rearrangeOrder) {
            displayOrder = this._rearrangeOrder.map((scarId, idx) => ({ scarId, rank: idx + 1 }));
        } else {
            const orderedScars = this._getOrderedScars();
            const rankMap = new Map();
            if (orderedScars) {
                for (const { scarId, rank } of orderedScars) {
                    rankMap.set(scarId, rank);
                }
            }
            displayOrder = [...scars].sort((a, b) => {
                const ra = rankMap.get(a.scarId);
                const rb = rankMap.get(b.scarId);
                if (ra !== undefined && rb !== undefined) return ra - rb;
                if (ra !== undefined) return -1;
                if (rb !== undefined) return 1;
                return a.scarId - b.scarId;
            }).map(scar => ({
                scarId: scar.scarId,
                rank: rankMap.get(scar.scarId),
            }));
        }

        const draggable = this._rearrangeMode;
        let html = '<div class="section-legend">Ordered oldest (1) → youngest</div>';
        html += displayOrder.map(({ scarId, rank }) => {
            const scar = this.scarGraph.scars[scarId];
            if (!scar) return '';
            const color = this._getScarDisplayColor(scarId);
            const selected = !draggable && this._selectedYoungerScarId === scarId ? ' selected' : '';
            const rankStr = rank !== undefined ? `${rank}.` : '–';
            const dragHandle = draggable ? '<span class="scar-drag-handle"><i class="fas fa-grip-vertical"></i></span>' : '';
            return `<div class="scar-list-item${selected}" data-scar-id="${scarId}" ${draggable ? 'draggable="true"' : ''}>
                ${dragHandle}
                <span class="scar-rank">${rankStr}</span>
                <span class="scar-color-dot" style="background: ${color}"></span>
                <span class="scar-name">${scar.vertexCount} vertices</span>
            </div>`;
        }).join('');

        this._scarListEl.innerHTML = html;

        // Click-to-highlight + camera focus (works in both modes)
        this._scarListEl.querySelectorAll('.scar-list-item').forEach(el => {
            el.addEventListener('click', () => {
                const scarId = parseInt(el.dataset.scarId, 10);
                this._restoreAllHighlights();
                this._highlightScar(scarId, YOUNGER_COLOR);
                if (this._showOnSelect) {
                    this._focusCameraOnScar(scarId);
                }
            });
        });

        if (draggable) {
            this._setupDragAndDrop();
        } else {
            // In normal mode, clicking also sets the scar as "younger" for comparison
            this._scarListEl.querySelectorAll('.scar-list-item').forEach(el => {
                el.addEventListener('click', () => {
                    const scarId = parseInt(el.dataset.scarId, 10);
                    this._selectedYoungerScarId = scarId;
                    this._setStatus('Selected as younger. Now click the OLDER scar.', 'selecting');
                    this._renderScarList();
                });
            });
        }
    }

    /**
     * Rotate the camera so that the selected scar faces the viewer.
     * Keeps the orbit center and distance unchanged — only repositions
     * the camera along the scar's outward surface normal.
     */
    _focusCameraOnScar(scarId) {
        const data = this._scarSurfaceData.get(scarId);
        const mesh = this.meshView.threeMesh;
        if (!data || !mesh) return;

        const camera = this.meshView.scene.camera;
        const controls = this.meshView.scene.controls;

        // Surface normal in world space (direction the scar faces)
        const worldNormal = data.normal.clone().transformDirection(mesh.matrixWorld).normalize();

        // Keep current orbit center and camera distance
        const target = controls.target.clone();
        const dist = camera.position.distanceTo(target);

        // Place camera along the normal direction from the orbit center
        camera.position.copy(target).addScaledVector(worldNormal, dist);
        controls.update();
    }

    _setupDragAndDrop() {
        let draggedScarId = null;

        this._scarListEl.querySelectorAll('.scar-list-item').forEach(el => {
            el.addEventListener('dragstart', (e) => {
                draggedScarId = parseInt(el.dataset.scarId, 10);
                el.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
                draggedScarId = null;
                // Clear all drag-over indicators
                this._scarListEl.querySelectorAll('.drag-over').forEach(
                    el2 => el2.classList.remove('drag-over')
                );
            });

            el.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                // Show insertion indicator
                this._scarListEl.querySelectorAll('.drag-over').forEach(
                    el2 => el2.classList.remove('drag-over')
                );
                el.classList.add('drag-over');
            });

            el.addEventListener('dragleave', () => {
                el.classList.remove('drag-over');
            });

            el.addEventListener('drop', (e) => {
                e.preventDefault();
                el.classList.remove('drag-over');
                const targetScarId = parseInt(el.dataset.scarId, 10);
                if (draggedScarId === null || draggedScarId === targetScarId) return;

                // Reorder: remove dragged, insert before target
                const order = this._rearrangeOrder;
                const fromIdx = order.indexOf(draggedScarId);
                const toIdx = order.indexOf(targetScarId);
                if (fromIdx === -1 || toIdx === -1) return;

                order.splice(fromIdx, 1);
                const newToIdx = order.indexOf(targetScarId);
                order.splice(newToIdx, 0, draggedScarId);

                this._renderScarList();
                this._applyRearrangePreview();
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
                this._persistMetadata();
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
        const oldestFirst = this.ordering.getOldestFirstOrder();
        if (!oldestFirst || oldestFirst.length === 0) return null;
        const map = new Map();
        for (let i = 0; i < oldestFirst.length; i++) {
            map.set(oldestFirst[i], oldestFirst.length > 1 ? i / (oldestFirst.length - 1) : 0.5);
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

    /**
     * Restore the normal MeshView coloring: segment colors + edge colors.
     * Called when leaving the order panel to bring back the drawn edges.
     */
    _restoreNormalView() {
        if (!this.meshView.showSegments) {
            this.meshView.setShowSegments(false);
        } else {
            // Re-apply segment colors for interior vertices
            this.meshView.segments.forEach((segment, index) => {
                const segmentId = index + 1;
                const color = this.meshView.faceColors.get(segmentId) || this.meshView.objectColor;
                segment.forEach(vertexIndex => {
                    this.meshView.colorVertex(vertexIndex, color);
                });
            });
        }
        // Re-apply edge colors
        for (const index of this.meshView.currentEdgeIndices) {
            this.meshView.colorVertex(index, this.meshView.edgeColor);
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
