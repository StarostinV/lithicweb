# Event Bus Documentation

This document provides comprehensive documentation for the EventBus system used throughout the 3D Annotation Tool.

## Table of Contents

- [Overview](#overview)
- [Event Categories](#event-categories)
- [Annotation Events](#annotation-events)
- [Event Flow Diagrams](#event-flow-diagrams)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

The EventBus provides a centralized pub/sub system for component communication. Components emit events and subscribe to events from other components without direct references, enabling loose coupling.

### Key Principles

1. **Single Responsibility**: Each event has ONE clear purpose
2. **Granular Events**: Prefer multiple specific events over one overloaded event
3. **Clear Naming**: Event names describe WHAT happened, not WHO emitted
4. **Documented Flow**: Every event has documented emitters and subscribers

### Usage

```javascript
import { eventBus, Events } from '../utils/EventBus.js';

// Subscribe to an event
eventBus.on(Events.MESH_LOADED, (data) => {
    console.log('Mesh loaded:', data.filename);
}, 'myComponent');

// Emit an event
eventBus.emit(Events.MESH_LOADED, { source: 'file', filename: 'mesh.ply' });

// Cleanup on component destruction
eventBus.offNamespace('myComponent');
```

---

## Data Architecture: Source of Truth

Understanding where data lives is critical to avoiding sync bugs.

### The Rule

**`workingAnnotation` is THE source of truth for the current annotation state.**

All storage systems store complete Annotation snapshots (edges + metadata):
- **Library** - saved annotations
- **Cloud** - remote annotations
- **History** - past states for undo/redo
- **Filesystem** - PLY files

When you load from ANY storage, you copy the full snapshot to `workingAnnotation`.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   STORAGE                              LIVE STATE            │
│   (complete Annotation snapshots)                            │
│                                                              │
│   ┌─────────────┐      load        ┌────────────────────┐   │
│   │  Library    │─────────────────▶│                    │   │
│   │  Cloud      │◀─────────────────│  workingAnnotation │   │
│   │  Filesystem │      save        │  (SOURCE OF TRUTH) │   │
│   │  History    │                  │                    │   │
│   └─────────────┘                  └────────────────────┘   │
│                                             │               │
│   All storage works the same way:           │               │
│   - Library: user clicks "load"             ▼               │
│   - Cloud: user clicks "load from cloud"   ┌──────────────┐ │
│   - History: user clicks "undo/redo"       │currentEdge-  │ │
│   - Filesystem: user opens file            │Indices       │ │
│                                            │(for render)  │ │
│                                            └──────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### What This Means

1. **To get current annotation**: Call `meshView.getAnnotation()` - returns `workingAnnotation`
2. **To modify**: Update `workingAnnotation` directly (edges via drawing, metadata via panel)
3. **All storage is the same**: Library, Cloud, History, Filesystem all store complete Annotation objects
4. **Undo/redo restores full state**: Edges AND metadata are restored from history

### Common Operations

| Storage | Load (to workingAnnotation) | Save (from workingAnnotation) |
|---------|----------------------------|------------------------------|
| Library | User clicks "load" | User clicks "save" |
| Cloud | User clicks "load from cloud" | User clicks "upload" |
| History | User clicks "undo/redo" | Automatic on draw operation |
| Filesystem | User opens PLY file | User exports PLY file |

All load operations copy the full Annotation snapshot → `workingAnnotation`.
All save operations clone `workingAnnotation` → storage.

---

## Event Categories

### Connection Events

| Event | Purpose | Data |
|-------|---------|------|
| `CONNECTION_CHANGED` | Server connection status changed | `{ isConnected, config }` |
| `CONNECTION_MODAL_OPENED` | Connection settings modal opened | none |

### Mesh Events

| Event | Purpose | Data |
|-------|---------|------|
| `MESH_LOADED` | Mesh loaded from file or cloud | `{ source: 'file'\|'cloud', filename }` |
| `MESH_UPLOADED` | Mesh uploaded to cloud | `{ meshId }` |

### Annotation Events

See [Annotation Events](#annotation-events) section below for detailed documentation.

### Evaluation Events

| Event | Purpose | Data |
|-------|---------|------|
| `EVALUATION_GT_CHANGED` | Ground truth annotation set/cleared | `{ annotationId, description }` |
| `EVALUATION_PRED_CHANGED` | Prediction annotation set/cleared | `{ annotationId, description }` |
| `EVALUATION_METRICS_COMPUTED` | Metrics computed | `{ metrics }` |
| `EVALUATION_MODE_CHANGED` | Evaluation mode entered/exited | `{ isActive }` |

### Library Events

| Event | Purpose | Data |
|-------|---------|------|
| `LIBRARY_CHANGED` | Library modified | `{ action, id, annotation? }` |
| `LIBRARY_CLEARED` | Library cleared (new mesh) | `{}` |

### UI Events

| Event | Purpose | Data |
|-------|---------|------|
| `PANEL_SHOWN` | Panel became visible | `{ panelId }` |
| `PANEL_HIDDEN` | Panel hidden | `{ panelId }` |
| `SWITCH_PANEL` | Request to switch panel | `{ panelId }` |
| `MODE_CHANGED` | Interaction mode changed | `{ mode, previousMode }` |

---

## Annotation Events

### Design Philosophy

Annotation events are split into two distinct events with clear, non-overlapping purposes:

| Event | Purpose | Triggers Auto-Save? | Triggers UI Update? |
|-------|---------|:-------------------:|:-------------------:|
| `ANNOTATION_IMPORTED` | External annotation arrived | ✅ Yes | ❌ No |
| `ANNOTATION_ACTIVE_CHANGED` | Current annotation changed | ❌ No | ✅ Yes |

This separation prevents:
- Infinite loops (load → save → load)
- Unnecessary UI updates during batch operations
- Confusion about event semantics

---

### `ANNOTATION_IMPORTED`

**Purpose**: An annotation was received from an external source and should be saved to the library.

**When to emit**: 
- Annotation loaded from cloud storage
- Annotation generated by AI model inference
- Annotation imported from file

**When NOT to emit**:
- Loading from local library (already saved)
- Renaming an annotation (not imported)
- Batch operations that don't apply to view

#### Data Schema

```typescript
{
    annotation: Annotation,  // The annotation object to save
    source: 'cloud' | 'model' | 'import',
    cloudInfo?: {            // Only for cloud source
        meshId: string,
        stateId: string
    }
}
```

#### Emitters

| Component | Method | When |
|-----------|--------|------|
| `meshLoader` | `loadFile()` | PLY file with annotations loaded |
| `cloudStoragePanel` | `loadState()` | Single state loaded and applied |
| `cloudStoragePanel` | `saveToLibrary()` | Batch loading annotations |
| `modelPanel` | `applyResults()` | AI inference results applied |

#### Subscribers

| Component | Handler | Action |
|-----------|---------|--------|
| `libraryPanel` | `_handleAnnotationImported()` | Saves annotation to library |

#### Example

```javascript
// In cloudStoragePanel.loadState()
eventBus.emit(Events.ANNOTATION_IMPORTED, {
    annotation: annotation,
    source: 'cloud',
    cloudInfo: {
        meshId: meshId,
        stateId: stateId
    }
});
```

---

### `ANNOTATION_ACTIVE_CHANGED`

**Purpose**: The current working annotation has changed (identity, name, or metadata).

**When to emit**:
- Annotation loaded from library
- Annotation loaded from cloud (after applying)
- Model inference applied
- Current annotation renamed

**When NOT to emit**:
- Batch loading annotations (not applied to view)
- Edge drawing/erasing (use `STATE_CHANGED`)
- Library changes that don't affect current annotation

#### Data Schema

```typescript
{
    name: string,           // The annotation name
    source?: string         // Optional: where it came from
}
```

#### Emitters

| Component | Method | When |
|-----------|--------|------|
| `meshLoader` | `loadFile()` | PLY file with annotations loaded |
| `libraryPanel` | `loadAnnotation()` | Annotation loaded from library |
| `libraryPanel` | `saveCurrentAnnotation()` | Annotation saved to library with name |
| `libraryPanel` | rename handler | Current annotation renamed |
| `cloudStoragePanel` | `loadState()` | State applied to view |
| `modelPanel` | `applyResults()` | Inference results applied |

#### Subscribers

| Component | Handler | Action |
|-----------|---------|--------|
| `main.js` | `updateAnnotationLabel()` | Updates annotation label in UI |
| `DualViewManager` | `_updateActiveViewLabel()` | Updates active view's label button in dual view mode |
| `MetadataPanel` | `updateStateMetadataUI()` | Refreshes annotation metadata display |

#### Example

```javascript
// In libraryPanel.loadAnnotation()
eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
    name: annotation.name,
    source: 'library'
});
```

---

## Event Flow Diagrams

### Loading PLY File with Annotations

```
User loads annotated PLY file
        │
        ▼
┌─────────────────────────────────┐
│   meshLoader.loadFile()         │
│   - Parses PLY geometry         │
│   - Creates workingAnnotation   │
│   - Sets annotation name        │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│      emit MESH_LOADED           │
│ { source: 'file', filename }    │
└─────────────────────────────────┘
        │
        ▼ (if file has annotations)
        ├──────────────────────────────────────┐
        ▼                                      ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│   emit ANNOTATION_IMPORTED      │  │ emit ANNOTATION_ACTIVE_CHANGED  │
│   { annotation, source: 'file'} │  │ { name, source: 'file' }        │
└─────────────────────────────────┘  └─────────────────────────────────┘
        │                                      │
        ▼                                      ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│ libraryPanel auto-saves         │  │ main.js updateAnnotationLabel() │
│ annotation to library           │  │ - Updates UI label              │
└─────────────────────────────────┘  └─────────────────────────────────┘

Note: If PLY has NO annotations, only MESH_LOADED is emitted
```

### Saving Current Annotation to Library

```
User clicks "Save to Library" button
        │
        ▼
┌─────────────────────────────────┐
│  libraryPanel.saveCurrentAnnotation()
│  - Prompts for annotation name  │
│  - Saves to library             │
│  - Updates workingAnnotation    │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│ emit ANNOTATION_ACTIVE_CHANGED  │
│ { name: userProvidedName,       │
│   source: 'library' }           │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│ main.js updateAnnotationLabel() │
│ - Updates UI label              │
└─────────────────────────────────┘

Note: ANNOTATION_IMPORTED is NOT emitted (not from external source)
```

### Loading Annotation from Library

```
User clicks annotation in library
        │
        ▼
┌─────────────────────────────────┐
│  libraryPanel.loadAnnotation() │
│  - Applies edge state           │
│  - Updates workingAnnotation    │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│ emit ANNOTATION_ACTIVE_CHANGED  │
│ { name, source: 'library' }     │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│ main.js updateAnnotationLabel() │
│ - Updates UI label              │
└─────────────────────────────────┘

Note: ANNOTATION_IMPORTED is NOT emitted (already in library)
```

### Loading Single State from Cloud

```
User clicks state in cloud panel
        │
        ▼
┌─────────────────────────────────┐
│  cloudStoragePanel.loadState()  │
│  - Fetches state from server    │
│  - Applies to mesh view         │
│  - Updates workingAnnotation    │
└─────────────────────────────────┘
        │
        ├──────────────────────────────────────┐
        ▼                                      ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│   emit ANNOTATION_IMPORTED      │  │ emit ANNOTATION_ACTIVE_CHANGED  │
│   { annotation, source: 'cloud' │  │ { name, source: 'cloud' }       │
│     cloudInfo: { meshId, ... }} │  └─────────────────────────────────┘
└─────────────────────────────────┘            │
        │                                      ▼
        ▼                           ┌─────────────────────────────────┐
┌─────────────────────────────────┐ │ main.js updateAnnotationLabel() │
│ libraryPanel auto-saves         │ │ - Updates UI label              │
│ annotation to library           │ └─────────────────────────────────┘
└─────────────────────────────────┘
```

### Batch Loading from Cloud (Save to Library)

```
User clicks "Save to Library" on cloud mesh
        │
        ▼
┌─────────────────────────────────┐
│  cloudStoragePanel.saveToLibrary()
│  - Loads mesh into viewer       │
│  - Fetches all states           │
└─────────────────────────────────┘
        │
        ▼ (for each state)
┌─────────────────────────────────┐
│   emit ANNOTATION_IMPORTED      │
│   { annotation, source: 'cloud' │
│     cloudInfo: { meshId, ... }} │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│ libraryPanel auto-saves each    │
│ annotation to library           │
└─────────────────────────────────┘

Note: ANNOTATION_ACTIVE_CHANGED is NOT emitted
      (annotations are saved, not applied to view)
```

### Model Inference

```
User runs model inference
        │
        ▼
┌─────────────────────────────────┐
│   modelPanel.applyResults()     │
│   - Applies edge labels         │
│   - Updates workingAnnotation   │
└─────────────────────────────────┘
        │
        ├──────────────────────────────────────┐
        ▼                                      ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│   emit ANNOTATION_IMPORTED      │  │ emit ANNOTATION_ACTIVE_CHANGED  │
│   { annotation, source: 'model'}│  │ { name, source: 'model' }       │
└─────────────────────────────────┘  └─────────────────────────────────┘
        │                                      │
        ▼                                      ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│ libraryPanel auto-saves         │  │ main.js updateAnnotationLabel() │
│ annotation to library           │  │ - Updates UI label              │
└─────────────────────────────────┘  └─────────────────────────────────┘
```

### Renaming Current Annotation

```
User renames annotation in library (current one)
        │
        ▼
┌─────────────────────────────────┐
│  Library rename handler         │
│  - Updates library annotation   │
│  - Updates workingAnnotation    │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│ emit ANNOTATION_ACTIVE_CHANGED  │
│ { name: newName, source: 'library' }
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│ main.js updateAnnotationLabel() │
│ - Updates UI label              │
└─────────────────────────────────┘

Note: ANNOTATION_IMPORTED is NOT emitted (not imported)
```

---

## Best Practices

### 1. Use Granular Events

❌ **Bad**: One event for multiple purposes
```javascript
// Anti-pattern: overloaded event
eventBus.emit(Events.ANNOTATION_LOADED, {
    annotation,
    source: 'library',  // Different behavior based on source
    shouldSave: false   // Flag to control behavior
});
```

✅ **Good**: Separate events for separate purposes
```javascript
// Clear: this is for saving to library
eventBus.emit(Events.ANNOTATION_IMPORTED, { annotation, source: 'cloud' });

// Clear: this is for UI updates
eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, { name: annotation.name });
```

### 2. Document Event Contracts

Always document in the component's JSDoc:
- Which events it **subscribes to**
- Which events it **emits**
- What data format is expected

### 3. Use Namespaces for Cleanup

```javascript
// Subscribe with namespace
eventBus.on(Events.MESH_LOADED, handler, 'myComponent');

// Clean up all subscriptions in dispose()
dispose() {
    eventBus.offNamespace('myComponent');
}
```

### 4. Avoid Circular Dependencies

If emitting event A triggers event B which triggers event A, you have a bug.

```
❌ ANNOTATION_IMPORTED → save to library → LIBRARY_CHANGED → emit ANNOTATION_IMPORTED
```

The current design avoids this by using separate events.

### 5. Test Event Flows

Every event emission should have a corresponding test verifying:
- The event is emitted with correct data
- Subscribers receive and handle the event correctly

---

## Troubleshooting

### Event not being received

1. **Check subscription timing**: Ensure subscriber registers before event is emitted
2. **Check namespace**: Verify the subscription hasn't been cleaned up
3. **Enable debug mode**: `eventBus.setDebug(true)` logs all events

### Infinite loops

1. **Check for cycles**: Event A → handler → Event A
2. **Use granular events**: Don't use flags to control behavior
3. **Review the flow diagrams**: Ensure no circular paths

### Unexpected behavior

1. **Check all subscribers**: Multiple components may subscribe
2. **Use `eventBus.getDebugInfo()`**: Shows all active subscriptions
3. **Review event documentation**: Ensure correct event is being used

---

## Common Pitfalls and Lessons Learned

### Historical Bugs (Fixed)

1. **Metadata disappeared on switch** - `getAnnotation()` was merging data from multiple sources instead of just returning `workingAnnotation`.

2. **"Load:" prefix corrupted names** - History action descriptions contained annotation names. When used as fallback, corrupted the name. Fix: use generic descriptions only.

3. **Rename didn't update UI** - Rename only updated one place, but undo/redo didn't restore metadata. Fix: undo/redo now restores full Annotation including metadata.

4. **Save overwrote original** - ID wasn't changed when saving modified annotation. Fix: `cloneWithNewId()` creates new entry.

### Coding Guidelines

**Object Spread Order**: Put authoritative values LAST:
```javascript
const metadata = {
    ...(cloudData.metadata || {}),  // Spread first
    name: cleanName,                 // Override with clean value
};
```

**Save vs. Update Semantics**: Decide if it's a new entry or update:
```javascript
if (this.library.has(annotation.id)) {
    annotation = annotation.cloneWithNewId();  // New entry
}
this.library.save(annotation);
```

**Generic Display Text**: Never embed data in display strings:
```javascript
// BAD: Data in description can leak back into data
startDrawOperation('library-load', `Load: ${annotation.name}`);

// GOOD: Generic description, data stays in metadata
startDrawOperation('library-load');
```

### Summary

1. **`workingAnnotation` is the source of truth** for current state
2. **All storage is equivalent**: Library, Cloud, History, Filesystem store complete Annotation snapshots
3. **Load = copy to workingAnnotation**: Any load operation copies the full snapshot
4. **Save = clone from workingAnnotation**: Any save operation clones the current state

---

## Quick Reference

### Annotation Events Summary

| Scenario | ANNOTATION_IMPORTED | ANNOTATION_ACTIVE_CHANGED |
|----------|:-------------------:|:-------------------------:|
| Load PLY with annotations | ✅ | ✅ |
| Load PLY without annotations | ❌ (uses MESH_LOADED only) | ❌ |
| Load from library | ❌ | ✅ |
| Save to library | ❌ | ✅ |
| Load single from cloud | ✅ | ✅ |
| Batch load from cloud | ✅ (each) | ❌ |
| Model inference | ✅ | ✅ |
| Rename current annotation | ❌ | ✅ |

### Event → Subscriber Quick Lookup

| Event | Subscribers |
|-------|-------------|
| `ANNOTATION_IMPORTED` | libraryPanel (auto-save) |
| `ANNOTATION_ACTIVE_CHANGED` | main.js (UI label) |
| `MESH_LOADED` | main.js (UI label), libraryPanel (UI refresh) |
| `LIBRARY_CHANGED` | libraryPanel (UI refresh) |
