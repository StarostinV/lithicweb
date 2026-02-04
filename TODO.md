# Code Review TODO - February 2026

This document captures issues identified during a comprehensive code review of recent changes.
Organized by priority and category for systematic resolution.

---

## High Priority Issues

### 1. `window.onclick` Overwriting Bug in uiSetup.js

**File:** `src/components/uiSetup.js` (lines 28-32)

**Problem:** The documentation modal setup uses direct assignment `window.onclick = function(event)` which **overwrites** any other global click handlers. Meanwhile, `connectionManager.js` correctly uses `addEventListener`.

**Current (broken):**
```javascript
window.onclick = function(event) {
    if (event.target === modal) {
        modal.style.display = 'none';
    }
};
```

**Fix:** Change to use `addEventListener`:
```javascript
window.addEventListener('click', function(event) {
    if (event.target === modal) {
        modal.style.display = 'none';
    }
});
```

**Impact:** This will break modal close functionality if any other code sets `window.onclick`.

---

### 2. Duplicate PLY Export Logic

**Files:**
- `src/components/modelPanel.js` (lines 312-347) - Manual PLY string building
- `src/components/cloudStoragePanel.js` (lines 1216-1224) - Uses shared `exportMeshToBlob`

**Problem:** Two different implementations of PLY export exist. The `modelPanel.js` version:
- Manually builds PLY header and content as a string
- Does NOT include metadata
- Is marked "kept for future use with disk storage" but is actually unused

The `cloudStoragePanel.js` version:
- Uses the shared `exportMeshToBlob` from `meshExporter.js`
- Properly includes mesh metadata

**Fix:** 
1. Remove `exportMeshToPLY()` from `modelPanel.js` entirely (it's unused)
2. If needed in the future, import and use the shared utility from `meshExporter.js`

---

### 3. Missing Null Check in `applyState`

**File:** `src/components/cloudStoragePanel.js` (lines 822-859)

**Problem:** No validation that server response contains expected data:
```javascript
applyState(stateData) {
    const edgeIndices = new Set(stateData.edge_indices);  // Will crash if undefined
```

**Fix:** Add defensive checks:
```javascript
applyState(stateData) {
    if (!stateData || !Array.isArray(stateData.edge_indices)) {
        console.error('[CloudStorage] Invalid state data received:', stateData);
        this.setStatus('Failed to apply state: invalid data format', 'error');
        return;
    }
    const edgeIndices = new Set(stateData.edge_indices);
    // ...
}
```

---

## Medium Priority Issues

### 4. Monkey-Patching `mode.setMode` in main.js

**File:** `src/main.js` (lines 178-182)

**Problem:** The code monkey-patches `mode.setMode` to add tab synchronization:
```javascript
const originalSetMode = mode.setMode.bind(mode);
mode.setMode = function(newMode, rewritePrevious = false) {
    originalSetMode(newMode, rewritePrevious);
    syncAnnotationTabWithMode(newMode);
};
```

**Why this is bad:**
- Breaks encapsulation of the Mode class
- Makes debugging harder (stack traces show anonymous function)
- Future changes to Mode class could break this silently
- Not discoverable - someone reading Mode.js won't know about this behavior

**Better approach:** Add an event/listener system to the `Mode` class in `src/utils/mode.js`:
```javascript
// In Mode class:
constructor() {
    this.listeners = [];
}

addModeChangeListener(callback) {
    this.listeners.push(callback);
}

setMode(newMode, rewritePrevious = false) {
    // existing logic...
    this.listeners.forEach(cb => cb(newMode, rewritePrevious));
}

// In main.js:
mode.addModeChangeListener((newMode) => {
    syncAnnotationTabWithMode(newMode);
});
```

---

### 5. Hardcoded Magic Numbers (CSS/JS Sync Issue)

**File:** `src/main.js` (lines 388-391)

**Problem:** Layout dimensions are hardcoded and must match CSS:
```javascript
function updateRendererSize() {
    const navbarHeight = 64; // Match CSS --navbar-height
    const sidebarWidth = 380; // Match CSS --sidebar-width
```

**Why this is bad:**
- If CSS changes, JS won't automatically update
- Easy to forget to update both places
- Comments say "match CSS" but there's no enforcement

**Fix options:**

Option A - Read from CSS custom properties:
```javascript
function updateRendererSize() {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const navbarHeight = parseInt(styles.getPropertyValue('--navbar-height')) || 64;
    const sidebarWidth = parseInt(styles.getPropertyValue('--sidebar-width')) || 380;
```

Option B - Read actual element dimensions:
```javascript
function updateRendererSize() {
    const navbar = document.querySelector('.navbar');
    const sidebar = document.getElementById('sideMenu');
    const navbarHeight = navbar?.offsetHeight || 64;
    const sidebarWidth = sidebar?.offsetWidth || 380;
```

---

### 6. Session State Tracking Fragility

**File:** `src/components/modelPanel.js`

**Problem:** Session state (`has_data`) is manually tracked and can become out of sync:
```javascript
if (loadResult && loadResult.success) {
    this.currentSession.has_data = true;
    this.currentSession.current_filename = cloudMeshInfo.meshId;
}
```

If an error occurs after this flag is set, or if the server-side session expires, the client thinks it has data when it doesn't.

**Fix:** Consider:
1. Always verify session state with server before operations
2. Add a `verifySession()` method that checks server-side state
3. Clear session state on any error that might invalidate it

---

### 7. History Listener Memory Leak Potential

**File:** `src/evaluation/EvaluationManager.js` (lines 77-93)

**Problem:** The listener added in `_setupHistoryListener()` is never removed:
```javascript
_setupHistoryListener() {
    this.meshObject.history.addListener((history) => {
        // ... listener logic
    });
}
```

**Impact:** If `EvaluationManager` is recreated (e.g., when loading a new mesh), old listeners accumulate.

**Fix:** Store listener reference and add cleanup method:
```javascript
_setupHistoryListener() {
    this._historyListenerCallback = (history) => {
        // ... listener logic
    };
    this.meshObject.history.addListener(this._historyListenerCallback);
}

dispose() {
    if (this._historyListenerCallback) {
        this.meshObject.history.removeListener(this._historyListenerCallback);
    }
}
```

Also ensure `ActionHistory` has a `removeListener` method.

---

## Low Priority Issues

### 8. Repeated DOM Queries in `syncAnnotationTabWithMode`

**File:** `src/main.js` (lines 149-175)

**Problem:** DOM elements are queried every time mode changes:
```javascript
function syncAnnotationTabWithMode(mode) {
    const edgeTab = document.querySelector('.mode-tab[data-mode="edges"]');
    const arrowTab = document.querySelector('.mode-tab[data-mode="arrows"]');
    const edgeSection = document.getElementById('edgeAnnotationSection');
    // ... etc
```

**Fix:** Cache elements at initialization:
```javascript
// At top of file or in init function
const annotationElements = {
    edgeTab: null,
    arrowTab: null,
    edgeSection: null,
    arrowSection: null,
    segmentSection: null
};

function initAnnotationElements() {
    annotationElements.edgeTab = document.querySelector('.mode-tab[data-mode="edges"]');
    annotationElements.arrowTab = document.querySelector('.mode-tab[data-mode="arrows"]');
    // ... etc
}

function syncAnnotationTabWithMode(mode) {
    const { edgeTab, arrowTab, edgeSection, arrowSection, segmentSection } = annotationElements;
    if (!edgeTab || !arrowTab) return;
    // ... rest of function
}
```

---

### 9. Very Long Files Need Refactoring

**Files to split:**

1. **`src/components/cloudStoragePanel.js` (1319 lines)**
   - Extract: `CloudMeshUploader` - handles mesh file uploads
   - Extract: `CloudStateManager` - handles annotation state CRUD
   - Extract: `SaveAnnotationModal` - modal UI and logic
   - Keep: `CloudStoragePanel` as coordinator

2. **`src/components/renderingPanel.js` (800 lines)**
   - Extract: `LightingController` - lighting presets and controls
   - Extract: `MaterialController` - material type and PBR settings
   - Keep: `RenderingPanel` as coordinator

3. **`index.html` (1159 lines)**
   - Consider: Move panel HTML to JavaScript templates
   - Or: Use a build-time HTML include system
   - Or: Generate panels dynamically from configuration

---

### 10. Duplicate setStatus/setLoading Patterns

**Files:**
- `src/components/cloudStoragePanel.js` (lines 1283-1317)
- `src/components/modelPanel.js` (lines 453-489)

**Problem:** Nearly identical implementations of status display and loading state management.

**Fix:** Create a shared utility or mixin:
```javascript
// src/utils/PanelStatusMixin.js
export const PanelStatusMixin = {
    setStatus(statusEl, message, type = 'info') {
        if (!statusEl) return;
        const icons = {
            info: 'fa-info-circle',
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle'
        };
        statusEl.innerHTML = `<i class="fas ${icons[type]}"></i> <span>${message}</span>`;
        statusEl.className = `status ${type}`;
    },
    
    setLoading(buttons, loading, loadingText, normalText) {
        buttons.forEach(btn => {
            if (btn) btn.disabled = loading;
        });
        // ... etc
    }
};
```

---

### 11. Legacy/Dead Code in index.html

**File:** `index.html` (lines 482-484)

```html
<!-- Hidden legacy panels for JS compatibility -->
<div id="drawPanel" class="panel hidden" style="display: none !important;"></div>
<div id="arrowPanel" class="panel hidden" style="display: none !important;"></div>
```

**Action needed:**
1. Search codebase for references to `drawPanel` and `arrowPanel`
2. If no references exist, remove these elements
3. If references exist, update code to use new panel structure and then remove

---

### 12. Console.log Statements in Production Code

**Problem:** Many debug statements throughout the codebase:
```javascript
console.log('[CloudStorage] Cloud connection set:', this.cloudMeshInfo);
console.log('[ModelPanel] Connection status changed');
console.log('[UserConfig] Loaded configuration from localStorage');
```

**Fix options:**

Option A - Use a debug flag:
```javascript
const DEBUG = process.env.NODE_ENV !== 'production';
if (DEBUG) console.log('[CloudStorage] Cloud connection set:', this.cloudMeshInfo);
```

Option B - Create a logger utility:
```javascript
// src/utils/logger.js
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = process.env.NODE_ENV === 'production' ? LOG_LEVELS.warn : LOG_LEVELS.debug;

export const logger = {
    debug: (...args) => currentLevel <= LOG_LEVELS.debug && console.log(...args),
    info: (...args) => currentLevel <= LOG_LEVELS.info && console.log(...args),
    warn: (...args) => currentLevel <= LOG_LEVELS.warn && console.warn(...args),
    error: (...args) => console.error(...args),
};
```

---

### 13. Inconsistent JSDoc Coverage

**Problem:** Some methods have detailed JSDoc, others have none. This makes the codebase harder to understand and IDE autocompletion less useful.

**Files needing JSDoc improvement:**
- `src/main.js` - Most functions lack documentation
- `src/components/uiSetup.js` - Missing parameter and return type docs
- `src/components/historyPanel.js` - Private methods undocumented

**Standard to follow:**
```javascript
/**
 * Brief description of what the method does.
 * 
 * @param {Type} paramName - Description of parameter
 * @returns {Type} Description of return value
 * @throws {ErrorType} When this error occurs
 */
```

---

### 14. No Input Validation on User-Provided Names

**Problem:** Annotation names from user input are used without sanitization:
```javascript
const annotationName = this.saveAnnotationName.value.trim();
// ... later used in DOM or sent to server
```

**Potential issues:**
- XSS if name is rendered as innerHTML
- Server-side issues if special characters aren't handled

**Fix:** Sanitize or validate input:
```javascript
function sanitizeName(name) {
    // Remove HTML tags
    const div = document.createElement('div');
    div.textContent = name;
    return div.innerHTML;
}
```

---

## Architectural Recommendations (Future Work)

### A. Consider an Event Bus Pattern

Multiple components need to communicate:
- ConnectionManager ↔ CloudStoragePanel
- ConnectionManager ↔ ModelPanel
- EvaluationManager ↔ HistoryPanel
- MeshObject ↔ Multiple panels

Currently using direct references and method calls. An event bus would decouple these:
```javascript
// eventBus.js
class EventBus {
    constructor() {
        this.listeners = new Map();
    }
    on(event, callback) { /* ... */ }
    off(event, callback) { /* ... */ }
    emit(event, data) { /* ... */ }
}
export const eventBus = new EventBus();

// Usage:
eventBus.emit('connection:changed', { isConnected: true });
eventBus.on('connection:changed', (data) => { /* handle */ });
```

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
- [ ] (Future) Consider event bus for component communication
