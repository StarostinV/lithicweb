/**
 * Fast Verification Panel
 *
 * Streamlined UI for bulk-verifying precomputed model predictions on datasets.
 * Loads mesh + precomputed model output, runs client-side postprocessing,
 * and lets the expert Accept/Reject with minimal friction.
 *
 * @module FastVerificationPanel
 */

import { lithicClient, DEFAULT_INFERENCE_CONFIG, CONFIG_PARAMS } from '../api/lithicClient.js';
import { eventBus, Events } from '../utils/EventBus.js';
import { Annotation } from '../geometry/Annotation.js';
import { runClientPostprocessing } from '../utils/postprocess.js';

export class FastVerificationPanel {
    /**
     * @param {Object} meshView
     * @param {Object} meshLoader
     */
    constructor(meshView, meshLoader) {
        this.meshView = meshView;
        this.meshLoader = meshLoader;

        // State
        this.datasets = [];
        this.currentDatasetId = null;
        this.allMeshes = [];       // full list from server
        this.queue = [];           // filtered view (unverified or all)
        this.cursor = 0;
        this.showVerified = false;
        this.cachedModelOutput = null;
        this.config = { ...DEFAULT_INFERENCE_CONFIG };
        this.isLoading = false;
        this._postprocessDebounceTimer = null;
        this._loadingDatasetMesh = false;

        // UI elements (bound in _buildUI)
        this.panelContent = document.getElementById('fvPanelContent');
        this._buildUI();
        this._bindEvents();
    }

    // ═══════════════════════════════════════════════════════════════
    //  UI Construction
    // ═══════════════════════════════════════════════════════════════

    _buildUI() {
        if (!this.panelContent) return;

        this.panelContent.innerHTML = `
            <!-- Dataset Selection -->
            <div class="panel-section">
                <div class="section-header">
                    <i class="fas fa-database"></i>
                    <span>Dataset</span>
                </div>
                <div class="section-content">
                    <select id="fvDatasetSelect" class="control-select" style="width: 100%;">
                        <option value="">-- select dataset --</option>
                    </select>
                </div>
            </div>

            <!-- Status -->
            <div class="inference-status info" id="fvStatus">
                <i class="fas fa-info-circle"></i>
                <span>Select a dataset to begin.</span>
            </div>

            <!-- Progress & Navigation -->
            <div class="panel-section" id="fvProgressSection" style="display: none;">
                <div class="section-header">
                    <i class="fas fa-list-ol"></i>
                    <span>Progress</span>
                    <span class="section-badge" id="fvCountsLabel"></span>
                </div>
                <div class="section-content">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <span id="fvPositionLabel" style="font-weight: 600; font-size: 14px;"></span>
                        <span id="fvMeshName" style="font-size: 12px; color: var(--gray-500); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%;"></span>
                    </div>
                    <div id="fvVerdictBadge"></div>
                    <div class="btn-row" style="margin-top: 8px;">
                        <button id="fvPrevBtn" class="btn btn-secondary btn-sm">
                            <i class="fas fa-chevron-left"></i> Prev
                        </button>
                        <button id="fvNextBtn" class="btn btn-secondary btn-sm" style="margin-left: auto;">
                            Next <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                    <button id="fvJumpUnlabeledBtn" class="btn btn-secondary btn-sm" style="width: 100%; margin-top: 6px;">
                        <i class="fas fa-forward"></i> Jump to first unlabeled
                    </button>
                    <div class="toggle-row" style="margin-top: 10px;">
                        <label class="toggle-switch">
                            <input type="checkbox" id="fvShowVerified">
                            <span class="toggle-slider"></span>
                        </label>
                        <span>Show verified meshes</span>
                    </div>
                </div>
            </div>

            <!-- Postprocessing -->
            <div class="panel-section" id="fvPostprocessSection" style="display: none;">
                <div class="section-header">
                    <i class="fas fa-microchip"></i>
                    <span>Postprocessing</span>
                </div>
                <div class="section-content">
                    <div id="fvPostprocessControls"></div>
                </div>
            </div>

            <!-- Actions -->
            <div class="panel-section" id="fvActionsSection" style="display: none;">
                <div class="section-header">
                    <i class="fas fa-gavel"></i>
                    <span>Verdict</span>
                </div>
                <div class="section-content">
                    <div class="btn-row">
                        <button id="fvRejectBtn" class="btn btn-danger btn-full">
                            <i class="fas fa-times"></i> Reject
                        </button>
                        <button id="fvAcceptBtn" class="btn btn-success btn-full">
                            <i class="fas fa-check"></i> Accept
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Grab references
        this.datasetSelect = document.getElementById('fvDatasetSelect');
        this.statusEl = document.getElementById('fvStatus');
        this.progressSection = document.getElementById('fvProgressSection');
        this.positionLabel = document.getElementById('fvPositionLabel');
        this.countsLabel = document.getElementById('fvCountsLabel');
        this.meshNameEl = document.getElementById('fvMeshName');
        this.postprocessSection = document.getElementById('fvPostprocessSection');
        this.postprocessControls = document.getElementById('fvPostprocessControls');
        this.verdictBadge = document.getElementById('fvVerdictBadge');
        this.actionsSection = document.getElementById('fvActionsSection');
        this.prevBtn = document.getElementById('fvPrevBtn');
        this.nextBtn = document.getElementById('fvNextBtn');
        this.acceptBtn = document.getElementById('fvAcceptBtn');
        this.rejectBtn = document.getElementById('fvRejectBtn');
        this.showVerifiedCb = document.getElementById('fvShowVerified');
        this.jumpUnlabeledBtn = document.getElementById('fvJumpUnlabeledBtn');

        this._buildPostprocessControls();
    }

    /**
     * Build postprocessing parameter controls using the same class conventions
     * as ModelPanel._buildParamControl (config-param, slider-row, etc.)
     */
    _buildPostprocessControls() {
        if (!this.postprocessControls) return;
        this.postprocessControls.innerHTML = '';

        for (const [key, meta] of Object.entries(CONFIG_PARAMS)) {
            if (meta.category !== 'postprocess') continue;

            const wrapper = document.createElement('div');
            wrapper.className = 'config-param';
            wrapper.title = meta.description || '';

            // Header row: label + default
            const header = document.createElement('div');
            header.className = 'config-param-header';

            const label = document.createElement('span');
            label.className = 'config-param-label';
            label.textContent = meta.label;
            header.appendChild(label);

            const defaultVal = DEFAULT_INFERENCE_CONFIG[key];
            const hint = document.createElement('span');
            hint.className = 'config-param-default';
            hint.textContent = `Default: ${defaultVal === null ? 'None' : defaultVal}`;
            header.appendChild(hint);

            wrapper.appendChild(header);

            // Control
            let input;
            if (meta.type === 'slider') {
                const row = document.createElement('div');
                row.className = 'slider-row';

                input = document.createElement('input');
                input.type = 'range';
                input.min = meta.min;
                input.max = meta.max;
                input.step = meta.step;
                input.value = this.config[key];
                input.className = 'styled-slider';

                const valueDisplay = document.createElement('span');
                valueDisplay.className = 'slider-value';
                valueDisplay.textContent = this.config[key];

                input.addEventListener('input', () => {
                    valueDisplay.textContent = parseFloat(input.value);
                });
                input.addEventListener('change', () => {
                    this.config[key] = parseFloat(input.value);
                    this._onPostprocessChanged();
                });

                row.appendChild(input);
                row.appendChild(valueDisplay);
                wrapper.appendChild(row);
            } else if (meta.type === 'number') {
                input = document.createElement('input');
                input.type = 'number';
                input.min = meta.min;
                input.max = meta.max;
                input.step = meta.step;
                input.value = this.config[key];
                input.className = 'control-input';

                input.addEventListener('change', () => {
                    const val = parseInt(input.value, 10);
                    if (!isNaN(val)) {
                        this.config[key] = val;
                        this._onPostprocessChanged();
                    }
                });

                wrapper.appendChild(input);
            } else if (meta.type === 'select') {
                input = document.createElement('select');
                input.className = 'control-select';

                for (const opt of meta.options) {
                    const o = document.createElement('option');
                    o.value = opt;
                    o.textContent = opt;
                    if (opt === this.config[key]) o.selected = true;
                    input.appendChild(o);
                }

                input.addEventListener('change', () => {
                    this.config[key] = input.value;
                    this._onPostprocessChanged();
                });

                wrapper.appendChild(input);
            }

            if (input) input.dataset.configKey = key;
            this.postprocessControls.appendChild(wrapper);
        }
    }

    _bindEvents() {
        if (this.datasetSelect) {
            this.datasetSelect.addEventListener('change', () => {
                const val = this.datasetSelect.value;
                if (val) {
                    this._loadDataset(val);
                }
            });
        }

        if (this.prevBtn) this.prevBtn.addEventListener('click', () => this._navigate(-1));
        if (this.nextBtn) this.nextBtn.addEventListener('click', () => this._navigate(1));
        if (this.acceptBtn) this.acceptBtn.addEventListener('click', () => this._accept());
        if (this.rejectBtn) this.rejectBtn.addEventListener('click', () => this._reject());
        if (this.showVerifiedCb) {
            this.showVerifiedCb.addEventListener('change', async () => {
                const currentMesh = this.queue[this.cursor];
                this.showVerified = this.showVerifiedCb.checked;
                this._rebuildQueue();
                // Restore cursor to the same mesh in the new queue
                if (currentMesh) {
                    const idx = this.queue.findIndex(m => m.mesh_id === currentMesh.mesh_id);
                    if (idx !== -1) {
                        this.cursor = idx;
                        this._updateProgress();
                        return;
                    }
                }
                if (this.queue.length > 0) {
                    await this._loadCurrent();
                }
            });
        }
        if (this.jumpUnlabeledBtn) {
            this.jumpUnlabeledBtn.addEventListener('click', () => this._jumpToFirstUnlabeled());
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Lifecycle
    // ═══════════════════════════════════════════════════════════════

    async onShow() {
        if (!lithicClient.isConfigured()) {
            this._setStatus('Requires cloud connection. Configure in Settings.', 'info');
            return;
        }

        try {
            const resp = await lithicClient.listDatasets();
            this.datasets = resp.datasets || [];

            // Rebuild select options
            const current = this.datasetSelect.value;
            this.datasetSelect.innerHTML = '<option value="">-- select dataset --</option>';
            for (const ds of this.datasets) {
                const opt = document.createElement('option');
                opt.value = ds.name;
                opt.textContent = `${ds.name} (${ds.mesh_count} meshes)`;
                if (ds.name === current) opt.selected = true;
                this.datasetSelect.appendChild(opt);
            }

            if (this.datasets.length === 0) {
                this._setStatus('No datasets found.', 'info');
            } else if (!current && this.datasets.length === 1) {
                this.datasetSelect.value = this.datasets[0].name;
                this._loadDataset(this.datasets[0].name);
            }
        } catch (e) {
            console.error('[FastVerification] Failed to list datasets:', e);
            // Treat 404 / network errors as "no datasets" rather than scary errors
            const msg = e?.message || '';
            if (msg.includes('404') || msg.includes('Not Found')) {
                this._setStatus('No datasets found.', 'info');
            } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch')) {
                this._setStatus('Requires cloud connection. Configure in Settings.', 'info');
            } else {
                this._setStatus('No datasets found.', 'info');
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Dataset + Queue
    // ═══════════════════════════════════════════════════════════════

    async _loadDataset(datasetId) {
        this.currentDatasetId = datasetId;
        this._setStatus('Loading dataset...', 'info');
        this._setLoading(true);

        try {
            const resp = await lithicClient.listDatasetMeshes(datasetId);
            this.allMeshes = resp.meshes || [];
            this._rebuildQueue();

            const verified = resp.verified_count || 0;
            const total = resp.total_count || 0;
            this._setStatus(`Loaded ${total} meshes (${verified} verified, ${total - verified} pending).`, 'success');

            // Show sections
            this.progressSection.style.display = '';
            this.postprocessSection.style.display = '';
            this.actionsSection.style.display = '';

            // Load first mesh
            if (this.queue.length > 0) {
                this.cursor = 0;
                await this._loadCurrent();
            } else {
                this._setStatus('All meshes have been verified!', 'success');
            }
        } catch (e) {
            console.error('[FastVerification] Failed to load dataset:', e);
            this._setStatus('Failed: ' + e.message, 'error');
        } finally {
            this._setLoading(false);
        }
    }

    _rebuildQueue() {
        if (this.showVerified) {
            this.queue = [...this.allMeshes];
        } else {
            this.queue = this.allMeshes.filter(m => m.verdict == null);
        }

        // Clamp cursor
        if (this.cursor >= this.queue.length) {
            this.cursor = Math.max(0, this.queue.length - 1);
        }

        this._updateProgress();
    }

    // ═══════════════════════════════════════════════════════════════
    //  Navigation
    // ═══════════════════════════════════════════════════════════════

    async _navigate(delta) {
        const next = this.cursor + delta;
        if (next < 0 || next >= this.queue.length) return;
        this.cursor = next;
        await this._loadCurrent();
    }

    async _jumpToFirstUnlabeled() {
        const idx = this.queue.findIndex(m => m.verdict == null);
        if (idx === -1) {
            this._setStatus('All meshes in current view are verified!', 'info');
            return;
        }
        this.cursor = idx;
        await this._loadCurrent();
    }

    async _loadCurrent() {
        if (this.queue.length === 0) {
            this._setStatus('No meshes to show.', 'info');
            return;
        }

        const mesh = this.queue[this.cursor];
        if (!mesh) return;

        this._setLoading(true);
        this._setStatus(`Loading ${mesh.original_name}...`, 'info');

        try {
            // 1. Set postprocessing config — restore saved params for accepted meshes
            let savedParams = null;
            if (mesh.verdict === 'accept') {
                try {
                    const listResp = await lithicClient.listDatasetMeshStates(this.currentDatasetId, mesh.mesh_id);
                    const acceptEntry = (listResp.states || []).find(s => s.name === 'verification-accept');
                    if (acceptEntry) {
                        const stateData = await lithicClient.loadDatasetMeshState(this.currentDatasetId, mesh.mesh_id, acceptEntry.state_id);
                        savedParams = stateData?.metadata?.postprocessing_params || null;
                    }
                } catch (e) {
                    console.warn('[FastVerification] Could not load saved params:', e);
                }
            }
            this._applyPostprocessConfig(savedParams);

            // 2. Download and load mesh PLY
            this._loadingDatasetMesh = true;
            const blob = await lithicClient.downloadDatasetMesh(this.currentDatasetId, mesh.mesh_id);
            const file = new File([blob], mesh.original_name, { type: 'application/octet-stream' });
            await this.meshLoader.loadFile(file);
            this._loadingDatasetMesh = false;

            // Update filename display
            const fileNameDisplay = document.getElementById('fileName');
            if (fileNameDisplay) {
                fileNameDisplay.textContent = mesh.original_name;
                fileNameDisplay.title = `Dataset: ${this.currentDatasetId} / ${mesh.mesh_id}`;
            }

            // 3. Fetch model output
            const modelOutput = await lithicClient.getDatasetModelOutput(this.currentDatasetId, mesh.mesh_id);
            this.cachedModelOutput = {
                edgePredictions: new Float64Array(modelOutput.edge_predictions),
                faceAdjacencyFlat: new Int32Array(modelOutput.face_adjacency),
                numFaces: modelOutput.num_faces,
            };

            // 4. Run postprocessing
            this._runPostprocessing();

            this._updateProgress();
            this._showVerdictBadge(mesh.verdict);
            this._setStatus(`Loaded ${mesh.original_name}`, 'success');
        } catch (e) {
            this._loadingDatasetMesh = false;
            console.error('[FastVerification] Load failed:', e);
            this._setStatus('Failed to load: ' + e.message, 'error');
        } finally {
            this._setLoading(false);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Postprocessing
    // ═══════════════════════════════════════════════════════════════

    _applyPostprocessConfig(params = null) {
        this.config = { ...DEFAULT_INFERENCE_CONFIG, ...params };

        // Update UI controls to match
        if (this.postprocessControls) {
            const inputs = this.postprocessControls.querySelectorAll('[data-config-key]');
            for (const input of inputs) {
                const key = input.dataset.configKey;
                if (key in this.config) {
                    input.value = this.config[key];
                    // Update slider value display
                    const valueSpan = input.closest('.slider-row')?.querySelector('.slider-value');
                    if (valueSpan) {
                        valueSpan.textContent = this.config[key];
                    }
                }
            }
        }
    }

    _onPostprocessChanged() {
        if (!this.cachedModelOutput) return;

        if (this._postprocessDebounceTimer) {
            clearTimeout(this._postprocessDebounceTimer);
        }
        this._postprocessDebounceTimer = setTimeout(() => {
            this._postprocessDebounceTimer = null;
            this._runPostprocessing();
        }, 100);
    }

    _runPostprocessing() {
        if (!this.cachedModelOutput) return;

        console.time('[FastVerification] Postprocessing');
        const labels = runClientPostprocessing(this.cachedModelOutput, this.meshView, this.config);

        // Apply as edge annotation
        const edgeIndices = new Set();
        for (let i = 0; i < labels.length; i++) {
            if (labels[i] === 1 || labels[i] > 0.5) {
                edgeIndices.add(i);
            }
        }

        const annotation = new Annotation({
            edgeIndices,
            arrows: [],
            metadata: {
                name: 'Fast Verification',
                source: 'model',
            },
        });

        this.meshView.applyExternalAnnotation(annotation, 'model');

        eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
            name: annotation.name,
            source: 'fast-verification',
        });

        console.timeEnd('[FastVerification] Postprocessing');
    }

    // ═══════════════════════════════════════════════════════════════
    //  Accept / Reject
    // ═══════════════════════════════════════════════════════════════

    async _accept() {
        const mesh = this.queue[this.cursor];
        if (!mesh) return;

        this._setLoading(true);
        try {
            const edgeIndices = Array.from(this.meshView.currentEdgeIndices || []);

            const postprocessingParams = {
                union_find_max_merge_cost: this.config.union_find_max_merge_cost,
                union_find_merge_cost: this.config.union_find_merge_cost,
                min_segment_size: this.config.min_segment_size,
                union_find_max_segment_size: this.config.union_find_max_segment_size,
            };
            await lithicClient.saveDatasetMeshState(
                this.currentDatasetId,
                mesh.mesh_id,
                edgeIndices,
                'verification-accept',
                '',
                {
                    verdict: 'accept',
                    accepted_at: new Date().toISOString(),
                    postprocessing_params: postprocessingParams,
                }
            );

            mesh.verdict = 'accept';
            this._setStatus(`Accepted ${mesh.original_name}`, 'success');

            await this._advanceAfterVerdict();
        } catch (e) {
            console.error('[FastVerification] Accept failed:', e);
            this._setStatus('Accept failed: ' + e.message, 'error');
        } finally {
            this._setLoading(false);
        }
    }

    async _reject() {
        const mesh = this.queue[this.cursor];
        if (!mesh) return;

        this._setLoading(true);
        try {
            await lithicClient.saveDatasetMeshState(
                this.currentDatasetId,
                mesh.mesh_id,
                [],
                'verification-reject',
                '',
                {
                    verdict: 'reject',
                    rejected_at: new Date().toISOString(),
                }
            );

            mesh.verdict = 'reject';
            this._setStatus(`Rejected ${mesh.original_name}`, 'info');

            await this._advanceAfterVerdict();
        } catch (e) {
            console.error('[FastVerification] Reject failed:', e);
            this._setStatus('Reject failed: ' + e.message, 'error');
        } finally {
            this._setLoading(false);
        }
    }

    async _advanceAfterVerdict() {
        const prevLength = this.queue.length;
        this._rebuildQueue();

        if (this.queue.length === 0) {
            this._setStatus('All meshes verified!', 'success');
            return;
        }

        if (this.showVerified) {
            if (this.cursor < this.queue.length - 1) {
                this.cursor++;
            }
        } else {
            if (this.cursor >= this.queue.length) {
                this.cursor = this.queue.length - 1;
            }
        }

        await this._loadCurrent();
    }

    // ═══════════════════════════════════════════════════════════════
    //  UI Helpers
    // ═══════════════════════════════════════════════════════════════

    _updateProgress() {
        const mesh = this.queue[this.cursor];
        if (mesh && this.positionLabel) {
            this.positionLabel.textContent = `${this.cursor + 1} / ${this.queue.length}`;
        }
        if (mesh && this.meshNameEl) {
            this.meshNameEl.textContent = mesh.original_name;
        }
        if (mesh) {
            this._showVerdictBadge(mesh.verdict);
        }

        const verified = this.allMeshes.filter(m => m.verdict != null).length;
        const total = this.allMeshes.length;
        if (this.countsLabel) {
            this.countsLabel.textContent = `${verified} / ${total} verified`;
        }

        // Update nav button states
        if (this.prevBtn) this.prevBtn.disabled = this.cursor <= 0 || this.isLoading;
        if (this.nextBtn) this.nextBtn.disabled = this.cursor >= this.queue.length - 1 || this.isLoading;
        if (this.jumpUnlabeledBtn) {
            if (!this.showVerified) {
                this.jumpUnlabeledBtn.style.display = 'none';
            } else {
                this.jumpUnlabeledBtn.style.display = '';
                const hasUnlabeled = this.queue.some(m => m.verdict == null);
                this.jumpUnlabeledBtn.disabled = !hasUnlabeled || this.isLoading;
            }
        }
    }

    _showVerdictBadge(verdict) {
        if (!this.verdictBadge) return;

        if (verdict === 'accept') {
            this.verdictBadge.innerHTML = `
                <div class="inference-status success" style="margin: 0;">
                    <i class="fas fa-check-circle"></i>
                    <span>Previously accepted</span>
                </div>`;
        } else if (verdict === 'reject') {
            this.verdictBadge.innerHTML = `
                <div class="inference-status error" style="margin: 0;">
                    <i class="fas fa-times-circle"></i>
                    <span>Previously rejected</span>
                </div>`;
        } else {
            this.verdictBadge.innerHTML = '';
        }
    }

    _setStatus(message, type = 'info') {
        if (!this.statusEl) return;
        const icons = {
            info: 'fa-info-circle',
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
        };
        this.statusEl.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> <span>${message}</span>`;
        this.statusEl.className = `inference-status ${type}`;
    }

    _setLoading(loading) {
        this.isLoading = loading;
        const buttons = [this.prevBtn, this.nextBtn, this.acceptBtn, this.rejectBtn, this.jumpUnlabeledBtn];
        for (const btn of buttons) {
            if (btn) btn.disabled = loading;
        }
        this._updateProgress();
    }
}
