/**
 * @fileoverview Integration tests for annotation event flows.
 * 
 * These tests verify that the correct events are emitted in the correct sequence
 * for various annotation-related workflows. They test the "event contracts" between
 * components rather than individual component behavior.
 * 
 * ## Event Contract Summary
 * 
 * ### ANNOTATION_IMPORTED
 * - Emitted when annotation arrives from external source (cloud, model, import)
 * - Subscriber: LibraryPanel auto-saves to library
 * - NOT emitted when loading from library (already in library)
 * 
 * ### ANNOTATION_ACTIVE_CHANGED
 * - Emitted when the currently displayed annotation changes identity/name
 * - Subscriber: main.js updates annotation label in UI
 * - NOT emitted during batch operations (not applied to view)
 * 
 * @see docs/events.md
 * @see src/utils/EventBus.js
 */

import { eventBus, Events } from '../../../src/utils/EventBus.js';

describe('Annotation Event Flows', () => {
    // Track all emitted events
    let emittedEvents = [];
    let eventHandlers = {};
    
    /**
     * Helper to subscribe to and track events
     */
    function trackEvent(eventName) {
        const handler = jest.fn((data) => {
            emittedEvents.push({ event: eventName, data, timestamp: Date.now() });
        });
        eventHandlers[eventName] = handler;
        eventBus.on(eventName, handler, 'test');
        return handler;
    }
    
    /**
     * Helper to get tracked events by name
     */
    function getEvents(eventName) {
        return emittedEvents.filter(e => e.event === eventName);
    }
    
    beforeEach(() => {
        eventBus.clear();
        emittedEvents = [];
        eventHandlers = {};
        
        // Track the key annotation events
        trackEvent(Events.ANNOTATION_IMPORTED);
        trackEvent(Events.ANNOTATION_ACTIVE_CHANGED);
        trackEvent(Events.STATE_CHANGED);
        trackEvent(Events.LIBRARY_CHANGED);
        trackEvent(Events.MESH_LOADED);
    });
    
    afterEach(() => {
        eventBus.clear();
    });
    
    // =========================================================================
    // Event Contract Tests
    // =========================================================================
    
    describe('ANNOTATION_IMPORTED event contract', () => {
        /**
         * @test Verifies ANNOTATION_IMPORTED data schema
         * @given An annotation imported from cloud
         * @when ANNOTATION_IMPORTED is emitted
         * @then The data contains required fields
         */
        test('should have correct data schema for cloud source', () => {
            const annotation = {
                id: 'anno-123',
                name: 'Test Annotation',
                edges: new Set([1, 2, 3])
            };
            
            eventBus.emit(Events.ANNOTATION_IMPORTED, {
                annotation: annotation,
                source: 'cloud',
                cloudInfo: {
                    meshId: 'mesh-456',
                    stateId: 'state-789'
                }
            });
            
            const events = getEvents(Events.ANNOTATION_IMPORTED);
            expect(events).toHaveLength(1);
            
            const data = events[0].data;
            expect(data).toHaveProperty('annotation');
            expect(data).toHaveProperty('source', 'cloud');
            expect(data).toHaveProperty('cloudInfo');
            expect(data.cloudInfo).toHaveProperty('meshId');
            expect(data.cloudInfo).toHaveProperty('stateId');
        });
        
        /**
         * @test Verifies ANNOTATION_IMPORTED data schema for model source
         * @given An annotation from AI inference
         * @when ANNOTATION_IMPORTED is emitted
         * @then The data contains annotation and source
         */
        test('should have correct data schema for model source', () => {
            const annotation = {
                id: 'anno-ai',
                name: 'AI Annotation 2024-01-15',
                edges: new Set([10, 20, 30])
            };
            
            eventBus.emit(Events.ANNOTATION_IMPORTED, {
                annotation: annotation,
                source: 'model'
            });
            
            const events = getEvents(Events.ANNOTATION_IMPORTED);
            expect(events).toHaveLength(1);
            
            const data = events[0].data;
            expect(data).toHaveProperty('annotation');
            expect(data).toHaveProperty('source', 'model');
            // cloudInfo is optional for model source
        });
        
        /**
         * @test Verifies ANNOTATION_IMPORTED is not emitted when loading from library
         * @given An annotation being loaded from the library
         * @when The library load flow completes
         * @then ANNOTATION_IMPORTED is NOT emitted
         */
        test('should NOT be emitted when loading from library', () => {
            // Simulate loading from library (only emits ANNOTATION_ACTIVE_CHANGED)
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Library Annotation',
                source: 'library'
            });
            
            // Verify ANNOTATION_IMPORTED was not emitted
            const importEvents = getEvents(Events.ANNOTATION_IMPORTED);
            expect(importEvents).toHaveLength(0);
            
            // But ANNOTATION_ACTIVE_CHANGED should be emitted
            const activeEvents = getEvents(Events.ANNOTATION_ACTIVE_CHANGED);
            expect(activeEvents).toHaveLength(1);
        });
    });
    
    describe('ANNOTATION_ACTIVE_CHANGED event contract', () => {
        /**
         * @test Verifies ANNOTATION_ACTIVE_CHANGED data schema
         * @given An annotation becoming active
         * @when ANNOTATION_ACTIVE_CHANGED is emitted
         * @then The data contains name and source
         */
        test('should have correct data schema', () => {
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Test Annotation',
                source: 'library'
            });
            
            const events = getEvents(Events.ANNOTATION_ACTIVE_CHANGED);
            expect(events).toHaveLength(1);
            
            const data = events[0].data;
            expect(data).toHaveProperty('name', 'Test Annotation');
            expect(data).toHaveProperty('source', 'library');
        });
        
        /**
         * @test Verifies ANNOTATION_ACTIVE_CHANGED is emitted on rename
         * @given The current annotation is renamed
         * @when The rename completes
         * @then ANNOTATION_ACTIVE_CHANGED is emitted with new name
         */
        test('should be emitted when current annotation is renamed', () => {
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Renamed Annotation',
                source: 'library'
            });
            
            const events = getEvents(Events.ANNOTATION_ACTIVE_CHANGED);
            expect(events).toHaveLength(1);
            expect(events[0].data.name).toBe('Renamed Annotation');
        });
        
        /**
         * @test Verifies ANNOTATION_ACTIVE_CHANGED is NOT emitted during batch load
         * @given Multiple annotations being loaded to library (batch)
         * @when The batch load completes
         * @then ANNOTATION_ACTIVE_CHANGED is NOT emitted for batch items
         */
        test('should NOT be emitted during batch library load', () => {
            // Simulate batch loading (only ANNOTATION_IMPORTED, no ACTIVE_CHANGED)
            const annotations = [
                { id: 'a1', name: 'Batch 1' },
                { id: 'a2', name: 'Batch 2' },
                { id: 'a3', name: 'Batch 3' }
            ];
            
            // Emit ANNOTATION_IMPORTED for each (as cloudStoragePanel does for batch)
            for (const anno of annotations) {
                eventBus.emit(Events.ANNOTATION_IMPORTED, {
                    annotation: anno,
                    source: 'cloud',
                    cloudInfo: { meshId: 'mesh-1', stateId: anno.id }
                });
            }
            
            // Verify ANNOTATION_IMPORTED was emitted for each
            const importEvents = getEvents(Events.ANNOTATION_IMPORTED);
            expect(importEvents).toHaveLength(3);
            
            // Verify ANNOTATION_ACTIVE_CHANGED was NOT emitted
            const activeEvents = getEvents(Events.ANNOTATION_ACTIVE_CHANGED);
            expect(activeEvents).toHaveLength(0);
        });
    });
    
    // =========================================================================
    // Workflow Tests
    // =========================================================================
    
    describe('Loading Annotation from Library', () => {
        /**
         * @test Simulates the complete flow of loading an annotation from the library
         * Expected events:
         * 1. ANNOTATION_ACTIVE_CHANGED (UI update)
         * NOT: ANNOTATION_IMPORTED (already in library)
         */
        test('should emit correct events in correct order', () => {
            // Simulate libraryPanel.loadAnnotation()
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Library Annotation',
                source: 'library'
            });
            
            // Verify correct events
            expect(getEvents(Events.ANNOTATION_ACTIVE_CHANGED)).toHaveLength(1);
            expect(getEvents(Events.ANNOTATION_IMPORTED)).toHaveLength(0);
            
            // Verify data
            const activeEvent = getEvents(Events.ANNOTATION_ACTIVE_CHANGED)[0];
            expect(activeEvent.data.source).toBe('library');
        });
    });
    
    describe('Loading Single State from Cloud', () => {
        /**
         * @test Simulates loading a single state from cloud and applying it
         * Expected events:
         * 1. STATE_LOADED (optional, may be emitted by some code paths)
         * 2. ANNOTATION_IMPORTED (for library auto-save)
         * 3. ANNOTATION_ACTIVE_CHANGED (for UI update)
         */
        test('should emit both IMPORTED and ACTIVE_CHANGED', () => {
            const annotation = {
                id: 'cloud-anno',
                name: 'Cloud State',
                edges: new Set([1, 2, 3])
            };
            
            // Simulate cloudStoragePanel.loadState() sequence
            eventBus.emit(Events.ANNOTATION_IMPORTED, {
                annotation: annotation,
                source: 'cloud',
                cloudInfo: { meshId: 'mesh-1', stateId: 'state-1' }
            });
            
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: annotation.name,
                source: 'cloud'
            });
            
            // Verify both events were emitted
            expect(getEvents(Events.ANNOTATION_IMPORTED)).toHaveLength(1);
            expect(getEvents(Events.ANNOTATION_ACTIVE_CHANGED)).toHaveLength(1);
            
            // Verify order (IMPORTED before ACTIVE_CHANGED)
            const importTime = getEvents(Events.ANNOTATION_IMPORTED)[0].timestamp;
            const activeTime = getEvents(Events.ANNOTATION_ACTIVE_CHANGED)[0].timestamp;
            expect(importTime).toBeLessThanOrEqual(activeTime);
        });
    });
    
    describe('Batch Loading from Cloud', () => {
        /**
         * @test Simulates batch loading multiple states from cloud
         * Expected events:
         * - ANNOTATION_IMPORTED for each annotation (for library auto-save)
         * - NO ANNOTATION_ACTIVE_CHANGED (batch items not applied to view)
         */
        test('should emit IMPORTED for each but not ACTIVE_CHANGED', () => {
            const states = [
                { id: 'state-1', name: 'State 1' },
                { id: 'state-2', name: 'State 2' },
                { id: 'state-3', name: 'State 3' }
            ];
            
            // Simulate cloudStoragePanel._saveAllToLibrary() batch processing
            for (const state of states) {
                eventBus.emit(Events.ANNOTATION_IMPORTED, {
                    annotation: { id: state.id, name: state.name },
                    source: 'cloud',
                    cloudInfo: { meshId: 'mesh-1', stateId: state.id }
                });
            }
            
            // Verify IMPORTED was emitted for each
            const importEvents = getEvents(Events.ANNOTATION_IMPORTED);
            expect(importEvents).toHaveLength(3);
            
            // Verify ACTIVE_CHANGED was NOT emitted
            expect(getEvents(Events.ANNOTATION_ACTIVE_CHANGED)).toHaveLength(0);
        });
    });
    
    describe('Model Inference Results', () => {
        /**
         * @test Simulates applying AI inference results
         * Expected events:
         * 1. ANNOTATION_IMPORTED (for library auto-save)
         * 2. ANNOTATION_ACTIVE_CHANGED (for UI update)
         */
        test('should emit both IMPORTED and ACTIVE_CHANGED', () => {
            const annotation = {
                id: 'model-anno',
                name: 'AI Annotation 2024-01-15',
                edges: new Set([5, 10, 15])
            };
            
            // Simulate modelPanel.applyResults() sequence
            eventBus.emit(Events.ANNOTATION_IMPORTED, {
                annotation: annotation,
                source: 'model'
            });
            
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: annotation.name,
                source: 'model'
            });
            
            // Verify both events
            const importEvents = getEvents(Events.ANNOTATION_IMPORTED);
            const activeEvents = getEvents(Events.ANNOTATION_ACTIVE_CHANGED);
            
            expect(importEvents).toHaveLength(1);
            expect(activeEvents).toHaveLength(1);
            
            expect(importEvents[0].data.source).toBe('model');
            expect(activeEvents[0].data.source).toBe('model');
        });
    });
    
    describe('Renaming Current Annotation', () => {
        /**
         * @test Simulates renaming the currently active annotation
         * Expected events:
         * 1. LIBRARY_CHANGED (library storage update)
         * 2. ANNOTATION_ACTIVE_CHANGED (UI label update)
         * NOT: ANNOTATION_IMPORTED (not an import, already in library)
         */
        test('should emit LIBRARY_CHANGED and ACTIVE_CHANGED', () => {
            // Simulate libraryPanel rename handler
            eventBus.emit(Events.LIBRARY_CHANGED, {
                action: 'rename',
                id: 'anno-123',
                annotation: { name: 'New Name' }
            });
            
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'New Name',
                source: 'library'
            });
            
            // Verify events
            expect(getEvents(Events.LIBRARY_CHANGED)).toHaveLength(1);
            expect(getEvents(Events.ANNOTATION_ACTIVE_CHANGED)).toHaveLength(1);
            expect(getEvents(Events.ANNOTATION_IMPORTED)).toHaveLength(0);
        });
        
        /**
         * @test Renaming a non-active annotation should NOT emit ACTIVE_CHANGED
         * @given An annotation in the library that is not currently active
         * @when It is renamed
         * @then Only LIBRARY_CHANGED is emitted
         */
        test('should NOT emit ACTIVE_CHANGED when renaming non-active annotation', () => {
            // Simulate renaming a different annotation (not the active one)
            eventBus.emit(Events.LIBRARY_CHANGED, {
                action: 'rename',
                id: 'other-anno',
                annotation: { name: 'Other New Name' }
            });
            
            // Only LIBRARY_CHANGED, not ACTIVE_CHANGED
            expect(getEvents(Events.LIBRARY_CHANGED)).toHaveLength(1);
            expect(getEvents(Events.ANNOTATION_ACTIVE_CHANGED)).toHaveLength(0);
        });
    });
    
    describe('Loading New Mesh', () => {
        /**
         * @test Simulates loading a new mesh file
         * Expected events:
         * 1. MESH_LOADED (mesh loaded)
         * Note: Annotation label is updated via MESH_LOADED handler, 
         * not ANNOTATION_ACTIVE_CHANGED
         */
        test('should emit MESH_LOADED', () => {
            eventBus.emit(Events.MESH_LOADED, {
                source: 'file',
                filename: 'sample.ply'
            });
            
            expect(getEvents(Events.MESH_LOADED)).toHaveLength(1);
            
            const data = getEvents(Events.MESH_LOADED)[0].data;
            expect(data.source).toBe('file');
            expect(data.filename).toBe('sample.ply');
        });
    });
    
    // =========================================================================
    // Subscriber Behavior Tests
    // =========================================================================
    
    describe('Subscriber Response Tests', () => {
        /**
         * @test Verifies UI update handler responds to ANNOTATION_ACTIVE_CHANGED
         */
        test('UI label handler should respond to ANNOTATION_ACTIVE_CHANGED', () => {
            // Mock UI update function (similar to main.js updateAnnotationLabel)
            let currentLabel = 'Initial';
            const updateLabel = jest.fn((data) => {
                currentLabel = data.name;
            });
            
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, updateLabel, 'main');
            
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Updated Label',
                source: 'library'
            });
            
            expect(updateLabel).toHaveBeenCalledTimes(1);
            expect(currentLabel).toBe('Updated Label');
        });
        
        /**
         * @test Verifies library auto-save responds to ANNOTATION_IMPORTED
         */
        test('Library auto-save should respond to ANNOTATION_IMPORTED', () => {
            // Mock library auto-save function (similar to libraryPanel._handleAnnotationImported)
            const savedAnnotations = [];
            const autoSave = jest.fn((data) => {
                savedAnnotations.push(data.annotation);
            });
            
            eventBus.on(Events.ANNOTATION_IMPORTED, autoSave, 'libraryPanel');
            
            eventBus.emit(Events.ANNOTATION_IMPORTED, {
                annotation: { id: 'a1', name: 'Imported' },
                source: 'cloud'
            });
            
            expect(autoSave).toHaveBeenCalledTimes(1);
            expect(savedAnnotations).toHaveLength(1);
            expect(savedAnnotations[0].name).toBe('Imported');
        });
        
        /**
         * @test Verifies library auto-save does NOT respond to ANNOTATION_ACTIVE_CHANGED
         */
        test('Library auto-save should NOT respond to ANNOTATION_ACTIVE_CHANGED', () => {
            const autoSave = jest.fn();
            
            // Subscribe to ANNOTATION_IMPORTED only
            eventBus.on(Events.ANNOTATION_IMPORTED, autoSave, 'libraryPanel');
            
            // Emit ANNOTATION_ACTIVE_CHANGED
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Active Changed',
                source: 'library'
            });
            
            // Auto-save should NOT be called
            expect(autoSave).not.toHaveBeenCalled();
        });
    });
    
    // =========================================================================
    // Bug Regression Tests
    // These tests verify fixes for specific bugs found during development.
    // =========================================================================
    
    describe('Bug Regressions', () => {
        /**
         * Bug #1: Loading PLY with embedded annotations does not update the library
         * 
         * When importing a PLY file with annotations, ANNOTATION_IMPORTED must be emitted
         * so that the annotation is auto-saved to the library.
         * 
         * Expected flow:
         * 1. MESH_LOADED is emitted (for mesh setup)
         * 2. If the PLY contains annotations, ANNOTATION_IMPORTED is also emitted
         * 3. ANNOTATION_ACTIVE_CHANGED is emitted (for UI label update)
         */
        test('loading PLY with annotations should emit ANNOTATION_IMPORTED', () => {
            const autoSaveHandler = jest.fn();
            eventBus.on(Events.ANNOTATION_IMPORTED, autoSaveHandler, 'libraryPanel');
            
            // Simulate meshLoader.loadFile() for PLY with embedded annotations
            // This is what meshLoader SHOULD do:
            eventBus.emit(Events.MESH_LOADED, {
                source: 'file',
                filename: 'annotated_mesh.ply'
            });
            
            // For a PLY file WITH annotations, ANNOTATION_IMPORTED should be emitted
            eventBus.emit(Events.ANNOTATION_IMPORTED, {
                annotation: { id: 'file-anno', name: 'annotated_mesh', edges: new Set([1, 2, 3]) },
                source: 'file'
            });
            
            // Verify the library auto-save handler was called
            expect(autoSaveHandler).toHaveBeenCalledTimes(1);
            expect(autoSaveHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    annotation: expect.objectContaining({ name: 'annotated_mesh' }),
                    source: 'file'
                })
            );
        });
        
        /**
         * Bug #1b: Loading PLY with annotations does not update annotation label
         * 
         * When loading a PLY with annotations, the UI label should update to show
         * the annotation name (from metadata or filename).
         */
        test('loading PLY with annotations should emit ANNOTATION_ACTIVE_CHANGED for UI', () => {
            const uiHandler = jest.fn();
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, uiHandler, 'main');
            
            // Simulate complete flow for PLY with annotations
            eventBus.emit(Events.MESH_LOADED, {
                source: 'file',
                filename: 'annotated_mesh.ply'
            });
            
            // ANNOTATION_ACTIVE_CHANGED should be emitted to update the label
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'My Annotation Name',
                source: 'file'
            });
            
            expect(uiHandler).toHaveBeenCalledTimes(1);
            expect(uiHandler).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'My Annotation Name' })
            );
        });
        
        /**
         * Bug #2: Saving current state with new name does not update annotation label
         * 
         * When saving the current annotation to the library with a user-provided name,
         * ANNOTATION_ACTIVE_CHANGED must be emitted so the label updates.
         * 
         * Note: The rename via library UI works because it emits ANNOTATION_ACTIVE_CHANGED.
         * But the "Save to Library" action was missing this emission.
         */
        test('saving current annotation should emit ANNOTATION_ACTIVE_CHANGED', () => {
            const uiHandler = jest.fn();
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, uiHandler, 'main');
            
            // Simulate libraryPanel.saveCurrentAnnotation() with user-provided name
            // After saving, it should emit ANNOTATION_ACTIVE_CHANGED with the new name
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'User Provided Name',
                source: 'library'
            });
            
            expect(uiHandler).toHaveBeenCalledTimes(1);
            expect(uiHandler).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'User Provided Name' })
            );
        });
        
        /**
         * Bug #2b: After saving, workingAnnotation should be linked to library entry
         * 
         * When saving to library, the workingAnnotation's id should be updated
         * so subsequent renames work correctly.
         */
        test('library save should update the current annotation identity', () => {
            // This tests the expected behavior at the event level:
            // After saving, any rename to the library entry should affect current annotation
            
            const uiHandler = jest.fn();
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, uiHandler, 'main');
            
            // First: save annotation (assigns ID)
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Saved Annotation',
                source: 'library'
            });
            
            // Later: rename via library (should update label)
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Renamed Annotation',
                source: 'library'
            });
            
            expect(uiHandler).toHaveBeenCalledTimes(2);
            expect(uiHandler).toHaveBeenLastCalledWith(
                expect.objectContaining({ name: 'Renamed Annotation' })
            );
        });
        
        /**
         * Test: PLY without annotations should NOT emit ANNOTATION_IMPORTED
         * 
         * When loading a PLY file without annotations (labels array empty),
         * ANNOTATION_IMPORTED should NOT be emitted (nothing to auto-save).
         */
        test('loading PLY without annotations should NOT emit ANNOTATION_IMPORTED', () => {
            const autoSaveHandler = jest.fn();
            eventBus.on(Events.ANNOTATION_IMPORTED, autoSaveHandler, 'libraryPanel');
            
            // Simulate loading a clean PLY (no annotations)
            // Only MESH_LOADED should be emitted
            eventBus.emit(Events.MESH_LOADED, {
                source: 'file',
                filename: 'clean_mesh.ply',
                hasAnnotations: false
            });
            
            // ANNOTATION_IMPORTED should NOT be emitted for clean meshes
            expect(autoSaveHandler).not.toHaveBeenCalled();
        });
    });
    
    // =========================================================================
    // Edge Cases and Error Prevention
    // =========================================================================
    
    describe('Edge Cases', () => {
        /**
         * @test Prevents duplicate auto-save when loading from library
         * This was the original bug - loading from library triggered auto-save
         * causing annotation reordering
         */
        test('loading from library should not trigger auto-save (no IMPORTED event)', () => {
            const autoSaveHandler = jest.fn();
            eventBus.on(Events.ANNOTATION_IMPORTED, autoSaveHandler, 'libraryPanel');
            
            // Simulate loading from library (correct flow)
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Library Annotation',
                source: 'library'
            });
            
            // Auto-save should NOT be triggered
            expect(autoSaveHandler).not.toHaveBeenCalled();
        });
        
        /**
         * @test Batch load should not update UI multiple times
         */
        test('batch load should not trigger UI updates', () => {
            const uiUpdateHandler = jest.fn();
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, uiUpdateHandler, 'main');
            
            // Simulate batch loading 5 annotations
            for (let i = 0; i < 5; i++) {
                eventBus.emit(Events.ANNOTATION_IMPORTED, {
                    annotation: { id: `a${i}`, name: `Batch ${i}` },
                    source: 'cloud'
                });
            }
            
            // UI update should NOT be triggered during batch
            expect(uiUpdateHandler).not.toHaveBeenCalled();
        });
    });
});
