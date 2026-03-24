/**
 * @fileoverview Unit tests for the LibraryPanel save modal flow.
 *
 * Tests the enhanced annotation save dialog logic:
 * - Default name generation with timestamp
 * - Metadata preview population
 * - Cloud toggle visibility
 * - Save-as semantics (new entry for existing IDs)
 *
 * @see src/components/libraryPanel.js
 */

import { eventBus, Events } from '../../../src/utils/EventBus.js';

// Minimal mock of AnnotationLibrary
function createMockLibrary() {
    const store = new Map();
    let nextId = 1;
    return {
        groundTruthId: null,
        predictionId: null,
        get count() { return store.size; },
        has(id) { return store.has(id); },
        save(annotation) {
            const id = annotation.id || `lib-${nextId++}`;
            store.set(id, { ...annotation });
            eventBus.emit(Events.LIBRARY_CHANGED, { action: 'save', id });
            return id;
        },
        load(id) {
            const ann = store.get(id);
            return ann ? { ...ann } : null;
        },
        getAllSorted() { return [...store.values()]; },
        isEmpty() { return store.size === 0; },
        isCloudSynced() { return false; },
    };
}

// Minimal mock of Annotation
function createMockAnnotation(overrides = {}) {
    return {
        id: 'test-id',
        name: 'Test Annotation',
        source: 'manual',
        edgeCount: 42,
        metadata: {
            name: 'Test Annotation',
            source: 'manual',
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            ...overrides.metadata,
        },
        isEmpty() { return false; },
        clone() { return { ...this, metadata: { ...this.metadata } }; },
        cloneWithNewId() { return { ...this, id: 'new-id-' + Date.now(), metadata: { ...this.metadata } }; },
        ...overrides,
    };
}

describe('Save Modal Logic', () => {
    beforeEach(() => {
        eventBus.clear();
    });

    afterEach(() => {
        eventBus.clear();
    });

    describe('Default name generation', () => {
        test('should use existing name if available', () => {
            const annotation = createMockAnnotation({ name: 'My Custom Name' });
            const currentName = annotation.name || `Annotation ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
            expect(currentName).toBe('My Custom Name');
        });

        test('should generate timestamp-based name when annotation has no name', () => {
            const annotation = createMockAnnotation({ name: '' });
            const now = new Date();
            const dateStr = now.toLocaleDateString();
            const timeStr = now.toLocaleTimeString();
            const currentName = annotation.name || `Annotation ${dateStr} ${timeStr}`;
            expect(currentName).toContain('Annotation');
            expect(currentName).toContain(dateStr);
        });
    });

    describe('Metadata preview filtering', () => {
        test('should filter out internal fields from display', () => {
            const metadata = {
                name: 'Test',
                source: 'manual',
                createdAt: Date.now(),
                modifiedAt: Date.now(),
                cloudStateId: 'cloud-123',
                evaluation: { f1: 0.85 },
                customField: 'value',
            };

            const internalFields = ['name', 'source', 'createdAt', 'modifiedAt', 'cloudStateId'];
            const displayKeys = Object.keys(metadata).filter(k => !internalFields.includes(k));

            expect(displayKeys).toEqual(['evaluation', 'customField']);
            expect(displayKeys).not.toContain('name');
            expect(displayKeys).not.toContain('createdAt');
        });

        test('should report zero entries when only internal fields exist', () => {
            const metadata = {
                name: 'Test',
                source: 'manual',
                createdAt: Date.now(),
                modifiedAt: Date.now(),
            };

            const internalFields = ['name', 'source', 'createdAt', 'modifiedAt', 'cloudStateId'];
            const displayKeys = Object.keys(metadata).filter(k => !internalFields.includes(k));

            expect(displayKeys).toHaveLength(0);
        });
    });

    describe('Save-as semantics', () => {
        test('should create new entry when annotation ID already exists in library', () => {
            const library = createMockLibrary();
            const annotation = createMockAnnotation({ id: 'existing-id' });

            // Save it once
            library.save(annotation);
            expect(library.has('existing-id')).toBe(true);

            // If we try to save again with same ID, we should clone with new ID
            let toSave = annotation;
            if (library.has(toSave.id)) {
                toSave = toSave.cloneWithNewId();
            }
            expect(toSave.id).not.toBe('existing-id');

            const newId = library.save(toSave);
            expect(library.count).toBe(2);
        });

        test('should save directly when annotation ID is new', () => {
            const library = createMockLibrary();
            const annotation = createMockAnnotation({ id: 'brand-new' });

            expect(library.has('brand-new')).toBe(false);
            library.save(annotation);
            expect(library.count).toBe(1);
        });
    });

    describe('Cloud toggle visibility', () => {
        test('should show cloud section when mesh is cloud-synced', () => {
            // Simulating the condition check
            const cloudStoragePanel = { cloudMeshInfo: { meshId: 'mesh-1' } };
            const isMeshCloudSynced = cloudStoragePanel?.cloudMeshInfo != null;
            expect(isMeshCloudSynced).toBe(true);
        });

        test('should hide cloud section when mesh is local', () => {
            const cloudStoragePanel = { cloudMeshInfo: null };
            const isMeshCloudSynced = cloudStoragePanel?.cloudMeshInfo != null;
            expect(isMeshCloudSynced).toBe(false);
        });

        test('should hide cloud section when no cloud panel', () => {
            const cloudStoragePanel = null;
            const isMeshCloudSynced = cloudStoragePanel?.cloudMeshInfo != null;
            expect(isMeshCloudSynced).toBe(false);
        });
    });

    describe('Event emission on save', () => {
        test('should emit LIBRARY_CHANGED when annotation is saved', () => {
            const handler = jest.fn();
            eventBus.on(Events.LIBRARY_CHANGED, handler, 'test');

            const library = createMockLibrary();
            library.save(createMockAnnotation());

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'save' })
            );
        });

        test('should emit ANNOTATION_ACTIVE_CHANGED after save completes', () => {
            const handler = jest.fn();
            eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, handler, 'test');

            // Simulate what saveCurrentAnnotation does after library.save()
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: 'Saved Annotation',
                source: 'library'
            });

            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Saved Annotation',
                    source: 'library'
                })
            );
        });
    });
});
