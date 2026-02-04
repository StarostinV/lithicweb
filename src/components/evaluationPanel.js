/**
 * EvaluationPanel - UI component for evaluation mode.
 * 
 * Provides controls for:
 * - Viewing/clearing GT and Prediction labels
 * - Adjusting metric thresholds (IoU, overseg, underseg)
 * - Computing and displaying metrics
 * - Selecting visualization modes
 * - Dual-view comparison mode
 * 
 * ## Event Bus Integration
 * 
 * Subscribes to:
 * - `Events.EVALUATION_GT_CHANGED` - Updates GT status display
 * - `Events.EVALUATION_PRED_CHANGED` - Updates Pred status display
 * - `Events.EVALUATION_METRICS_COMPUTED` - Updates metrics display
 * - `Events.EVALUATION_MODE_CHANGED` - Handles evaluation mode entry/exit
 * - `Events.DUAL_VIEW_CHANGED` - Updates dual-view UI state
 * 
 * @module EvaluationPanel
 */

import { summarizeMetrics } from '../evaluation/MetricsComputer.js';
import { eventBus, Events } from '../utils/EventBus.js';
import { 
    MatchedVisualization, 
    OverSegVisualization, 
    UnderSegVisualization, 
    MissingGTVisualization, 
    MissingPredVisualization,
    AllErrorsVisualization,
    GTVisualization,
    PredVisualization,
    EVALUATION_COLORS 
} from '../evaluation/visualizations/index.js';

/**
 * UI Panel for evaluation functionality.
 */
export class EvaluationPanel {
    /**
     * Create an EvaluationPanel.
     * @param {MeshView} meshView - The mesh view object
     * @param {EvaluationManager} evaluationManager - The evaluation manager
     */
    constructor(meshView, evaluationManager) {
        this.meshView = meshView;
        this.evaluationManager = evaluationManager;

        // Default threshold values
        this.iouThreshold = 0.5;
        this.oversegThreshold = 0.1;
        this.undersegThreshold = 0.1;

        // Current visualization instance
        this.currentVisualization = null;

        // Cache visualization instances
        this.visualizations = {};
        
        // Dual view manager (set via setDualViewManager)
        this.dualViewManager = null;

        // Initialize UI
        this._initializeUI();
        this._setupEventListeners();
        this._setupEventBusSubscriptions();
    }
    
    /**
     * Set the DualViewManager reference.
     * @param {DualViewManager} dualViewManager - The dual view manager
     */
    setDualViewManager(dualViewManager) {
        this.dualViewManager = dualViewManager;
    }
    
    /**
     * Setup EventBus subscriptions.
     * Uses namespace for easy cleanup in dispose().
     * @private
     */
    _setupEventBusSubscriptions() {
        // Listen to evaluation changes via EventBus
        eventBus.on(Events.EVALUATION_GT_CHANGED, (data) => {
            this._onGtChanged(data);
        }, 'evaluationPanel');
        
        eventBus.on(Events.EVALUATION_PRED_CHANGED, (data) => {
            this._onPredChanged(data);
        }, 'evaluationPanel');
        
        eventBus.on(Events.EVALUATION_METRICS_COMPUTED, (data) => {
            if (data.metrics) {
                this._displayMetrics(data.metrics);
                // If dual view is enabled, refresh it with new metrics
                if (this.dualViewManager?.isEnabled()) {
                    this._updateDualViewVisualizations();
                }
            }
        }, 'evaluationPanel');
        
        // Listen to dual view changes (in case it's toggled externally)
        eventBus.on(Events.DUAL_VIEW_CHANGED, (data) => {
            if (this.dualViewEnabled) {
                this.dualViewEnabled.checked = data.enabled;
            }
            if (data.enabled) {
                this.dualViewToggle?.classList.add('active');
                this.dualViewControls?.classList.add('visible');
            } else {
                this.dualViewToggle?.classList.remove('active');
                this.dualViewControls?.classList.remove('visible');
            }
        }, 'evaluationPanel');
    }
    
    /**
     * Handle GT changed event.
     * @private
     */
    _onGtChanged(data) {
        if (this.gtStatusEl) {
            if (data.isSet) {
                this.gtStatusEl.textContent = data.description || 'Ground Truth';
                this.gtStatusEl.classList.remove('text-gray-400');
                this.gtStatusEl.classList.add('text-green-600');
            } else {
                this.gtStatusEl.textContent = 'Not set';
                this.gtStatusEl.classList.remove('text-green-600');
                this.gtStatusEl.classList.add('text-gray-400');
            }
        }
        this._updateComputeButtonState();
    }
    
    /**
     * Handle Pred changed event.
     * @private
     */
    _onPredChanged(data) {
        if (this.predStatusEl) {
            if (data.isSet) {
                this.predStatusEl.textContent = data.description || 'Prediction';
                this.predStatusEl.classList.remove('text-gray-400');
                this.predStatusEl.classList.add('text-purple-600');
            } else {
                this.predStatusEl.textContent = 'Not set';
                this.predStatusEl.classList.remove('text-purple-600');
                this.predStatusEl.classList.add('text-gray-400');
            }
        }
        this._updateComputeButtonState();
    }
    
    /**
     * Update compute button enabled state.
     * @private
     */
    _updateComputeButtonState() {
        if (this.computeBtn) {
            this.computeBtn.disabled = !this.evaluationManager.canComputeMetrics();
        }
    }
    
    /**
     * Clean up resources and EventBus subscriptions.
     * Call this when the panel is being destroyed.
     */
    dispose() {
        eventBus.offNamespace('evaluationPanel');
    }

    /**
     * Initialize the UI elements.
     * @private
     */
    _initializeUI() {
        // Get references to UI elements
        this.gtStatusEl = document.getElementById('evalGtStatus');
        this.predStatusEl = document.getElementById('evalPredStatus');
        this.clearGtBtn = document.getElementById('evalClearGt');
        this.clearPredBtn = document.getElementById('evalClearPred');
        
        this.iouSlider = document.getElementById('evalIouThreshold');
        this.iouValue = document.getElementById('evalIouValue');
        this.oversegSlider = document.getElementById('evalOversegThreshold');
        this.oversegValue = document.getElementById('evalOversegValue');
        this.undersegSlider = document.getElementById('evalUndersegThreshold');
        this.undersegValue = document.getElementById('evalUndersegValue');
        
        this.computeBtn = document.getElementById('evalComputeBtn');
        this.resultsContainer = document.getElementById('evalResults');
        this.errorBreakdown = document.getElementById('evalErrorBreakdown');
        
        this.vizModeRadios = document.querySelectorAll('input[name="evalVizMode"]');
        this.showGtEdgesCheckbox = document.getElementById('evalShowGtEdges');
        this.colorLegend = document.getElementById('evalColorLegend');
        
        // Dual view controls
        this.dualViewToggle = document.getElementById('dualViewToggle');
        this.dualViewEnabled = document.getElementById('dualViewEnabled');
        this.dualViewControls = document.getElementById('dualViewControls');
        this.leftViewModeSelect = document.getElementById('leftViewMode');
        this.rightViewModeSelect = document.getElementById('rightViewMode');
        this.swapViewsBtn = document.getElementById('swapViewsBtn');

        // Update initial slider values
        this._updateSliderDisplays();
    }

    /**
     * Setup event listeners.
     * @private
     */
    _setupEventListeners() {
        // Note: Evaluation state changes are now listened via EventBus in _setupEventBusSubscriptions()

        // Clear buttons
        this.clearGtBtn?.addEventListener('click', () => {
            this.evaluationManager.clearGroundTruth();
        });

        this.clearPredBtn?.addEventListener('click', () => {
            this.evaluationManager.clearPrediction();
        });

        // Threshold sliders
        this.iouSlider?.addEventListener('input', (e) => {
            this.iouThreshold = parseFloat(e.target.value);
            this._updateSliderDisplays();
        });

        this.oversegSlider?.addEventListener('input', (e) => {
            this.oversegThreshold = parseFloat(e.target.value);
            this._updateSliderDisplays();
        });

        this.undersegSlider?.addEventListener('input', (e) => {
            this.undersegThreshold = parseFloat(e.target.value);
            this._updateSliderDisplays();
        });

        // Compute button
        this.computeBtn?.addEventListener('click', () => {
            this._computeMetrics();
        });

        // Visualization mode radios
        this.vizModeRadios?.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this._setVisualizationMode(e.target.value);
                }
            });
        });

        // GT edges overlay checkbox
        this.showGtEdgesCheckbox?.addEventListener('change', (e) => {
            this.evaluationManager.setShowGtEdgeOverlay(e.target.checked);
        });
        
        // Dual view toggle - handle click on the row only if not on the toggle-switch area
        this.dualViewToggle?.addEventListener('click', (e) => {
            // Check if the click is on the toggle-switch or its children (label, checkbox, slider)
            const toggleSwitch = this.dualViewToggle.querySelector('.toggle-switch');
            const isOnToggleSwitch = toggleSwitch && (toggleSwitch.contains(e.target) || e.target === toggleSwitch);
            
            // Only manually toggle if clicking outside the toggle-switch area
            if (!isOnToggleSwitch && this.dualViewEnabled) {
                this.dualViewEnabled.checked = !this.dualViewEnabled.checked;
                this._toggleDualView();
            }
        });
        
        // Handle checkbox change directly (this fires when clicking on the toggle-switch)
        this.dualViewEnabled?.addEventListener('change', () => {
            this._toggleDualView();
        });
        
        // Left view mode change
        this.leftViewModeSelect?.addEventListener('change', (e) => {
            this._updateDualViewMode('left', e.target.value);
        });
        
        // Right view mode change
        this.rightViewModeSelect?.addEventListener('change', (e) => {
            this._updateDualViewMode('right', e.target.value);
        });
        
        // Swap views button
        this.swapViewsBtn?.addEventListener('click', () => {
            this._swapViews();
        });
    }
    
    /**
     * Toggle dual view mode on/off.
     * @private
     */
    _toggleDualView() {
        if (!this.dualViewManager) {
            console.warn('DualViewManager not set');
            return;
        }
        
        const enabled = this.dualViewEnabled?.checked || false;
        
        if (enabled) {
            // Need metrics to enable dual view
            if (!this.evaluationManager.getMetrics()) {
                alert('Please compute metrics first before enabling dual view.');
                this.dualViewEnabled.checked = false;
                return;
            }
            
            this.dualViewManager.enable();
            this.dualViewToggle?.classList.add('active');
            this.dualViewControls?.classList.add('visible');
            
            // Set initial visualizations for both views
            this._updateDualViewVisualizations();
        } else {
            this.dualViewManager.disable();
            this.dualViewToggle?.classList.remove('active');
            this.dualViewControls?.classList.remove('visible');
            
            // Restore single view visualization
            const selectedMode = document.querySelector('input[name="evalVizMode"]:checked')?.value || 'all';
            this._setVisualizationMode(selectedMode);
        }
    }
    
    /**
     * Update visualization mode for a specific view in dual view mode.
     * @private
     * @param {'left'|'right'} view - Which view to update
     * @param {string} mode - Visualization mode
     */
    _updateDualViewMode(view, mode) {
        if (!this.dualViewManager) return;
        
        if (view === 'left') {
            this.dualViewManager.setLeftViewMode(mode);
        } else {
            this.dualViewManager.setRightViewMode(mode);
        }
        
        this._updateDualViewVisualizations();
    }
    
    /**
     * Swap left and right view modes.
     * @private
     */
    _swapViews() {
        if (!this.leftViewModeSelect || !this.rightViewModeSelect) return;
        
        const leftMode = this.leftViewModeSelect.value;
        const rightMode = this.rightViewModeSelect.value;
        
        this.leftViewModeSelect.value = rightMode;
        this.rightViewModeSelect.value = leftMode;
        
        if (this.dualViewManager) {
            this.dualViewManager.setLeftViewMode(rightMode);
            this.dualViewManager.setRightViewMode(leftMode);
            this._updateDualViewVisualizations();
        }
    }
    
    /**
     * Update dual view visualizations based on current mode selections.
     * @private
     */
    _updateDualViewVisualizations() {
        if (!this.dualViewManager || !this.dualViewManager.isEnabled()) return;
        
        const result = this.evaluationManager.getMetrics();
        if (!result) return;
        
        const leftMode = this.leftViewModeSelect?.value || 'gt';
        const rightMode = this.rightViewModeSelect?.value || 'pred';
        
        // Create visualization instances
        const leftViz = this._createVisualization(leftMode);
        const rightViz = this._createVisualization(rightMode);
        
        // Set visualizations on dual view manager
        this.dualViewManager.setVisualizations({
            leftVisualization: leftViz,
            rightVisualization: rightViz,
            metrics: result
        });
        
        // Update labels
        this.dualViewManager.setLeftViewMode(leftMode);
        this.dualViewManager.setRightViewMode(rightMode);
        
        // Refresh the rendering
        this.dualViewManager.refresh();
    }

    /**
     * Update slider value displays.
     * @private
     */
    _updateSliderDisplays() {
        if (this.iouValue) {
            this.iouValue.textContent = this.iouThreshold.toFixed(2);
        }
        if (this.oversegValue) {
            this.oversegValue.textContent = this.oversegThreshold.toFixed(2);
        }
        if (this.undersegValue) {
            this.undersegValue.textContent = this.undersegThreshold.toFixed(2);
        }
    }

    /**
     * Compute metrics and update display.
     * @private
     */
    _computeMetrics() {
        if (!this.evaluationManager.canComputeMetrics()) {
            alert('Please set both Ground Truth and Prediction before computing metrics.');
            return;
        }

        // Enter evaluation mode
        this.evaluationManager.enterEvaluationMode();

        // Compute metrics
        const result = this.evaluationManager.computeMetrics({
            iouThresh: this.iouThreshold,
            oversegThresh: this.oversegThreshold,
            undersegThresh: this.undersegThreshold
        });

        if (result) {
            this._displayMetrics(result);
            
            // Save evaluation metrics to annotation metadata
            this._saveEvaluationMetadata(result);
            
            // Apply default visualization
            const selectedMode = document.querySelector('input[name="evalVizMode"]:checked')?.value || 'all';
            this._setVisualizationMode(selectedMode);
        }
    }
    
    /**
     * Save evaluation metrics to the current annotation's metadata.
     * This persists the evaluation results with the annotation for later reference.
     * @private
     * @param {Object} result - The metrics result object
     */
    _saveEvaluationMetadata(result) {
        const summary = this.evaluationManager.getSummary();
        
        // Build structured evaluation metadata matching metadataPanel's expected format
        const evaluationMetadata = {
            general: {
                computedAt: Date.now(),
                gtDescription: summary.groundTruthDescription,
                predDescription: summary.predictionDescription,
                nGtInstances: result.nGtInstances,
                nPredInstances: result.nPredInstances
            },
            detection: {
                TP: result.TP,
                FP: result.FP,
                FN: result.FN,
                precision: result.precision,
                recall: result.recall,
                f1: result.f1
            },
            panoptic: {
                PQ: result.PQ,
                RQ: result.RQ,
                SQ: result.SQ
            },
            errors: {
                nOversegGt: result.nOversegGt,
                oversegFrac: result.oversegFrac,
                nUndersegPred: result.nUndersegPred,
                undersegFrac: result.undersegFrac,
                nMissingGt: result.nMissingGt,
                missingGtFrac: result.missingGtFrac,
                nMissingPred: result.nMissingPred,
                missingPredFrac: result.missingPredFrac
            },
            thresholds: {
                iouThresh: this.iouThreshold,
                oversegThresh: this.oversegThreshold,
                undersegThresh: this.undersegThreshold
            }
        };
        
        // Save to current state's annotation metadata
        this.meshView.setCurrentStateMetadata('evaluation', evaluationMetadata);
        
        console.log('Evaluation metrics saved to annotation metadata:', evaluationMetadata);
    }

    /**
     * Display metrics results.
     * @private
     */
    _displayMetrics(result) {
        if (!this.resultsContainer) return;

        // Metric tooltips/explanations
        const tooltips = {
            TP: 'True Positives: Number of GT segments correctly matched by predictions (IoU ≥ threshold)',
            FP: 'False Positives: Predicted segments that do not match any GT segment',
            FN: 'False Negatives: GT segments that were not detected by any prediction',
            precision: 'Precision = TP / (TP + FP). How many predicted segments are correct.',
            recall: 'Recall = TP / (TP + FN). How many GT segments were found.',
            f1: 'F1 Score = 2 × (Precision × Recall) / (Precision + Recall). Harmonic mean of precision and recall.',
            PQ: 'Panoptic Quality = SQ × RQ. Overall segmentation quality combining recognition and segmentation.',
            RQ: 'Recognition Quality = TP / (TP + 0.5×FP + 0.5×FN). How well segments are recognized.',
            SQ: 'Segmentation Quality = Average IoU of matched pairs. How well matched segments align.',
            meanIou: 'Mean IoU of all matched GT-Prediction pairs.'
        };

        // Main metrics with tooltips
        this.resultsContainer.innerHTML = `
            <div class="eval-instance-counts">
                <span class="eval-count-item" title="Number of ground truth segments">
                    <i class="fas fa-bullseye"></i> GT: <strong>${result.nGtInstances}</strong> segments
                </span>
                <span class="eval-count-item" title="Number of predicted segments">
                    <i class="fas fa-crosshairs"></i> Pred: <strong>${result.nPredInstances}</strong> segments
                </span>
            </div>
            
            <div class="eval-metrics-grid">
                <div class="eval-metric-card success" title="${tooltips.TP}">
                    <div class="metric-value">${result.TP}</div>
                    <div class="metric-label">True Positives</div>
                </div>
                <div class="eval-metric-card danger" title="${tooltips.FP}">
                    <div class="metric-value">${result.FP}</div>
                    <div class="metric-label">False Positives</div>
                </div>
                <div class="eval-metric-card warning" title="${tooltips.FN}">
                    <div class="metric-value">${result.FN}</div>
                    <div class="metric-label">False Negatives</div>
                </div>
            </div>
            
            <div class="eval-metrics-section">
                <div class="eval-metrics-section-title">Detection Metrics</div>
                <div class="eval-metric-row-detailed">
                    <div class="eval-metric-item" title="${tooltips.precision}">
                        <span class="metric-name">Precision</span>
                        <span class="metric-val">${(result.precision * 100).toFixed(1)}%</span>
                    </div>
                    <div class="eval-metric-item" title="${tooltips.recall}">
                        <span class="metric-name">Recall</span>
                        <span class="metric-val">${(result.recall * 100).toFixed(1)}%</span>
                    </div>
                    <div class="eval-metric-item highlight" title="${tooltips.f1}">
                        <span class="metric-name">F1 Score</span>
                        <span class="metric-val">${(result.f1 * 100).toFixed(1)}%</span>
                    </div>
                </div>
            </div>
            
            <div class="eval-metrics-section">
                <div class="eval-metrics-section-title">Panoptic Quality</div>
                <div class="eval-metric-row-detailed">
                    <div class="eval-metric-item highlight" title="${tooltips.PQ}">
                        <span class="metric-name">PQ</span>
                        <span class="metric-val">${(result.PQ * 100).toFixed(1)}%</span>
                    </div>
                    <div class="eval-metric-item" title="${tooltips.RQ}">
                        <span class="metric-name">RQ</span>
                        <span class="metric-val">${(result.RQ * 100).toFixed(1)}%</span>
                    </div>
                    <div class="eval-metric-item" title="${tooltips.SQ}">
                        <span class="metric-name">SQ</span>
                        <span class="metric-val">${isNaN(result.SQ) ? 'N/A' : (result.SQ * 100).toFixed(1) + '%'}</span>
                    </div>
                </div>
            </div>
        `;

        // Error breakdown with tooltips
        if (this.errorBreakdown) {
            this.errorBreakdown.innerHTML = `
                <div class="eval-error-item overseg" title="Over-segmentation: A single GT segment was incorrectly split into multiple predictions">
                    <span class="error-icon">●</span>
                    <span class="error-label">Over-segmentation</span>
                    <span class="error-count">${result.nOversegGt} GT split</span>
                    <span class="error-pct">${(result.oversegFrac * 100).toFixed(1)}%</span>
                </div>
                <div class="eval-error-item underseg" title="Under-segmentation: A single prediction incorrectly merges multiple GT segments">
                    <span class="error-icon">●</span>
                    <span class="error-label">Under-segmentation</span>
                    <span class="error-count">${result.nUndersegPred} merged</span>
                    <span class="error-pct">${(result.undersegFrac * 100).toFixed(1)}%</span>
                </div>
                <div class="eval-error-item missing-gt" title="Missing GT: Ground truth segments that have no matching prediction (false negatives)">
                    <span class="error-icon">●</span>
                    <span class="error-label">Missing GT</span>
                    <span class="error-count">${result.nMissingGt} missed</span>
                    <span class="error-pct">${(result.missingGtFrac * 100).toFixed(1)}%</span>
                </div>
                <div class="eval-error-item missing-pred" title="Hallucinated: Predicted segments that have no matching GT (false positives)">
                    <span class="error-icon">●</span>
                    <span class="error-label">Hallucinated</span>
                    <span class="error-count">${result.nMissingPred} spurious</span>
                    <span class="error-pct">${(result.missingPredFrac * 100).toFixed(1)}%</span>
                </div>
            `;
        }

        // Log full summary to console
        console.log(summarizeMetrics(result));
    }

    /**
     * Set the visualization mode.
     * @private
     */
    _setVisualizationMode(mode) {
        const result = this.evaluationManager.getMetrics();
        if (!result) {
            console.warn('No metrics to visualize');
            return;
        }

        // Create visualization instance if needed
        if (!this.visualizations[mode]) {
            this.visualizations[mode] = this._createVisualization(mode);
        }

        this.currentVisualization = this.visualizations[mode];

        if (this.currentVisualization) {
            this.currentVisualization.apply(result);
            this._updateColorLegend(this.currentVisualization.getColorLegend());
        }
    }

    /**
     * Create a visualization instance.
     * @private
     */
    _createVisualization(mode) {
        switch (mode) {
            case 'gt':
                return new GTVisualization(this.meshView, this.evaluationManager);
            case 'pred':
                return new PredVisualization(this.meshView, this.evaluationManager);
            case 'matched':
                return new MatchedVisualization(this.meshView, this.evaluationManager);
            case 'overseg':
                return new OverSegVisualization(this.meshView, this.evaluationManager);
            case 'underseg':
                return new UnderSegVisualization(this.meshView, this.evaluationManager);
            case 'missingGt':
                return new MissingGTVisualization(this.meshView, this.evaluationManager);
            case 'missingPred':
                return new MissingPredVisualization(this.meshView, this.evaluationManager);
            case 'all':
            default:
                return new AllErrorsVisualization(this.meshView, this.evaluationManager);
        }
    }

    /**
     * Update the color legend display.
     * @private
     */
    _updateColorLegend(legendEntries) {
        if (!this.colorLegend) return;

        this.colorLegend.innerHTML = legendEntries.map(entry => {
            const colorHex = '#' + entry.color.getHexString();
            return `
                <div class="legend-item">
                    <span class="legend-color" style="background-color: ${colorHex}"></span>
                    <span class="legend-label">${entry.label}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Clear the color legend.
     * @private
     */
    _clearColorLegend() {
        if (this.colorLegend) {
            this.colorLegend.innerHTML = '';
        }
    }

    /**
     * Called when panel is shown.
     */
    onShow() {
        // Refresh state display
        const state = this.evaluationManager.getSummary();
        
        // Update GT status
        this._onGtChanged({
            isSet: state.hasGroundTruth,
            description: state.groundTruthDescription
        });
        
        // Update Pred status
        this._onPredChanged({
            isSet: state.hasPrediction,
            description: state.predictionDescription
        });
        
        // Update metrics display if available
        const metrics = this.evaluationManager.getMetrics();
        if (metrics) {
            this._displayMetrics(metrics);
        } else {
            // Clear results display
            if (this.resultsContainer) {
                this.resultsContainer.innerHTML = '<p class="text-gray-400 italic">Compute metrics to see results</p>';
            }
            if (this.errorBreakdown) {
                this.errorBreakdown.innerHTML = '';
            }
            this._clearColorLegend();
        }
    }

    /**
     * Called when panel is hidden / mode switches away.
     */
    onHide() {
        // Disable dual view if enabled
        if (this.dualViewManager?.isEnabled()) {
            this.dualViewManager.disable();
            if (this.dualViewEnabled) {
                this.dualViewEnabled.checked = false;
            }
            this.dualViewToggle?.classList.remove('active');
            this.dualViewControls?.classList.remove('visible');
        }
        
        // Exit evaluation mode to restore normal view
        this.evaluationManager.exitEvaluationMode();
    }

    /**
     * Reset the panel state.
     */
    reset() {
        // Disable dual view if enabled
        if (this.dualViewManager?.isEnabled()) {
            this.dualViewManager.disable();
        }
        if (this.dualViewEnabled) {
            this.dualViewEnabled.checked = false;
        }
        this.dualViewToggle?.classList.remove('active');
        this.dualViewControls?.classList.remove('visible');
        
        this.evaluationManager.clearGroundTruth();
        this.evaluationManager.clearPrediction();
        this.evaluationManager.exitEvaluationMode();
        this.visualizations = {};
        this.currentVisualization = null;
    }
}
