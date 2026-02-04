/**
 * UI Setup Module
 * 
 * Handles initialization of UI components that don't require
 * the main application state (mode, meshObject, etc.)
 */

/**
 * Initialize the documentation modal with markdown content fetched from file.
 */
function initDocumentationModal() {
    const modal = document.getElementById('docModal');
    const btn = document.getElementById('showDoc');
    const closeBtn = document.getElementsByClassName('close')[0];
    const docContent = document.getElementById('docContent');

    // When the user clicks the button, open the modal
    btn.onclick = function() {
        modal.style.display = 'flex';
    };

    // When the user clicks on <span> (x), close the modal
    closeBtn.onclick = function() {
        modal.style.display = 'none';
    };

    // When the user clicks anywhere outside of the modal, close it
    window.addEventListener('click', function(event) {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });

    // Fetch and render markdown documentation
    fetch('docs/documentation.md')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load documentation: ${response.status}`);
            }
            return response.text();
        })
        .then(markdown => {
            // marked is loaded globally via CDN in index.html
            docContent.innerHTML = marked.parse(markdown);
        })
        .catch(error => {
            console.error('Failed to load documentation:', error);
            docContent.innerHTML = '<p>Failed to load documentation. Please try refreshing the page.</p>';
        });
}

/**
 * Initialize file input display (shows selected filename).
 */
function initFileInput() {
    document.getElementById('fileInput').addEventListener('change', (event) => {
        const fileNameSpan = document.getElementById('fileName');
        const file = event.target.files[0];
        if (file) {
            fileNameSpan.textContent = file.name;
        } else {
            fileNameSpan.textContent = '';
        }
    });
}

/**
 * Initialize sidebar resize functionality with localStorage persistence.
 */
function initSidebarResize() {
    const sideMenu = document.getElementById('sideMenu');
    const resizeHandle = document.getElementById('sideMenuResizeHandle');
    const STORAGE_KEY_WIDTH = 'lithicjs_sidebar_width';
    const MIN_WIDTH = 280;
    const MAX_WIDTH = 600;
    
    // Load saved width
    const savedWidth = localStorage.getItem(STORAGE_KEY_WIDTH);
    if (savedWidth) {
        const width = parseInt(savedWidth);
        if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
            sideMenu.style.width = width + 'px';
        }
    }
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    // Mouse events
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sideMenu.offsetWidth;
        resizeHandle.classList.add('dragging');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = startX - e.clientX;
        let newWidth = startWidth + deltaX;
        
        // Clamp to min/max
        newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        sideMenu.style.width = newWidth + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Save width to localStorage
            localStorage.setItem(STORAGE_KEY_WIDTH, sideMenu.offsetWidth);
        }
    });

    // Touch events for mobile support
    resizeHandle.addEventListener('touchstart', (e) => {
        isResizing = true;
        startX = e.touches[0].clientX;
        startWidth = sideMenu.offsetWidth;
        resizeHandle.classList.add('dragging');
        e.preventDefault();
    });
    
    document.addEventListener('touchmove', (e) => {
        if (!isResizing) return;
        
        const deltaX = startX - e.touches[0].clientX;
        let newWidth = startWidth + deltaX;
        newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        sideMenu.style.width = newWidth + 'px';
    });
    
    document.addEventListener('touchend', () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.classList.remove('dragging');
            localStorage.setItem(STORAGE_KEY_WIDTH, sideMenu.offsetWidth);
        }
    });
}

/**
 * Initialize annotation panel tab switching.
 */
function initAnnotationTabs() {
    const modeTabs = document.querySelectorAll('.mode-tab');
    const edgeSection = document.getElementById('edgeAnnotationSection');
    const arrowSection = document.getElementById('arrowAnnotationSection');
    
    modeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab
            modeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show corresponding section
            const tabMode = tab.dataset.mode;
            edgeSection.classList.toggle('hidden', tabMode !== 'edges');
            arrowSection.classList.toggle('hidden', tabMode !== 'arrows');
            
            // Trigger mode change via clicking the appropriate default tool button
            // This ensures the mode system is properly updated
            if (tabMode === 'edges') {
                const drawBtn = document.getElementById('drawMode');
                if (drawBtn) drawBtn.click();
            } else if (tabMode === 'arrows') {
                const arrowBtn = document.getElementById('arrowMode');
                if (arrowBtn) arrowBtn.click();
            }
        });
    });
}

/**
 * Initialize all UI components.
 * Call this after DOMContentLoaded.
 */
export function initUI() {
    initFileInput();
    initDocumentationModal();
    initSidebarResize();
    initAnnotationTabs();
}
