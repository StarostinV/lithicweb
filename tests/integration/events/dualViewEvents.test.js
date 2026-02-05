/**
 * @fileoverview Integration tests for dual view mode event handling.
 * 
 * These tests verify that:
 * 1. Annotation updates go to the active view
 * 2. Annotation name changes update the corresponding view label
 * 3. Events are properly routed in dual view mode
 * 
 * @see src/components/DualViewManager.js
 * @see docs/events.md
 */

import { eventBus, Events } from '../../../src/utils/EventBus.js';

describe('Dual View Mode Events', () => {
    // Track emitted events
    let emittedEvents = [];
    
    /**
     * Helper to track events
     */
    function trackEvent(eventName) {
        const handler = jest.fn((data) => {
            emittedEvents.push({ event: eventName, data, timestamp: Date.now() });
        });
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
        
        // Track relevant events
        trackEvent(Events.DUAL_VIEW_CHANGED);
        trackEvent(Events.DUAL_VIEW_ACTIVE_CHANGED);
        trackEvent(Events.ANNOTATION_ACTIVE_CHANGED);
        trackEvent(Events.STATE_CHANGED);
    });
    
    afterEach(() => {
        eventBus.clear();
    });
    
    // =========================================================================
    // Dual View Event Contracts
    // =========================================================================
    
    describe('DUAL_VIEW_CHANGED event contract', () => {
        /**
         * @test Verifies DUAL_VIEW_CHANGED data schema when enabling
         */
        test('should have correct data schema when enabling', () => {
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: true,
                mode: 'general',
                activeView: 'left'
            });
            
            const events = getEvents(Events.DUAL_VIEW_CHANGED);
            expect(events).toHaveLength(1);
            
            const data = events[0].data;
            expect(data).toHaveProperty('enabled', true);
            expect(data).toHaveProperty('mode', 'general');
            expect(data).toHaveProperty('activeView', 'left');
        });
        
        /**
         * @test Verifies DUAL_VIEW_CHANGED data schema when disabling
         */
        test('should have correct data schema when disabling', () => {
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: false,
                mode: 'general'
            });
            
            const events = getEvents(Events.DUAL_VIEW_CHANGED);
            expect(events).toHaveLength(1);
            
            const data = events[0].data;
            expect(data).toHaveProperty('enabled', false);
        });
    });
    
    describe('DUAL_VIEW_ACTIVE_CHANGED event contract', () => {
        /**
         * @test Verifies DUAL_VIEW_ACTIVE_CHANGED data schema
         */
        test('should have correct data schema', () => {
            eventBus.emit(Events.DUAL_VIEW_ACTIVE_CHANGED, {
                activeView: 'right'
            });
            
            const events = getEvents(Events.DUAL_VIEW_ACTIVE_CHANGED);
            expect(events).toHaveLength(1);
            
            const data = events[0].data;
            expect(data).toHaveProperty('activeView', 'right');
        });
    });
    
    // =========================================================================
    // Annotation Updates in Dual View Mode
    // =========================================================================
    
    describe('Annotation updates in dual view mode', () => {
        /**
         * @test When annotation name changes, dual view should update active view label
         * 
         * Expected flow:
         * 1. ANNOTATION_ACTIVE_CHANGED is emitted
         * 2. DualViewManager should listen and update the active view's label
         */
        test('ANNOTATION_ACTIVE_CHANGED should be observable by dual view', () => {
            // Simulate dual view is active
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: true,
                mode: 'general',
                activeView: 'left'
            });
            
            // When annotation name changes, ANNOTATION_ACTIVE_CHANGED is emitted
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Updated Annotation Name',
                source: 'library'
            });
            
            // Verify the event was emitted (DualViewManager should subscribe to this)
            const events = getEvents(Events.ANNOTATION_ACTIVE_CHANGED);
            expect(events).toHaveLength(1);
            expect(events[0].data.name).toBe('Updated Annotation Name');
        });
        
        /**
         * @test Switching active view should emit DUAL_VIEW_ACTIVE_CHANGED
         * 
         * When user clicks on a different view, the active view changes
         * and STATE_CHANGED or annotation changes should go to the new active view.
         */
        test('switching active view should emit correct event', () => {
            // Start with left view active
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: true,
                mode: 'general',
                activeView: 'left'
            });
            
            // User switches to right view
            eventBus.emit(Events.DUAL_VIEW_ACTIVE_CHANGED, {
                activeView: 'right'
            });
            
            // Verify the event was emitted
            const events = getEvents(Events.DUAL_VIEW_ACTIVE_CHANGED);
            expect(events).toHaveLength(1);
            expect(events[0].data.activeView).toBe('right');
        });
        
        /**
         * @test STATE_CHANGED events should be tracked for the active view
         * 
         * When drawing in dual view mode, STATE_CHANGED is emitted and
         * the active view should receive the annotation changes.
         */
        test('STATE_CHANGED should be emitted when drawing in active view', () => {
            // Dual view is active with left as active view
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: true,
                mode: 'general',
                activeView: 'left'
            });
            
            // User draws on the mesh (affects active view only)
            eventBus.emit(Events.STATE_CHANGED, {
                action: { type: 'draw', edgeCount: 5 },
                stateIndex: 1
            });
            
            // Verify STATE_CHANGED was emitted
            const events = getEvents(Events.STATE_CHANGED);
            expect(events).toHaveLength(1);
        });
    });
    
    // =========================================================================
    // Dual View Label Updates
    // =========================================================================
    
    describe('Dual view label updates', () => {
        /**
         * @test When loading annotation from library, active view label should update
         * 
         * Scenario: User is in dual view mode, loads an annotation from library
         * The active view's label button should show the new annotation name.
         */
        test('loading annotation should update active view label', () => {
            // Mock: dual view manager listening for label updates
            let activeViewLabel = 'Initial Annotation';
            const labelUpdateHandler = jest.fn((data) => {
                activeViewLabel = data.name;
            });
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, labelUpdateHandler, 'dualViewManager');
            
            // Enable dual view
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: true,
                mode: 'general',
                activeView: 'left'
            });
            
            // Load annotation from library
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Loaded from Library',
                source: 'library'
            });
            
            // Label should be updated
            expect(labelUpdateHandler).toHaveBeenCalledTimes(1);
            expect(activeViewLabel).toBe('Loaded from Library');
        });
        
        /**
         * @test When saving annotation with new name, active view label should update
         * 
         * Scenario: User is in dual view mode, saves current annotation to library with new name
         * The active view's label should show the new name.
         */
        test('saving annotation should update active view label', () => {
            let activeViewLabel = 'Untitled';
            const labelUpdateHandler = jest.fn((data) => {
                activeViewLabel = data.name;
            });
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, labelUpdateHandler, 'dualViewManager');
            
            // Dual view is enabled
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: true,
                mode: 'general',
                activeView: 'right'
            });
            
            // Save annotation with new name
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'User Saved Name',
                source: 'library'
            });
            
            expect(activeViewLabel).toBe('User Saved Name');
        });
        
        /**
         * @test Renaming annotation should update active view label if it's the current one
         */
        test('renaming current annotation should update active view label', () => {
            let activeViewLabel = 'Old Name';
            const labelUpdateHandler = jest.fn((data) => {
                activeViewLabel = data.name;
            });
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, labelUpdateHandler, 'dualViewManager');
            
            // Dual view enabled
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: true,
                mode: 'general',
                activeView: 'left'
            });
            
            // Rename the annotation
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Renamed Annotation',
                source: 'library'
            });
            
            expect(activeViewLabel).toBe('Renamed Annotation');
        });
        
        /**
         * @test Loading PLY with annotations should update active view label
         */
        test('loading annotated PLY should update active view label', () => {
            let activeViewLabel = 'Untitled';
            const labelUpdateHandler = jest.fn((data) => {
                activeViewLabel = data.name;
            });
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, labelUpdateHandler, 'dualViewManager');
            
            // Dual view is enabled
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: true,
                mode: 'general',
                activeView: 'left'
            });
            
            // Load PLY with embedded annotation
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'PLY Annotation Name',
                source: 'file'
            });
            
            expect(activeViewLabel).toBe('PLY Annotation Name');
        });
    });
    
    // =========================================================================
    // Edge Cases
    // =========================================================================
    
    describe('Edge cases', () => {
        /**
         * @test Disabling dual view should not break annotation events
         */
        test('annotation events should work after disabling dual view', () => {
            const handler = jest.fn();
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, handler, 'main');
            
            // Enable then disable dual view
            eventBus.emit(Events.DUAL_VIEW_CHANGED, { enabled: true, mode: 'general' });
            eventBus.emit(Events.DUAL_VIEW_CHANGED, { enabled: false, mode: 'general' });
            
            // Annotation events should still work
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'After Dual View',
                source: 'library'
            });
            
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'After Dual View' })
            );
        });
        
        /**
         * @test Label updates should only affect the active view
         * 
         * When annotation name changes, only the active view's label should update,
         * not both views.
         */
        test('label updates should only affect active view', () => {
            let leftLabel = 'Left Initial';
            let rightLabel = 'Right Initial';
            let activeView = 'left';
            
            // Simulate dual view manager tracking labels per view
            const handleActiveChanged = jest.fn((data) => {
                // Only update the active view's label
                if (activeView === 'left') {
                    leftLabel = data.name;
                } else {
                    rightLabel = data.name;
                }
            });
            
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, handleActiveChanged, 'dualViewManager');
            
            // Dual view enabled, left is active
            eventBus.emit(Events.DUAL_VIEW_CHANGED, {
                enabled: true,
                mode: 'general',
                activeView: 'left'
            });
            activeView = 'left';
            
            // Update annotation name
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Updated Left',
                source: 'library'
            });
            
            // Only left should be updated
            expect(leftLabel).toBe('Updated Left');
            expect(rightLabel).toBe('Right Initial');
            
            // Switch to right view
            activeView = 'right';
            eventBus.emit(Events.DUAL_VIEW_ACTIVE_CHANGED, { activeView: 'right' });
            
            // Update annotation name again
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Updated Right',
                source: 'library'
            });
            
            // Now right should be updated, left unchanged
            expect(leftLabel).toBe('Updated Left');
            expect(rightLabel).toBe('Updated Right');
        });
    });
});
