# TODO (current)

## Architectural Recommendations (Future Work)

### A. Event Bus Pattern ✅ FULLY MIGRATED

**Status**: Core implementation complete. All components migrated.

**Location**: `src/utils/EventBus.js`

**Migrated Components**:
- [x] ConnectionManager → emits `CONNECTION_CHANGED`, `CONNECTION_MODAL_OPENED`
- [x] CloudStoragePanel → subscribes to `CONNECTION_CHANGED`, `MESH_LOADED`; emits `MESH_LOADED`, `MESH_UPLOADED`, `STATE_LOADED`, `STATE_SAVED`
- [x] ModelPanel → subscribes to `CONNECTION_CHANGED`
- [x] Mode → emits `MODE_CHANGED`
- [x] ActionHistory → emits `HISTORY_CHANGED`
- [x] EvaluationManager → emits `EVALUATION_GT_CHANGED`, `EVALUATION_PRED_CHANGED`, `EVALUATION_METRICS_COMPUTED`, `EVALUATION_MODE_CHANGED`
- [x] HistoryPanel → subscribes to `HISTORY_CHANGED`, `EVALUATION_GT_CHANGED`, `EVALUATION_PRED_CHANGED`
- [x] EvaluationPanel → subscribes to `EVALUATION_GT_CHANGED`, `EVALUATION_PRED_CHANGED`, `EVALUATION_METRICS_COMPUTED`
- [x] MeshLoader → emits `MESH_LOADED`
- [x] main.js → subscribes to `MODE_CHANGED`
- [x] UserConfig → emits `CONFIG_CHANGED`
- [x] MetadataPanel → subscribes to `MESH_LOADED`, `HISTORY_CHANGED`
- [x] SettingsPanel → subscribes to `CONFIG_CHANGED`

**Legacy listeners preserved for backward compatibility** (marked as @deprecated):
- ConnectionManager.addListener()
- Mode.addModeChangeListener()
- ActionHistory.addListener()
- EvaluationManager.addListener()
- MeshLoader.addLoadListener()
- UserConfig.addListener()

**Usage**:
```javascript
import { eventBus, Events } from '../utils/EventBus.js';

// Subscribe with namespace for easy cleanup
eventBus.on(Events.CONNECTION_CHANGED, (data) => {
    console.log('Connected:', data.isConnected);
}, 'myComponent');

// Emit events
eventBus.emit(Events.MESH_LOADED, { source: 'cloud', meshId: '...' });

// Cleanup all subscriptions for a component
eventBus.offNamespace('myComponent');

// Debug: view all subscriptions
eventBus.getDebugInfo();
```

**Available Events** (see `Events` constant in EventBus.js for full list):
- `CONNECTION_CHANGED`, `CONNECTION_MODAL_OPENED`
- `MESH_LOADED`, `MESH_UPLOADED`
- `STATE_CHANGED`, `STATE_SAVED`, `STATE_LOADED`
- `EVALUATION_*` events
- `MODE_CHANGED`, `PANEL_SHOWN`, `PANEL_HIDDEN`

### B. Centralized State Management

State is scattered across components:
- `cloudMeshInfo` in CloudStoragePanel
- `currentSession` in ModelPanel
- `groundTruth`/`prediction` in EvaluationManager
- `config` in UserConfig

Consider a simple store pattern for shared application state.

### C. Direct DOM ID Coupling

Many components directly query DOM by ID. Consider:
- Passing element references via constructor
- Using a simple DI container
- Creating a UI registry that manages element references

---

## Checklist for Resolution

- [ ] Fix `window.onclick` bug in uiSetup.js
- [ ] Remove duplicate `exportMeshToPLY` from modelPanel.js
- [ ] Add null checks to `applyState` in cloudStoragePanel.js
- [ ] Refactor mode.setMode monkey-patch to use listener pattern
- [ ] Fix hardcoded magic numbers for layout dimensions
- [ ] Add session state verification
- [ ] Fix history listener memory leak
- [ ] Cache DOM elements in syncAnnotationTabWithMode
- [ ] Remove or document legacy panel divs
- [ ] Add debug/production logging levels
- [ ] Add JSDoc to undocumented functions
- [ ] Add input sanitization for user-provided names
- [ ] (Future) Consider file splitting for large components
- [x] ~~(Future) Consider event bus for component communication~~ → Fully implemented and migrated in `src/utils/EventBus.js`
