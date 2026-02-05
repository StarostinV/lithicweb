/**
 * @fileoverview Unit tests for the EventBus module.
 * 
 * Test Coverage:
 * - Basic subscription and emission
 * - Namespace management
 * - One-time listeners
 * - Unsubscription patterns
 * - Error handling
 * - Debug utilities
 * 
 * @see src/utils/EventBus.js
 */

import { eventBus, Events } from '../../../src/utils/EventBus.js';

describe('EventBus', () => {
    // Create a fresh EventBus instance for each test to avoid cross-test pollution
    let testBus;
    
    beforeEach(() => {
        // Clear the global eventBus before each test
        eventBus.clear();
        
        // Create a simple test bus by reusing the class
        // Since EventBus is not exported, we'll use the global instance with clear()
        testBus = eventBus;
    });
    
    afterEach(() => {
        // Ensure cleanup
        eventBus.clear();
    });
    
    // =========================================================================
    // Basic Subscription and Emission
    // =========================================================================
    
    describe('on() and emit()', () => {
        /**
         * @test Verifies basic event subscription and emission
         * @given A listener subscribed to an event
         * @when The event is emitted
         * @then The listener receives the event data
         */
        test('should call listener when event is emitted', () => {
            const handler = jest.fn();
            testBus.on(Events.CONNECTION_CHANGED, handler);
            
            testBus.emit(Events.CONNECTION_CHANGED, { isConnected: true });
            
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith({ isConnected: true });
        });
        
        /**
         * @test Verifies multiple listeners receive the same event
         * @given Multiple listeners subscribed to the same event
         * @when The event is emitted
         * @then All listeners receive the event
         */
        test('should call all listeners for an event', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const handler3 = jest.fn();
            
            testBus.on(Events.MESH_LOADED, handler1);
            testBus.on(Events.MESH_LOADED, handler2);
            testBus.on(Events.MESH_LOADED, handler3);
            
            testBus.emit(Events.MESH_LOADED, { source: 'file' });
            
            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);
            expect(handler3).toHaveBeenCalledTimes(1);
        });
        
        /**
         * @test Verifies listeners only receive subscribed events
         * @given A listener subscribed to event A
         * @when Event B is emitted
         * @then The listener is not called
         */
        test('should not call listener for different event', () => {
            const handler = jest.fn();
            testBus.on(Events.CONNECTION_CHANGED, handler);
            
            testBus.emit(Events.MESH_LOADED, { source: 'file' });
            
            expect(handler).not.toHaveBeenCalled();
        });
        
        /**
         * @test Verifies emit with no data works
         * @given A listener subscribed to an event
         * @when The event is emitted without data
         * @then The listener receives null
         */
        test('should work with no data', () => {
            const handler = jest.fn();
            testBus.on(Events.LIBRARY_CLEARED, handler);
            
            testBus.emit(Events.LIBRARY_CLEARED);
            
            expect(handler).toHaveBeenCalledWith(null);
        });
        
        /**
         * @test Verifies emit with no listeners is safe
         * @given No listeners subscribed
         * @when An event is emitted
         * @then No error is thrown
         */
        test('should not throw when emitting with no listeners', () => {
            expect(() => {
                testBus.emit(Events.CONNECTION_CHANGED, { isConnected: true });
            }).not.toThrow();
        });
        
        /**
         * @test Verifies that non-function callbacks are rejected
         * @given An invalid callback (not a function)
         * @when on() is called
         * @then The subscription is ignored
         */
        test('should reject non-function callbacks', () => {
            const result = testBus.on(Events.MESH_LOADED, 'not a function');
            
            // Should return empty unsubscribe function
            expect(typeof result).toBe('function');
            
            // Should not add any listeners
            expect(testBus.listenerCount(Events.MESH_LOADED)).toBe(0);
        });
    });
    
    // =========================================================================
    // Unsubscription
    // =========================================================================
    
    describe('off()', () => {
        /**
         * @test Verifies removing a specific listener
         * @given A listener subscribed to an event
         * @when off() is called with the callback
         * @then The listener is removed
         */
        test('should remove specific listener', () => {
            const handler = jest.fn();
            testBus.on(Events.CONNECTION_CHANGED, handler);
            
            testBus.off(Events.CONNECTION_CHANGED, handler);
            testBus.emit(Events.CONNECTION_CHANGED, { isConnected: true });
            
            expect(handler).not.toHaveBeenCalled();
        });
        
        /**
         * @test Verifies removing all listeners for an event
         * @given Multiple listeners subscribed to an event
         * @when off() is called without a callback
         * @then All listeners are removed
         */
        test('should remove all listeners for event when no callback specified', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            
            testBus.on(Events.MESH_LOADED, handler1);
            testBus.on(Events.MESH_LOADED, handler2);
            
            testBus.off(Events.MESH_LOADED);
            testBus.emit(Events.MESH_LOADED, {});
            
            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).not.toHaveBeenCalled();
            expect(testBus.listenerCount(Events.MESH_LOADED)).toBe(0);
        });
        
        /**
         * @test Verifies off() is safe with non-existent event
         * @given No listeners for an event
         * @when off() is called
         * @then No error is thrown
         */
        test('should not throw when removing non-existent event', () => {
            expect(() => {
                testBus.off(Events.CONNECTION_CHANGED);
            }).not.toThrow();
        });
        
        /**
         * @test Verifies unsubscribe function returned by on()
         * @given A listener subscribed via on()
         * @when The returned unsubscribe function is called
         * @then The listener is removed
         */
        test('should return working unsubscribe function', () => {
            const handler = jest.fn();
            const unsubscribe = testBus.on(Events.MESH_LOADED, handler);
            
            unsubscribe();
            testBus.emit(Events.MESH_LOADED, {});
            
            expect(handler).not.toHaveBeenCalled();
        });
    });
    
    // =========================================================================
    // Namespace Management
    // =========================================================================
    
    describe('offNamespace()', () => {
        /**
         * @test Verifies removing all listeners in a namespace
         * @given Multiple listeners with the same namespace
         * @when offNamespace() is called
         * @then All listeners in that namespace are removed
         */
        test('should remove all listeners in a namespace', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const handler3 = jest.fn();
            
            testBus.on(Events.CONNECTION_CHANGED, handler1, 'componentA');
            testBus.on(Events.MESH_LOADED, handler2, 'componentA');
            testBus.on(Events.MESH_LOADED, handler3, 'componentB');
            
            testBus.offNamespace('componentA');
            
            testBus.emit(Events.CONNECTION_CHANGED, {});
            testBus.emit(Events.MESH_LOADED, {});
            
            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).not.toHaveBeenCalled();
            expect(handler3).toHaveBeenCalledTimes(1);
        });
        
        /**
         * @test Verifies namespace cleanup leaves other namespaces intact
         * @given Listeners in different namespaces
         * @when offNamespace() is called for one namespace
         * @then Only that namespace is affected
         */
        test('should not affect other namespaces', () => {
            const handlerA = jest.fn();
            const handlerB = jest.fn();
            
            testBus.on(Events.MESH_LOADED, handlerA, 'panelA');
            testBus.on(Events.MESH_LOADED, handlerB, 'panelB');
            
            testBus.offNamespace('panelA');
            testBus.emit(Events.MESH_LOADED, {});
            
            expect(handlerA).not.toHaveBeenCalled();
            expect(handlerB).toHaveBeenCalledTimes(1);
        });
        
        /**
         * @test Verifies offNamespace is safe with non-existent namespace
         * @given No listeners with a specific namespace
         * @when offNamespace() is called
         * @then No error is thrown
         */
        test('should not throw for non-existent namespace', () => {
            expect(() => {
                testBus.offNamespace('nonExistent');
            }).not.toThrow();
        });
    });
    
    // =========================================================================
    // One-time Listeners
    // =========================================================================
    
    describe('once()', () => {
        /**
         * @test Verifies once() listener fires only once
         * @given A listener subscribed via once()
         * @when The event is emitted twice
         * @then The listener is called only once
         */
        test('should only fire once', () => {
            const handler = jest.fn();
            testBus.once(Events.MESH_LOADED, handler);
            
            testBus.emit(Events.MESH_LOADED, { first: true });
            testBus.emit(Events.MESH_LOADED, { second: true });
            
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith({ first: true });
        });
        
        /**
         * @test Verifies once() listener is automatically removed
         * @given A listener subscribed via once()
         * @when The event is emitted
         * @then The listener count decreases
         */
        test('should be removed after firing', () => {
            const handler = jest.fn();
            testBus.once(Events.MESH_LOADED, handler);
            
            expect(testBus.listenerCount(Events.MESH_LOADED)).toBe(1);
            
            testBus.emit(Events.MESH_LOADED, {});
            
            expect(testBus.listenerCount(Events.MESH_LOADED)).toBe(0);
        });
        
        /**
         * @test Verifies once() can be manually unsubscribed before firing
         * @given A listener subscribed via once()
         * @when It is unsubscribed before the event fires
         * @then It never fires
         */
        test('should be removable before firing', () => {
            const handler = jest.fn();
            const unsubscribe = testBus.once(Events.MESH_LOADED, handler);
            
            unsubscribe();
            testBus.emit(Events.MESH_LOADED, {});
            
            expect(handler).not.toHaveBeenCalled();
        });
        
        /**
         * @test Verifies once() with namespace works
         * @given A once listener with a namespace
         * @when offNamespace is called before the event fires
         * @then The listener is removed
         */
        test('should work with namespaces', () => {
            const handler = jest.fn();
            testBus.once(Events.MESH_LOADED, handler, 'myComponent');
            
            testBus.offNamespace('myComponent');
            testBus.emit(Events.MESH_LOADED, {});
            
            expect(handler).not.toHaveBeenCalled();
        });
    });
    
    // =========================================================================
    // Error Handling
    // =========================================================================
    
    describe('Error Handling', () => {
        /**
         * @test Verifies errors in listeners don't break other listeners
         * @given Multiple listeners, one throws an error
         * @when The event is emitted
         * @then Other listeners still fire
         */
        test('should continue calling listeners after one throws', () => {
            const handler1 = jest.fn(() => {
                throw new Error('Handler 1 error');
            });
            const handler2 = jest.fn();
            const handler3 = jest.fn();
            
            testBus.on(Events.MESH_LOADED, handler1);
            testBus.on(Events.MESH_LOADED, handler2);
            testBus.on(Events.MESH_LOADED, handler3);
            
            // Suppress console.error for this test
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            
            testBus.emit(Events.MESH_LOADED, {});
            
            expect(handler1).toHaveBeenCalled();
            expect(handler2).toHaveBeenCalled();
            expect(handler3).toHaveBeenCalled();
            
            consoleSpy.mockRestore();
        });
    });
    
    // =========================================================================
    // Utility Methods
    // =========================================================================
    
    describe('Utility Methods', () => {
        /**
         * @test Verifies hasListeners() returns correct value
         * Note: hasListeners returns a falsy value (undefined) when no listeners exist,
         * and a truthy value (true) when listeners exist.
         */
        test('hasListeners() should return correct value', () => {
            expect(testBus.hasListeners(Events.MESH_LOADED)).toBeFalsy();
            
            testBus.on(Events.MESH_LOADED, jest.fn());
            expect(testBus.hasListeners(Events.MESH_LOADED)).toBe(true);
            
            testBus.off(Events.MESH_LOADED);
            expect(testBus.hasListeners(Events.MESH_LOADED)).toBeFalsy();
        });
        
        /**
         * @test Verifies listenerCount() returns correct count
         */
        test('listenerCount() should return correct count', () => {
            expect(testBus.listenerCount(Events.MESH_LOADED)).toBe(0);
            
            testBus.on(Events.MESH_LOADED, jest.fn());
            expect(testBus.listenerCount(Events.MESH_LOADED)).toBe(1);
            
            testBus.on(Events.MESH_LOADED, jest.fn());
            expect(testBus.listenerCount(Events.MESH_LOADED)).toBe(2);
        });
        
        /**
         * @test Verifies clear() removes all listeners
         */
        test('clear() should remove all listeners', () => {
            testBus.on(Events.CONNECTION_CHANGED, jest.fn());
            testBus.on(Events.MESH_LOADED, jest.fn());
            testBus.on(Events.STATE_CHANGED, jest.fn());
            
            testBus.clear();
            
            expect(testBus.listenerCount(Events.CONNECTION_CHANGED)).toBe(0);
            expect(testBus.listenerCount(Events.MESH_LOADED)).toBe(0);
            expect(testBus.listenerCount(Events.STATE_CHANGED)).toBe(0);
        });
        
        /**
         * @test Verifies getDebugInfo() returns useful information
         */
        test('getDebugInfo() should return subscription info', () => {
            testBus.on(Events.MESH_LOADED, jest.fn(), 'panel1');
            testBus.on(Events.MESH_LOADED, jest.fn(), 'panel2');
            testBus.on(Events.CONNECTION_CHANGED, jest.fn(), 'panel1');
            
            const info = testBus.getDebugInfo();
            
            expect(info[Events.MESH_LOADED]).toEqual({
                count: 2,
                namespaces: ['panel1', 'panel2']
            });
            expect(info[Events.CONNECTION_CHANGED]).toEqual({
                count: 1,
                namespaces: ['panel1']
            });
        });
    });
    
    // =========================================================================
    // Event Constants
    // =========================================================================
    
    describe('Events Constants', () => {
        /**
         * @test Verifies Events object is frozen
         * @given The Events constant object
         * @when Attempting to modify it
         * @then Modifications fail silently or throw
         */
        test('Events should be frozen', () => {
            expect(Object.isFrozen(Events)).toBe(true);
        });
        
        /**
         * @test Verifies all expected annotation events exist
         */
        test('should have annotation-related event constants', () => {
            expect(Events.ANNOTATION_IMPORTED).toBeDefined();
            expect(Events.ANNOTATION_ACTIVE_CHANGED).toBeDefined();
            expect(Events.STATE_CHANGED).toBeDefined();
            expect(Events.STATE_SAVED).toBeDefined();
            expect(Events.STATE_LOADED).toBeDefined();
        });
        
        /**
         * @test Verifies event values are strings
         */
        test('event values should be strings', () => {
            for (const [key, value] of Object.entries(Events)) {
                expect(typeof value).toBe('string');
                expect(value.length).toBeGreaterThan(0);
            }
        });
    });
});
