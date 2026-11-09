/**
 * Collection list filtering and size formatting.
 */
jest.mock('leaflet', () => ({}));
jest.mock('leaflet/dist/leaflet.css', () => ({}));
import { filterItems, formatBytes } from '../../../src/components/collectionPanel.js';

const items = [
    { id: 'RF.b_1', site: 'fumane', type: 'Blade', unit: 'A2', rawMaterial: 'Maiolica' },
    { id: 'RF.c_2', site: 'fumane', type: 'Bladelet core', unit: 'D3b', rawMaterial: 'Scaglia Rossa' },
    { id: 'CTC_3', site: 'castelcivita', type: 'Bladelet core' },
];
const sites = new Map([['fumane', { name: 'Grotta di Fumane' }], ['castelcivita', { name: 'Grotta di Castelcivita' }]]);
const ids = (r) => r.map(i => i.id);

test('no filters returns everything', () => {
    expect(ids(filterItems(items, {}, sites))).toEqual(['RF.b_1', 'RF.c_2', 'CTC_3']);
});

test('site and type filters combine', () => {
    expect(ids(filterItems(items, { site: 'fumane', type: 'Bladelet core' }, sites))).toEqual(['RF.c_2']);
});

test('text matches id, site name, unit and raw material, case-insensitively', () => {
    expect(ids(filterItems(items, { text: 'castelcivita' }, sites))).toEqual(['CTC_3']);
    expect(ids(filterItems(items, { text: 'd3B' }, sites))).toEqual(['RF.c_2']);
    expect(ids(filterItems(items, { text: 'maiolica' }, sites))).toEqual(['RF.b_1']);
    expect(ids(filterItems(items, { text: '  rf.  ' }, sites))).toEqual(['RF.b_1', 'RF.c_2']);
});

test('formatBytes', () => {
    expect(formatBytes(384291)).toBe('384 kB');
    expect(formatBytes(1400000)).toBe('1.4 MB');
    expect(formatBytes(62100000)).toBe('62 MB');
    expect(formatBytes(undefined)).toBe('');
});

test('time filter keeps sites whose dating range contains the age; undated sites drop out', () => {
    const dated = new Map([
        ['fumane', { name: 'Grotta di Fumane', datingKa: [41, 33] }],
        ['castelcivita', { name: 'Grotta di Castelcivita', datingKa: [41, 39.8] }],
    ]);
    expect(ids(filterItems(items, { timeKa: 40.5 }, dated))).toEqual(['RF.b_1', 'RF.c_2', 'CTC_3']);
    expect(ids(filterItems(items, { timeKa: 35 }, dated))).toEqual(['RF.b_1', 'RF.c_2']);
    expect(ids(filterItems(items, { timeKa: 30 }, dated))).toEqual([]);
    const oneUndated = new Map([['fumane', { name: 'F', datingKa: [41, 33] }], ['castelcivita', { name: 'C' }]]);
    expect(ids(filterItems(items, { timeKa: 40 }, oneUndated))).toEqual(['RF.b_1', 'RF.c_2']);
});
