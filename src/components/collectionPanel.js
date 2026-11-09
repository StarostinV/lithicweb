import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { confirmUnsavedChanges } from '../utils/confirmUnsavedChanges.js';

/**
 * Base URL of the published collection (catalogue.json + meshes + thumbs),
 * pinned to a repository revision so the catalogue and its files never drift.
 * Override with ?collection=<base url> for testing another build.
 */
export const DEFAULT_COLLECTION_URL =
    'https://huggingface.co/datasets/StarostinV/lithic-collection-preview/resolve/9c230c61ab9c7179cf442018791b03f79ad62984/';

const CACHE_NAME = 'lithic-collection-v1';

/**
 * Filter catalogue items by free text, site and type.
 *
 * @param {Array<Object>} items - Catalogue items
 * @param {Object} filters
 * @param {string} [filters.text] - Matches id, type, site name, unit, raw material
 * @param {string} [filters.site] - Site id, or '' for all
 * @param {string} [filters.type] - Artifact type, or '' for all
 * @param {number|null} [filters.timeKa] - Keep sites whose dating range contains this age
 * @param {Map<string,Object>} [sites] - Site id -> site, for name matching
 * @returns {Array<Object>}
 */
export function filterItems(items, { text = '', site = '', type = '', timeKa = null } = {}, sites = new Map()) {
    const needle = text.trim().toLowerCase();
    return items.filter(item => {
        if (site && item.site !== site) return false;
        if (type && item.type !== type) return false;
        if (timeKa != null && !siteCoversTime(sites.get(item.site), timeKa)) return false;
        if (!needle) return true;
        const hay = [item.id, item.type, sites.get(item.site)?.name, item.unit, item.rawMaterial, item.dataset]
            .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(needle);
    });
}

/**
 * Whether a site's dating range [older, younger] (ka) contains an age.
 * @param {Object} site
 * @param {number} timeKa
 * @returns {boolean}
 */
export function siteCoversTime(site, timeKa) {
    const r = site?.datingKa;
    return Array.isArray(r) && timeKa <= r[0] && timeKa >= r[1];
}

/**
 * Human-readable byte size.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
    return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * CollectionPanel - browse a published collection of annotated meshes on a
 * map and in a filterable list, and load any of them into the viewer.
 *
 * The map is shown over the 3D view while the panel is open; loading a mesh
 * switches back to the 3D view (the map can be reopened from the panel).
 */
export class CollectionPanel {
    /**
     * @param {Object} deps
     * @param {MeshLoader} deps.meshLoader
     * @param {MeshView} deps.meshView
     * @param {LibraryPanel} [deps.libraryPanel] - Used to save unsaved work first
     */
    constructor({ meshLoader, meshView, libraryPanel = null }) {
        this.meshLoader = meshLoader;
        this.meshView = meshView;
        this.libraryPanel = libraryPanel;

        const param = new URLSearchParams(window.location.search).get('collection');
        this.baseUrl = (param || DEFAULT_COLLECTION_URL).replace(/\/?$/, '/');
        // Timeline variant under evaluation: 'tags' (default) or 'lines'
        this.timelineVariant = new URLSearchParams(window.location.search).get('timeline') === 'lines' ? 'lines' : 'tags';

        this.catalogue = null;
        this.sites = new Map();
        this.filters = { text: '', site: '', type: '', timeKa: null };
        this.loadingId = null;
        this.activeId = null;
        this.map = null;
        this.markers = new Map();
        this.visible = false;

        this.el = {
            list: document.getElementById('collectionList'),
            count: document.getElementById('collectionCount'),
            status: document.getElementById('collectionStatus'),
            search: document.getElementById('collectionSearch'),
            site: document.getElementById('collectionSiteFilter'),
            type: document.getElementById('collectionTypeFilter'),
            sources: document.getElementById('collectionSources'),
            overlay: document.getElementById('collectionMapOverlay'),
            mapDiv: document.getElementById('collectionMap'),
            showMap: document.getElementById('collectionShowMapBtn'),
            hideMap: document.getElementById('collectionHideMapBtn'),
            timeline: document.getElementById('collectionTimeline'),
            labelsToggle: document.getElementById('collectionLabelsToggle'),
        };

        this.el.search?.addEventListener('input', () => {
            this.filters.text = this.el.search.value;
            this._renderList();
        });
        this.el.site?.addEventListener('change', () => this._setSite(this.el.site.value));
        this.el.type?.addEventListener('change', () => {
            this.filters.type = this.el.type.value;
            this._renderList();
        });
        this.el.showMap?.addEventListener('click', () => this._setMapVisible(true));
        this.el.hideMap?.addEventListener('click', () => this._setMapVisible(false));
        this.el.labelsToggle?.addEventListener('change', () => {
            this.el.overlay?.classList.toggle('labels-hidden', !this.el.labelsToggle.checked);
            if (this.el.labelsToggle.checked) this._layoutLabels();
        });
    }

    /** Called when the Collection tab is opened. */
    async onShow() {
        this.visible = true;
        if (!this.catalogue) {
            await this._loadCatalogue();
        }
        // Open on the map until a mesh has been loaded from the collection
        this._setMapVisible(!this.activeId);
    }

    /** Called when another tab is opened. */
    onHide() {
        this.visible = false;
        this._setMapVisible(false);
    }

    // ------------------------------------------------------------------
    // Catalogue
    // ------------------------------------------------------------------

    async _loadCatalogue() {
        this._setStatus('Loading catalogue…');
        try {
            const res = await fetch(this.baseUrl + 'catalogue.json');
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            this.catalogue = await res.json();
        } catch (err) {
            this._setStatus(`Could not load the collection catalogue (${err.message}).`, 'error');
            return;
        }
        this.sites = new Map(this.catalogue.sites.map(s => [s.id, s]));
        this._setStatus('');
        this._fillFilters();
        this._renderSources();
        this._renderList();
        this._buildMap();
        this._renderTimeline();
    }

    _fillFilters() {
        const items = this.catalogue.items;
        const count = (key, value) => items.filter(i => i[key] === value).length;
        if (this.el.site) {
            this.el.site.innerHTML = '<option value="">All sites</option>' + this.catalogue.sites
                .map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${count('site', s.id)})</option>`)
                .join('');
        }
        if (this.el.type) {
            const types = [...new Set(items.map(i => i.type))].sort();
            this.el.type.innerHTML = '<option value="">All types</option>' + types
                .map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)} (${count('type', t)})</option>`)
                .join('');
        }
    }

    _renderSources() {
        if (!this.el.sources) return;
        this.el.sources.innerHTML = this.catalogue.sites.map(s => `
            <li>
                <a href="https://doi.org/${escapeHtml(s.source.doi)}" target="_blank" rel="noopener">${escapeHtml(s.source.title)}</a>
                <span>${escapeHtml(s.source.authors)} · ${escapeHtml(s.source.license)}</span>
            </li>`).join('');
    }

    _setSite(siteId) {
        this.filters.site = siteId;
        if (this.el.site) this.el.site.value = siteId;
        this._renderList();
        this._updateMarkers();
        this._updateTimeline();
    }

    // ------------------------------------------------------------------
    // List
    // ------------------------------------------------------------------

    _renderList() {
        if (!this.catalogue || !this.el.list) return;
        const items = filterItems(this.catalogue.items, this.filters, this.sites);
        if (this.el.count) {
            this.el.count.textContent = `${items.length} of ${this.catalogue.items.length} artifacts`;
        }
        this.el.list.innerHTML = items.map(item => this._itemHtml(item)).join('')
            || '<p class="collection-empty">No artifacts match these filters.</p>';
        this.el.list.querySelectorAll('.collection-item').forEach(card => {
            const id = card.dataset.id;
            card.addEventListener('click', () => this.load(id));
            card.addEventListener('mouseenter', () => this._highlightSite(card.dataset.site, true));
            card.addEventListener('mouseleave', () => this._highlightSite(card.dataset.site, false));
        });
    }

    _itemHtml(item) {
        const site = this.sites.get(item.site);
        const details = [
            item.scars != null ? `${item.scars} scars` : null,
            `${Math.round(item.vertices / 1000)}k vertices`,
            formatBytes(item.bytes),
        ].filter(Boolean).join(' · ');
        const extra = [
            item.unit ? `unit ${item.unit}` : null,
            item.rawMaterial, item.blank && item.blank !== item.type ? item.blank : null,
            item.dimensionsMm?.length === 3 ? `${item.dimensionsMm.map(v => v.toFixed(1)).join(' × ')} mm` : null,
        ].filter(Boolean).join(' · ');
        const thumb = item.thumb
            ? `<img src="${escapeHtml(this.baseUrl + item.thumb)}" alt="" loading="lazy">`
            : '<i class="fas fa-cube"></i>';
        const state = item.id === this.loadingId ? ' loading' : item.id === this.activeId ? ' active' : '';
        return `
            <button type="button" class="collection-item${state}" data-id="${escapeHtml(item.id)}" data-site="${escapeHtml(item.site)}">
                <div class="collection-thumb">${thumb}</div>
                <div class="collection-item-body">
                    <div class="collection-item-title">
                        <span class="collection-item-id">${escapeHtml(item.id)}</span>
                        <span class="collection-type">${escapeHtml(item.type)}</span>
                    </div>
                    <div class="collection-item-site">${escapeHtml(site?.name || item.site)}</div>
                    <div class="collection-item-details">${escapeHtml(details)}</div>
                    ${extra ? `<div class="collection-item-extra">${escapeHtml(extra)}</div>` : ''}
                    <div class="collection-progress"><div class="collection-progress-fill"></div></div>
                </div>
            </button>`;
    }

    _setStatus(message, kind = 'info') {
        if (!this.el.status) return;
        this.el.status.textContent = message;
        this.el.status.className = `collection-status ${message ? kind : ''}`;
    }

    // ------------------------------------------------------------------
    // Map
    // ------------------------------------------------------------------

    _buildMap() {
        if (!this.el.mapDiv || this.map) return;
        this.map = L.map(this.el.mapDiv, { zoomControl: true, worldCopyJump: true, zoomSnap: 0.25 });
        this.map.on('zoomend resize', () => this._layoutLabels());
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(this.map);

        const located = this.catalogue.sites.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
        for (const site of located) {
            const n = this.catalogue.items.filter(i => i.site === site.id).length;
            const marker = L.marker([site.lat, site.lon], {
                icon: L.divIcon({
                    className: 'collection-marker',
                    html: this.timelineVariant === 'lines'
                        ? `<span style="background:${this._siteColor(site.id)}">${n}</span>`
                        : `<span>${n}</span>`,
                    iconSize: [34, 34],
                    iconAnchor: [17, 17],
                }),
                title: site.name,
            }).addTo(this.map);
            // Always-visible site label next to the marker
            marker.bindTooltip(
                `<strong>${escapeHtml(site.name)}</strong>${site.period ? `<span>${escapeHtml(site.period)}</span>` : ''}`,
                { permanent: true, direction: 'right', offset: [20, 0], className: 'collection-site-label', interactive: true });
            marker.getTooltip().on('click', () => marker.openPopup());
            marker.bindPopup(this._sitePopupHtml(site, n), { maxWidth: 300 });
            marker.on('click', () => this._setSite(site.id));
            this.markers.set(site.id, marker);
        }
        this._bounds = located.length ? L.latLngBounds(located.map(s => [s.lat, s.lon])) : null;
        this._fitted = false;
        this.map.setView([45, 10], 4);
        this._updateMarkers();
    }

    /**
     * Put each site label right of its marker, or left when that would
     * overlap an already placed label or leave the map (top to bottom, greedy).
     */
    _layoutLabels() {
        if (!this.map) return;
        const size = this.map.getSize();
        const placed = [];
        const entries = [...this.markers.values()]
            .map(marker => ({ marker, p: this.map.latLngToContainerPoint(marker.getLatLng()) }))
            .sort((a, b) => a.p.y - b.p.y);
        for (const { marker, p } of entries) {
            const tip = marker.getTooltip();
            const el = tip?.getElement();
            if (!el || !el.offsetWidth) continue;
            const w = el.offsetWidth, h = el.offsetHeight, gap = 20;
            const rect = dir => ({
                x0: dir === 'right' ? p.x + gap : p.x - gap - w,
                x1: dir === 'right' ? p.x + gap + w : p.x - gap,
                y0: p.y - h / 2, y1: p.y + h / 2,
            });
            const fits = r => r.x0 >= 0 && r.x1 <= size.x
                && !placed.some(q => r.x0 < q.x1 && q.x0 < r.x1 && r.y0 < q.y1 && q.y0 < r.y1);
            const dir = ['right', 'left'].find(d => fits(rect(d))) || 'right';
            placed.push(rect(dir));
            if (tip.options.direction !== dir) {
                tip.options.direction = dir;
                tip.options.offset = [dir === 'right' ? gap : -gap, 0];
                tip.update();
            }
        }
    }

    _sitePopupHtml(site, n) {
        const rows = [
            site.region,
            site.period,
            site.dating,
            `${n} artifact${n === 1 ? '' : 's'} in this collection`,
        ].filter(Boolean).map(r => `<div>${escapeHtml(r)}</div>`).join('');
        const approx = site.coordinates?.startsWith('approximate')
            ? '<div class="collection-popup-note">Location approximate</div>' : '';
        return `
            <div class="collection-popup">
                <strong>${escapeHtml(site.name)}</strong>
                ${rows}${approx}
                <a href="https://doi.org/${escapeHtml(site.source.doi)}" target="_blank" rel="noopener">Source data (${escapeHtml(site.source.license)})</a>
            </div>`;
    }

    _updateMarkers() {
        for (const [id, marker] of this.markers) {
            const selected = id === this.filters.site;
            const dimmed = (!!this.filters.site && !selected)
                || (this.filters.timeKa != null && !siteCoversTime(this.sites.get(id), this.filters.timeKa));
            for (const el of [marker.getElement(), marker.getTooltip()?.getElement()]) {
                el?.classList.toggle('selected', selected);
                el?.classList.toggle('dimmed', dimmed);
            }
        }
    }

    _highlightSite(siteId, on) {
        const marker = this.markers.get(siteId);
        marker?.getElement()?.classList.toggle('hover', on);
        marker?.getTooltip()?.getElement()?.classList.toggle('hover', on);
        this.el.timeline?.querySelectorAll(`[data-site="${CSS.escape(siteId)}"]`)
            .forEach(e => e.classList.toggle('hover', on));
    }

    // ------------------------------------------------------------------
    // Timeline
    // ------------------------------------------------------------------

    /**
     * Dating timeline on one shared ka cal BP axis (older on the left).
     * Two variants, chosen with ?timeline=tags|lines while we compare them:
     * - tags: a translucent band per dated site, overlaps read darker, and a
     *   small name tag above each band's midpoint (stacked when they collide);
     * - lines: a thin coloured line per site, packed into lanes that are
     *   reused when ranges do not overlap; map markers take the same colours.
     * Hovering an age highlights the sites covering it; clicking pins the age
     * as a filter.
     */
    _renderTimeline() {
        const el = this.el.timeline;
        if (!el || !this.catalogue) return;
        const sites = this.catalogue.sites;
        const dated = sites.filter(s => Array.isArray(s.datingKa));
        if (!dated.length) {
            el.hidden = true;
            return;
        }
        const step = 5;
        this._axis = {
            oldest: Math.ceil(Math.max(...dated.map(s => s.datingKa[0])) / step) * step,
            youngest: Math.floor(Math.min(...dated.map(s => s.datingKa[1])) / step) * step,
        };
        const pct = ka => this._kaToPct(ka);
        const left = s => pct(s.datingKa[0]);
        const width = s => Math.max(0.8, pct(s.datingKa[1]) - pct(s.datingKa[0]));
        const ticks = [];
        for (let ka = this._axis.oldest; ka >= this._axis.youngest; ka -= step) {
            ticks.push(`<span class="collection-timeline-tick" style="left:${pct(ka)}%">${ka}</span>`);
        }

        let plotHtml;
        let tagsHtml = '';
        if (this.timelineVariant === 'lines') {
            // Greedy lane packing, left (older) to right; a lane is free once
            // its last range has ended (with a small gap)
            const lanes = [];
            const laneOf = new Map();
            for (const s of [...dated].sort((x, y) => y.datingKa[0] - x.datingKa[0])) {
                let lane = lanes.findIndex(end => end - 0.3 >= s.datingKa[0]);
                if (lane < 0) { lane = lanes.length; lanes.push(0); }
                lanes[lane] = s.datingKa[1];
                laneOf.set(s.id, lane);
            }
            plotHtml = dated.map(s => `
                <span class="collection-timeline-range collection-timeline-line" data-site="${escapeHtml(s.id)}"
                      style="left:${left(s)}%;width:${width(s)}%;top:${4 + laneOf.get(s.id) * 9}px;--site-color:${this._siteColor(s.id)}"></span>`).join('');
            this._plotHeight = 8 + lanes.length * 9;
        } else {
            plotHtml = dated.map(s => `
                <span class="collection-timeline-range collection-timeline-band" data-site="${escapeHtml(s.id)}"
                      style="left:${left(s)}%;width:${width(s)}%"></span>`).join('');
            tagsHtml = `<div class="collection-timeline-tags">${dated.map(s => `
                <button type="button" class="collection-timeline-tag" data-site="${escapeHtml(s.id)}"
                        style="left:${left(s) + width(s) / 2}%">${escapeHtml(this._shortName(s))}</button>`).join('')}</div>`;
            this._plotHeight = 22;
        }

        const undated = sites.filter(s => !Array.isArray(s.datingKa)).map(s => s.name);
        el.innerHTML = `
            <div class="collection-timeline-head">
                <span class="collection-timeline-title">Dating <span>ka cal BP</span></span>
                <span class="collection-timeline-readout"></span>
            </div>
            ${tagsHtml}
            <div class="collection-timeline-plot collection-timeline-${this.timelineVariant}" style="height:${this._plotHeight}px">
                ${plotHtml}
                <span class="collection-timeline-cursor hover-cursor"></span>
                <span class="collection-timeline-cursor pinned-cursor"></span>
            </div>
            <div class="collection-timeline-ticks">${ticks.join('')}</div>
            ${undated.length ? `<div class="collection-timeline-note">Undated: ${escapeHtml(undated.join(', '))}</div>` : ''}`;

        const plot = el.querySelector('.collection-timeline-plot');
        const kaAt = ev => {
            const r = plot.getBoundingClientRect();
            const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
            return Math.round((this._axis.oldest - f * (this._axis.oldest - this._axis.youngest)) * 10) / 10;
        };
        plot.addEventListener('mousemove', ev => this._previewTime(kaAt(ev)));
        plot.addEventListener('mouseleave', () => this._previewTime(null));
        plot.addEventListener('click', ev => this._setTime(kaAt(ev)));
        el.querySelectorAll('.collection-timeline-tag').forEach(tag => {
            const id = tag.dataset.site;
            tag.addEventListener('mouseenter', () => this._highlightSite(id, true));
            tag.addEventListener('mouseleave', () => this._highlightSite(id, false));
            tag.addEventListener('click', () => this._setSite(this.filters.site === id ? '' : id));
        });
        el.querySelector('.collection-timeline-readout').addEventListener('click', ev => {
            if (ev.target.closest('.collection-timeline-clear')) this._setTime(null);
        });
        this._layoutTags();
        this._updateTimeline();
    }

    /** Stack tags that would overlap into rows above the band track. */
    _layoutTags() {
        const box = this.el.timeline?.querySelector('.collection-timeline-tags');
        if (!box) return;
        const tags = [...box.querySelectorAll('.collection-timeline-tag')];
        const width = box.clientWidth;
        if (!width) return;   // not laid out yet (map hidden); redone on show
        const rows = [];
        tags.map(tag => {
            const center = parseFloat(tag.style.left) / 100 * width;
            return { tag, x0: center - tag.offsetWidth / 2 - 3, x1: center + tag.offsetWidth / 2 + 3 };
        }).sort((p, q) => p.x0 - q.x0).forEach(t => {
            let row = rows.findIndex(end => end <= t.x0);
            if (row < 0) { row = rows.length; rows.push(0); }
            rows[row] = t.x1;
            t.tag.style.bottom = `${row * 18}px`;
        });
        box.style.height = `${Math.max(1, rows.length) * 18}px`;
    }

    _shortName(site) {
        return site.name.replace(/^(Grotta|Riparo) (di |della |del |dei )?/, '');
    }

    _siteColor(siteId) {
        const palette = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#8b5cf6'];
        const i = this.catalogue.sites.findIndex(s => s.id === siteId);
        return palette[(i < 0 ? 0 : i) % palette.length];
    }

    _kaToPct(ka) {
        const { oldest, youngest } = this._axis;
        return ((oldest - ka) / (oldest - youngest)) * 100;
    }

    _sitesAt(timeKa) {
        return this.catalogue.sites.filter(s => siteCoversTime(s, timeKa));
    }

    /** Hover preview: cursor, readout, and highlighted sites. */
    _previewTime(timeKa) {
        const el = this.el.timeline;
        if (!el) return;
        const cursor = el.querySelector('.hover-cursor');
        for (const s of this.catalogue.sites) this._highlightSite(s.id, false);
        if (timeKa == null) {
            cursor.style.display = 'none';
            this._updateTimeline();
            return;
        }
        cursor.style.display = 'block';
        cursor.style.left = `${this._kaToPct(timeKa)}%`;
        const here = this._sitesAt(timeKa);
        here.forEach(s => this._highlightSite(s.id, true));
        this._setReadout(timeKa, here, false);
    }

    /** Pin (or clear, with null) an age as a filter. */
    _setTime(timeKa) {
        this.filters.timeKa = timeKa;
        this._renderList();
        this._updateMarkers();
        this._updateTimeline();
    }

    _setReadout(timeKa, sites, pinned) {
        const readout = this.el.timeline?.querySelector('.collection-timeline-readout');
        if (!readout) return;
        if (timeKa == null) {
            readout.innerHTML = '';
            return;
        }
        const names = sites.length ? sites.map(s => this._shortName(s)).join(', ') : 'no dated site';
        readout.innerHTML = `≈${timeKa.toFixed(1)} ka · ${escapeHtml(names)}`
            + (pinned ? ' <button type="button" class="collection-timeline-clear" title="Clear time filter">×</button>' : '');
    }

    _updateTimeline() {
        const el = this.el.timeline;
        if (!el || !this._axis) return;
        const t = this.filters.timeKa;
        el.querySelectorAll('.collection-timeline-range, .collection-timeline-tag').forEach(band => {
            const id = band.dataset.site;
            const site = this.sites.get(id);
            band.classList.toggle('selected', id === this.filters.site);
            band.classList.toggle('dimmed', (!!this.filters.site && id !== this.filters.site)
                || (t != null && !siteCoversTime(site, t)));
        });
        const pinned = el.querySelector('.pinned-cursor');
        pinned.style.display = t == null ? 'none' : 'block';
        if (t != null) pinned.style.left = `${this._kaToPct(t)}%`;
        this._setReadout(t, t == null ? [] : this._sitesAt(t), true);
    }

    _setMapVisible(show) {
        const show_ = show && this.visible;
        this.el.overlay?.classList.toggle('visible', show_);
        // Hide the 3D view's floating tools while the map covers it
        document.body.classList.toggle('collection-map-open', show_);
        this.el.showMap?.classList.toggle('hidden', show_ || !this.visible);
        if (show_ && this.map) {
            // The container was hidden; Leaflet must re-measure it, and the
            // first fit can only happen once it has a size
            requestAnimationFrame(() => {
                this.map.invalidateSize();
                if (!this._fitted && this._bounds) {
                    // Keep sites clear of the timeline panel in the bottom-left corner
                    const panel = this.el.overlay?.querySelector('.collection-map-controls');
                    const below = panel ? panel.offsetHeight + 40 : 80;
                    this.map.fitBounds(this._bounds, {
                        paddingTopLeft: [80, 80], paddingBottomRight: [80, below], maxZoom: 8,
                    });
                    this._fitted = true;
                }
                this._layoutLabels();
                this._layoutTags();
            });
        }
    }

    // ------------------------------------------------------------------
    // Loading
    // ------------------------------------------------------------------

    /**
     * Download (or take from cache) one artifact and open it in the viewer.
     * @param {string} id - Catalogue item id
     */
    async load(id) {
        const item = this.catalogue?.items.find(i => i.id === id);
        if (!item || this.loadingId) return;

        const unsaved = await confirmUnsavedChanges(this.meshView);
        if (unsaved === 'cancel') return;
        if (unsaved === 'save' && this.libraryPanel) {
            await this.libraryPanel.saveCurrentAnnotation();
        }

        this.loadingId = id;
        this._renderList();
        this._setStatus(`Loading ${id} (${formatBytes(item.bytes)})…`);
        try {
            const blob = await this._fetchWithCache(this.baseUrl + item.file, item.bytes,
                fraction => this._setProgress(id, fraction));
            const fileName = `${item.id}.ply`;
            await this.meshLoader.loadFile(new File([blob], fileName, { type: 'application/octet-stream' }));
            // Start from the side that shows the most annotation (chosen when building the collection)
            if (item.view) {
                this.meshView.scene?.resetCamera?.(item.view);
                this.meshView.scene?.updateLightFromCamera?.();   // light the side we look at
            }
            const fileNameSpan = document.getElementById('fileName');
            if (fileNameSpan) {
                fileNameSpan.textContent = fileName;
                fileNameSpan.title = fileName;
            }
            this.activeId = id;
            this._setStatus('');
            this._setMapVisible(false);
        } catch (err) {
            console.error('[Collection] Failed to load', id, err);
            this._setStatus(`Could not load ${id} (${err.message}).`, 'error');
        } finally {
            this.loadingId = null;
            this._renderList();
        }
    }

    _setProgress(id, fraction) {
        const fill = this.el.list?.querySelector(`.collection-item[data-id="${CSS.escape(id)}"] .collection-progress-fill`);
        if (fill) fill.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
    }

    /**
     * Fetch a file, reporting progress, and keep it in the browser cache.
     * The base URL is pinned to a revision, so cached files never go stale.
     */
    async _fetchWithCache(url, expectedBytes, onProgress) {
        let cache = null;
        try {
            cache = await caches.open(CACHE_NAME);
            const hit = await cache.match(url);
            if (hit) {
                onProgress(1);
                return await hit.blob();
            }
        } catch {
            cache = null;   // Cache API unavailable (private window, insecure origin)
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const total = Number(res.headers.get('content-length')) || expectedBytes || 0;
        const reader = res.body?.getReader();
        let blob;
        if (!reader) {
            blob = await res.blob();
        } else {
            const chunks = [];
            let received = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;
                if (total) onProgress(received / total);
            }
            blob = new Blob(chunks);
        }
        onProgress(1);
        try {
            await cache?.put(url, new Response(blob));
        } catch {
            // Quota exceeded or similar: loading still succeeded
        }
        return blob;
    }
}
