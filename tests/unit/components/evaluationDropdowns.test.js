/**
 * @fileoverview Unit tests for EvaluationPanel dropdown annotation selection.
 *
 * Tests the dropdown population and selection logic for GT/Pred annotation
 * pickers in the evaluation panel.
 *
 * @see src/components/evaluationPanel.js
 */

import { eventBus, Events } from '../../../src/utils/EventBus.js';

// Minimal mock of AnnotationLibrary
function createMockLibrary(annotations = []) {
    const lib = {
        _annotations: new Map(annotations.map(a => [a.id, a])),
        groundTruthId: null,
        predictionId: null,
        getAllSorted() {
            return [...this._annotations.values()].sort(
                (a, b) => (b.metadata?.modifiedAt || 0) - (a.metadata?.modifiedAt || 0)
            );
        },
        load(id) {
            const ann = this._annotations.get(id);
            return ann ? { ...ann } : null;
        },
        setAsGroundTruth(id) { this.groundTruthId = id; },
        setAsPrediction(id) { this.predictionId = id; },
    };
    return lib;
}

// Minimal mock of EvaluationManager
function createMockEvalManager() {
    return {
        groundTruth: null,
        prediction: null,
        setGroundTruth(ann) { this.groundTruth = ann; },
        setPrediction(ann) { this.prediction = ann; },
        clearGroundTruth() { this.groundTruth = null; },
        clearPrediction() { this.prediction = null; },
        canComputeMetrics() { return this.groundTruth != null && this.prediction != null; },
        getSummary() {
            return {
                hasGroundTruth: this.groundTruth != null,
                hasPrediction: this.prediction != null,
                groundTruthDescription: this.groundTruth?.name || '',
                predictionDescription: this.prediction?.name || '',
            };
        },
        getMetrics() { return null; },
    };
}

describe('EvaluationPanel Dropdown Logic', () => {
    let library, evalManager;
    const annotations = [
        { id: 'a1', name: 'Manual Annotation', source: 'manual', metadata: { modifiedAt: 1000 } },
        { id: 'a2', name: 'Model Prediction', source: 'model', metadata: { modifiedAt: 2000 } },
        { id: 'a3', name: 'Cloud Annotation', source: 'cloud', metadata: { modifiedAt: 3000 } },
    ];

    beforeEach(() => {
        eventBus.clear();
        library = createMockLibrary(annotations);
        evalManager = createMockEvalManager();
    });

    afterEach(() => {
        eventBus.clear();
    });

    describe('Dropdown population', () => {
        test('should build option list from library annotations', () => {
            const sorted = library.getAllSorted();
            expect(sorted).toHaveLength(3);
            // Sorted by modifiedAt desc
            expect(sorted[0].id).toBe('a3');
            expect(sorted[1].id).toBe('a2');
            expect(sorted[2].id).toBe('a1');
        });

        test('should include source prefix for model annotations', () => {
            const ann = library.load('a2');
            expect(ann.source).toBe('model');
        });

        test('should mark currently selected GT/Pred', () => {
            library.setAsGroundTruth('a1');
            library.setAsPrediction('a2');
            expect(library.groundTruthId).toBe('a1');
            expect(library.predictionId).toBe('a2');
        });
    });

    describe('Dropdown selection flow', () => {
        test('selecting GT annotation should update library and evalManager', () => {
            const annotation = library.load('a1');
            library.setAsGroundTruth('a1');
            evalManager.setGroundTruth(annotation);

            expect(library.groundTruthId).toBe('a1');
            expect(evalManager.groundTruth.name).toBe('Manual Annotation');
        });

        test('selecting Pred annotation should update library and evalManager', () => {
            const annotation = library.load('a2');
            library.setAsPrediction('a2');
            evalManager.setPrediction(annotation);

            expect(library.predictionId).toBe('a2');
            expect(evalManager.prediction.name).toBe('Model Prediction');
        });

        test('clearing GT should reset both library and evalManager', () => {
            library.setAsGroundTruth('a1');
            evalManager.setGroundTruth(library.load('a1'));

            // Clear
            library.groundTruthId = null;
            evalManager.clearGroundTruth();

            expect(library.groundTruthId).toBeNull();
            expect(evalManager.groundTruth).toBeNull();
        });

        test('canComputeMetrics requires both GT and Pred', () => {
            expect(evalManager.canComputeMetrics()).toBe(false);

            evalManager.setGroundTruth(library.load('a1'));
            expect(evalManager.canComputeMetrics()).toBe(false);

            evalManager.setPrediction(library.load('a2'));
            expect(evalManager.canComputeMetrics()).toBe(true);
        });

        test('setting same annotation as both GT and Pred is allowed', () => {
            const ann = library.load('a1');
            library.setAsGroundTruth('a1');
            library.setAsPrediction('a1');
            evalManager.setGroundTruth(ann);
            evalManager.setPrediction(ann);

            expect(evalManager.canComputeMetrics()).toBe(true);
            expect(library.groundTruthId).toBe('a1');
            expect(library.predictionId).toBe('a1');
        });
    });

    describe('Event integration', () => {
        test('LIBRARY_CHANGED should trigger dropdown refresh', () => {
            const handler = jest.fn();
            eventBus.on(Events.LIBRARY_CHANGED, handler, 'test');

            eventBus.emit(Events.LIBRARY_CHANGED, { action: 'save' });
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('EVALUATION_GT_CHANGED should fire when GT is set', () => {
            const handler = jest.fn();
            eventBus.on(Events.EVALUATION_GT_CHANGED, handler, 'test');

            eventBus.emit(Events.EVALUATION_GT_CHANGED, {
                isSet: true,
                description: 'Manual Annotation'
            });

            expect(handler).toHaveBeenCalledWith({
                isSet: true,
                description: 'Manual Annotation'
            });
        });
    });
});
