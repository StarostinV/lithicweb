/**
 * @fileoverview Unit tests for model panel defaults display and reset.
 *
 * Tests the CONFIG_PARAMS / DEFAULT_INFERENCE_CONFIG integration
 * and the reset-to-defaults behavior.
 *
 * @see src/components/modelPanel.js
 * @see src/api/lithicClient.js
 */

import { DEFAULT_INFERENCE_CONFIG, CONFIG_PARAMS } from '../../../src/api/lithicClient.js';

describe('Model Panel Defaults', () => {
    describe('DEFAULT_INFERENCE_CONFIG', () => {
        test('should have all keys referenced in CONFIG_PARAMS', () => {
            for (const key of Object.keys(CONFIG_PARAMS)) {
                expect(DEFAULT_INFERENCE_CONFIG).toHaveProperty(key);
            }
        });

        test('should have expected default values', () => {
            expect(DEFAULT_INFERENCE_CONFIG.n_angles).toBe(6);
            expect(DEFAULT_INFERENCE_CONFIG.zoom).toBe(1.0);
            expect(DEFAULT_INFERENCE_CONFIG.union_find_max_merge_cost).toBe(0.45);
            expect(DEFAULT_INFERENCE_CONFIG.min_segment_size).toBe(50);
            expect(DEFAULT_INFERENCE_CONFIG.union_find_merge_cost).toBe('max');
        });
    });

    describe('CONFIG_PARAMS metadata', () => {
        test('each param should have label, type, and description', () => {
            for (const [key, meta] of Object.entries(CONFIG_PARAMS)) {
                expect(meta).toHaveProperty('label');
                expect(meta).toHaveProperty('type');
                expect(meta).toHaveProperty('description');
                expect(['slider', 'number', 'select']).toContain(meta.type);
            }
        });

        test('slider params should have min, max, step', () => {
            for (const [key, meta] of Object.entries(CONFIG_PARAMS)) {
                if (meta.type === 'slider') {
                    expect(meta).toHaveProperty('min');
                    expect(meta).toHaveProperty('max');
                    expect(meta).toHaveProperty('step');
                    expect(meta.min).toBeLessThan(meta.max);
                }
            }
        });

        test('number params should have min, max, step', () => {
            for (const [key, meta] of Object.entries(CONFIG_PARAMS)) {
                if (meta.type === 'number') {
                    expect(meta).toHaveProperty('min');
                    expect(meta).toHaveProperty('max');
                    expect(meta).toHaveProperty('step');
                }
            }
        });

        test('select params should have options array', () => {
            for (const [key, meta] of Object.entries(CONFIG_PARAMS)) {
                if (meta.type === 'select') {
                    expect(meta).toHaveProperty('options');
                    expect(Array.isArray(meta.options)).toBe(true);
                    expect(meta.options.length).toBeGreaterThan(0);
                    // Default value should be in options
                    expect(meta.options).toContain(DEFAULT_INFERENCE_CONFIG[key]);
                }
            }
        });

        test('each param should have a category', () => {
            for (const [key, meta] of Object.entries(CONFIG_PARAMS)) {
                expect(meta).toHaveProperty('category');
                expect(['nn', 'postprocess']).toContain(meta.category);
            }
        });
    });

    describe('Reset to defaults', () => {
        test('spreading DEFAULT_INFERENCE_CONFIG creates independent copy', () => {
            const config = { ...DEFAULT_INFERENCE_CONFIG };
            config.n_angles = 999;
            config.zoom = 5.0;

            // Original should be unchanged
            expect(DEFAULT_INFERENCE_CONFIG.n_angles).toBe(6);
            expect(DEFAULT_INFERENCE_CONFIG.zoom).toBe(1.0);

            // Reset by re-spreading
            const reset = { ...DEFAULT_INFERENCE_CONFIG };
            expect(reset.n_angles).toBe(6);
            expect(reset.zoom).toBe(1.0);
            expect(reset.union_find_max_merge_cost).toBe(0.45);
        });

        test('default hint text for null values should show "None"', () => {
            const nullKey = Object.keys(DEFAULT_INFERENCE_CONFIG).find(
                k => DEFAULT_INFERENCE_CONFIG[k] === null
            );
            if (nullKey) {
                const val = DEFAULT_INFERENCE_CONFIG[nullKey];
                const hintText = `Default: ${val === null ? 'None' : val}`;
                expect(hintText).toBe('Default: None');
            }
        });

        test('default hint text for numeric values should show the number', () => {
            const hintText = `Default: ${DEFAULT_INFERENCE_CONFIG.n_angles}`;
            expect(hintText).toBe('Default: 6');
        });

        test('default hint text for string values should show the string', () => {
            const hintText = `Default: ${DEFAULT_INFERENCE_CONFIG.union_find_merge_cost}`;
            expect(hintText).toBe('Default: max');
        });

        test('default values should be within slider/number ranges', () => {
            for (const [key, meta] of Object.entries(CONFIG_PARAMS)) {
                if (meta.type === 'slider' || meta.type === 'number') {
                    const val = DEFAULT_INFERENCE_CONFIG[key];
                    if (val !== null) {
                        expect(val).toBeGreaterThanOrEqual(meta.min);
                        expect(val).toBeLessThanOrEqual(meta.max);
                    }
                }
            }
        });
    });
});
