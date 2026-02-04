/**
 * UI Setup Module
 * 
 * Handles initialization of UI components that don't require
 * the main application state (mode, meshView, etc.)
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
 * Initialize mobile navigation hamburger menu.
 */
function initMobileNavigation() {
    const hamburger = document.getElementById('navbarHamburger');
    const mobileMenu = document.getElementById('navbarMobileMenu');
    const mobileNavBtns = document.querySelectorAll('.mobile-nav-btn');
    
    if (!hamburger || !mobileMenu) return;
    
    // Toggle mobile menu
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        mobileMenu.classList.toggle('open');
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
            hamburger.classList.remove('active');
            mobileMenu.classList.remove('open');
        }
    });
    
    // Handle mobile navigation button clicks
    mobileNavBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;
            if (!panelId) return;
            
            // Find and click the corresponding desktop nav button
            const desktopBtn = document.getElementById(panelId + 'Btn');
            if (desktopBtn) {
                desktopBtn.click();
            }
            
            // Update active state on mobile buttons
            mobileNavBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Close mobile menu
            hamburger.classList.remove('active');
            mobileMenu.classList.remove('open');
            
            // Make sure sidebar is visible when selecting a panel
            const sideMenu = document.getElementById('sideMenu');
            const canvasContainer = document.querySelector('.canvas-container');
            const sidebarShowBtn = document.getElementById('sidebarShowBtn');
            const sidebarToggleBtn = document.getElementById('sidebarToggle');
            
            if (sideMenu && sideMenu.classList.contains('sidebar-collapsed')) {
                sideMenu.classList.remove('sidebar-collapsed');
                canvasContainer?.classList.remove('canvas-fullscreen');
                sidebarShowBtn?.classList.remove('visible');
                sidebarToggleBtn?.classList.remove('sidebar-hidden');
                document.body.classList.remove('sidebar-collapsed');
                localStorage.setItem('lithicjs_sidebar_collapsed', 'false');
                // Trigger resize to update Three.js canvas
                window.dispatchEvent(new Event('resize'));
            }
        });
    });
    
    // Sync mobile nav active state when desktop buttons are clicked
    const desktopNavBtns = document.querySelectorAll('.navbar-center .nav-btn');
    desktopNavBtns.forEach(desktopBtn => {
        desktopBtn.addEventListener('click', () => {
            // Extract panel ID from button ID (e.g., 'viewPanelBtn' -> 'viewPanel')
            const panelId = desktopBtn.id.replace('Btn', '');
            
            // Find matching mobile button and update active state
            mobileNavBtns.forEach(mobileBtn => {
                if (mobileBtn.dataset.panel === panelId) {
                    mobileNavBtns.forEach(b => b.classList.remove('active'));
                    mobileBtn.classList.add('active');
                }
            });
        });
    });
    
    // Set initial active state based on initially visible panel
    const initialActiveBtn = document.querySelector('.navbar-center .nav-btn.active');
    if (initialActiveBtn) {
        const panelId = initialActiveBtn.id.replace('Btn', '');
        const matchingMobileBtn = document.querySelector(`.mobile-nav-btn[data-panel="${panelId}"]`);
        if (matchingMobileBtn) {
            matchingMobileBtn.classList.add('active');
        }
    }
}

/**
 * Initialize sidebar toggle (show/hide) functionality.
 * When sidebar is hidden, the canvas expands to fill the full viewport.
 */
function initSidebarToggle() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarShowBtn = document.getElementById('sidebarShowBtn');
    const sideMenu = document.getElementById('sideMenu');
    const canvasContainer = document.querySelector('.canvas-container');
    const STORAGE_KEY_COLLAPSED = 'lithicjs_sidebar_collapsed';
    
    if (!sidebarToggle || !sideMenu) return;
    
    // Function to toggle sidebar
    function toggleSidebar(collapsed) {
        if (collapsed) {
            sideMenu.classList.add('sidebar-collapsed');
            canvasContainer?.classList.add('canvas-fullscreen');
            sidebarShowBtn?.classList.add('visible');
            sidebarToggle.classList.add('sidebar-hidden');
            document.body.classList.add('sidebar-collapsed');
        } else {
            sideMenu.classList.remove('sidebar-collapsed');
            canvasContainer?.classList.remove('canvas-fullscreen');
            sidebarShowBtn?.classList.remove('visible');
            sidebarToggle.classList.remove('sidebar-hidden');
            document.body.classList.remove('sidebar-collapsed');
        }
        
        // Save state
        localStorage.setItem(STORAGE_KEY_COLLAPSED, collapsed ? 'true' : 'false');
        
        // Trigger window resize to update Three.js canvas
        window.dispatchEvent(new Event('resize'));
    }
    
    // Load saved state
    const savedCollapsed = localStorage.getItem(STORAGE_KEY_COLLAPSED);
    if (savedCollapsed === 'true') {
        toggleSidebar(true);
    }
    
    // Toggle button in navbar
    sidebarToggle.addEventListener('click', () => {
        const isCollapsed = sideMenu.classList.contains('sidebar-collapsed');
        toggleSidebar(!isCollapsed);
    });
    
    // Floating show button
    if (sidebarShowBtn) {
        sidebarShowBtn.addEventListener('click', () => {
            toggleSidebar(false);
        });
    }
    
    // Keyboard shortcut to toggle sidebar: [ or ]
    document.addEventListener('keydown', (e) => {
        // Only if not in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        // Bracket key to toggle sidebar: [ or ]
        if (e.key === '[' || e.key === ']') {
            const isCollapsed = sideMenu.classList.contains('sidebar-collapsed');
            toggleSidebar(!isCollapsed);
        }
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
    initMobileNavigation();
    initSidebarToggle();
}
