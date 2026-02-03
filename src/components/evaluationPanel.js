/**
 * EvaluationPanel - UI component for evaluation mode.
 * 
 * Provides controls for:
 * - Viewing/clearing GT and Prediction labels
 * - Adjusting metric thresholds (IoU, overseg, underseg)
 * - Computing and displaying metrics
 * - Selecting visualization modes
 * 
 * @module EvaluationPanel
 */

import { summarizeMetrics } from '../evaluation/MetricsComputer.js';
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
     * @param {MeshObject} meshObject - The mesh object
     * @param {EvaluationManager} evaluationManager - The evaluation manager
     */
    constructor(meshObject, evaluationManager) {
        this.meshObject = meshObject;
        this.evaluationManager = evaluationManager;

        // Default threshold values
        this.iouThreshold = 0.5;
        this.oversegThreshold = 0.1;
        this.undersegThreshold = 0.1;

        // Current visualization instance
        this.currentVisualization = null;

        // Cache visualization instances
        this.visualizations = {};

        // Initialize UI
        this._initializeUI();
        this._setupEventListeners();
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

        // Update initial slider values
        this._updateSliderDisplays();
    }

    /**
     * Setup event listeners.
     * @private
     */
    _setupEventListeners() {
        // Listen to evaluation manager state changes
        this.evaluationManager.addListener((state) => this._onEvaluationStateChange(state));

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
     * Handle evaluation state changes.
     * @private
     */
    _onEvaluationStateChange(state) {
        // Update GT/Pred status
        if (this.gtStatusEl) {
            if (state.groundTruth) {
                this.gtStatusEl.textContent = state.groundTruth.description;
                this.gtStatusEl.classList.remove('text-gray-400');
                this.gtStatusEl.classList.add('text-green-600');
            } else {
                this.gtStatusEl.textContent = 'Not set';
                this.gtStatusEl.classList.remove('text-green-600');
                this.gtStatusEl.classList.add('text-gray-400');
            }
        }

        if (this.predStatusEl) {
            if (state.prediction) {
                this.predStatusEl.textContent = state.prediction.description;
                this.predStatusEl.classList.remove('text-gray-400');
                this.predStatusEl.classList.add('text-purple-600');
            } else {
                this.predStatusEl.textContent = 'Not set';
                this.predStatusEl.classList.remove('text-purple-600');
                this.predStatusEl.classList.add('text-gray-400');
            }
        }

        // Update compute button state
        if (this.computeBtn) {
            this.computeBtn.disabled = !this.evaluationManager.canComputeMetrics();
        }

        // If metrics were invalidated, clear results
        if (!state.metricsResult && this.resultsContainer) {
            this.resultsContainer.innerHTML = '<p class="text-gray-400 italic">Compute metrics to see results</p>';
            this.errorBreakdown.innerHTML = '';
            this._clearColorLegend();
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
            
            // Apply default visualization
            const selectedMode = document.querySelector('input[name="evalVizMode"]:checked')?.value || 'all';
            this._setVisualizationMode(selectedMode);
        }
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
                return new GTVisualization(this.meshObject, this.evaluationManager);
            case 'pred':
                return new PredVisualization(this.meshObject, this.evaluationManager);
            case 'matched':
                return new MatchedVisualization(this.meshObject, this.evaluationManager);
            case 'overseg':
                return new OverSegVisualization(this.meshObject, this.evaluationManager);
            case 'underseg':
                return new UnderSegVisualization(this.meshObject, this.evaluationManager);
            case 'missingGt':
                return new MissingGTVisualization(this.meshObject, this.evaluationManager);
            case 'missingPred':
                return new MissingPredVisualization(this.meshObject, this.evaluationManager);
            case 'all':
            default:
                return new AllErrorsVisualization(this.meshObject, this.evaluationManager);
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
        this._onEvaluationStateChange({
            groundTruth: state.hasGroundTruth ? { 
                stateIndex: state.groundTruthIndex,
                description: `State #${state.groundTruthIndex}`
            } : null,
            prediction: state.hasPrediction ? {
                stateIndex: state.predictionIndex,
                description: `State #${state.predictionIndex}`
            } : null,
            metricsResult: this.evaluationManager.getMetrics()
        });
    }

    /**
     * Called when panel is hidden / mode switches away.
     */
    onHide() {
        // Exit evaluation mode to restore normal view
        this.evaluationManager.exitEvaluationMode();
    }

    /**
     * Reset the panel state.
     */
    reset() {
        this.evaluationManager.clearGroundTruth();
        this.evaluationManager.clearPrediction();
        this.evaluationManager.exitEvaluationMode();
        this.visualizations = {};
        this.currentVisualization = null;
    }
}
