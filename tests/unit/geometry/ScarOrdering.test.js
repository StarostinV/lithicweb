import { ScarOrdering } from '../../../src/geometry/ScarOrdering.js';


// ============== Test Helpers ==============

function makeScarGraph(numScars) {
    // Create a simple linear scar graph: scar 0 -- scar 1 -- scar 2 -- ...
    const scars = [];
    const edges = [];

    for (let i = 0; i < numScars; i++) {
        scars.push({
            scarId: i,
            representativeVertex: i * 100,
            vertexCount: 100 - i * 10, // decreasing size
        });
    }

    for (let i = 0; i < numScars - 1; i++) {
        edges.push({
            scarA: i,
            scarB: i + 1,
            sharpness: 0.5,
            roughness: 0.1,
            boundarySize: 10,
        });
    }

    return { scars, edges };
}


// ============== Tests ==============

describe('ScarOrdering', () => {
    describe('constructor', () => {
        it('should create empty ordering', () => {
            const ordering = new ScarOrdering();
            expect(ordering.comparisons).toEqual([]);
            expect(ordering.getComparisons()).toEqual([]);
        });

        it('should accept scarGraph', () => {
            const graph = makeScarGraph(3);
            const ordering = new ScarOrdering(graph);
            expect(ordering.scarGraph).toBe(graph);
        });
    });

    describe('addComparison', () => {
        it('should add a valid comparison', () => {
            const ordering = new ScarOrdering();
            const result = ordering.addComparison(0, 1, 'expert');

            expect(result.success).toBe(true);
            expect(ordering.comparisons.length).toBe(1);
            expect(ordering.comparisons[0]).toEqual({ younger: 0, older: 1, source: 'expert' });
        });

        it('should default source to expert', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1);
            expect(ordering.comparisons[0].source).toBe('expert');
        });

        it('should reject self-comparison', () => {
            const ordering = new ScarOrdering();
            const result = ordering.addComparison(0, 0);

            expect(result.success).toBe(false);
            expect(result.error).toBe('self');
        });

        it('should detect duplicate comparison', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1);
            const result = ordering.addComparison(0, 1);

            expect(result.success).toBe(true);
            expect(result.alreadyExists).toBe(true);
            expect(ordering.comparisons.length).toBe(1);
        });

        it('should detect direct cycle', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1, 'expert');
            const result = ordering.addComparison(1, 0, 'expert');

            expect(result.success).toBe(false);
            expect(result.error).toBe('cycle');
        });

        it('should detect transitive cycle', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1, 'expert'); // 0 younger than 1
            ordering.addComparison(1, 2, 'expert'); // 1 younger than 2
            const result = ordering.addComparison(2, 0, 'expert'); // 2 younger than 0 → cycle!

            expect(result.success).toBe(false);
            expect(result.error).toBe('cycle');
            expect(result.cyclePath.length).toBeGreaterThan(0);
        });

        it('should auto-resolve cycle by removing preseed edges', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1, 'preseed'); // preseed: 0 younger than 1
            ordering.addComparison(1, 0, 'expert');  // expert: 1 younger than 0 → contradicts

            // Should succeed because preseed edge was removed
            expect(ordering.comparisons.length).toBe(1);
            expect(ordering.comparisons[0]).toEqual({ younger: 1, older: 0, source: 'expert' });
        });

        it('should auto-resolve transitive cycle with preseed', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1, 'expert');
            ordering.addComparison(1, 2, 'preseed');
            const result = ordering.addComparison(2, 0, 'expert');

            // The preseed edge (1→2) should be removed to break the cycle
            expect(result.success).toBe(true);
            expect(ordering.comparisons.length).toBe(2);
            // Should have: 0→1 (expert), 2→0 (expert)
            const sources = ordering.comparisons.map(c => c.source);
            expect(sources).not.toContain('preseed');
        });

        it('should reject cycle with all expert edges', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1, 'expert');
            ordering.addComparison(1, 2, 'expert');
            const result = ordering.addComparison(2, 0, 'expert');

            expect(result.success).toBe(false);
            expect(result.error).toBe('cycle');
        });
    });

    describe('removeComparison', () => {
        it('should remove existing comparison', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1);
            const removed = ordering.removeComparison(0, 1);

            expect(removed).toBe(true);
            expect(ordering.comparisons.length).toBe(0);
        });

        it('should return false for non-existent comparison', () => {
            const ordering = new ScarOrdering();
            const removed = ordering.removeComparison(0, 1);
            expect(removed).toBe(false);
        });

        it('should allow previously-cyclic comparison after removal', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1, 'expert');
            ordering.addComparison(1, 2, 'expert');

            // This would cycle
            let result = ordering.addComparison(2, 0, 'expert');
            expect(result.success).toBe(false);

            // Remove one edge
            ordering.removeComparison(0, 1);

            // Now it should work
            result = ordering.addComparison(2, 0, 'expert');
            expect(result.success).toBe(true);
        });
    });

    describe('getTopologicalOrder', () => {
        it('should return empty array when no comparisons', () => {
            const ordering = new ScarOrdering();
            expect(ordering.getTopologicalOrder()).toEqual([]);
        });

        it('should order a simple chain youngest-first', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1); // 0 is younger than 1
            ordering.addComparison(1, 2); // 1 is younger than 2

            const order = ordering.getTopologicalOrder();
            // Youngest first: 0, 1, 2
            expect(order).toEqual([0, 1, 2]);
        });

        it('should handle diamond DAG', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1); // 0 younger than 1
            ordering.addComparison(0, 2); // 0 younger than 2
            ordering.addComparison(1, 3); // 1 younger than 3
            ordering.addComparison(2, 3); // 2 younger than 3

            const order = ordering.getTopologicalOrder();
            // 0 must come first (youngest), 3 must come last (oldest)
            expect(order[0]).toBe(0);
            expect(order[order.length - 1]).toBe(3);
            expect(order.length).toBe(4);

            // Verify topological validity: for each comparison, younger before older
            for (const comp of ordering.getComparisons()) {
                expect(order.indexOf(comp.younger)).toBeLessThan(order.indexOf(comp.older));
            }
        });

        it('should be deterministic with ties broken by scarId', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 2);
            ordering.addComparison(1, 2);

            // 0 and 1 are both youngest (no incoming edges)
            // Tie-break by scarId: 0 before 1
            const order = ordering.getTopologicalOrder();
            expect(order).toEqual([0, 1, 2]);
        });

        it('should handle disconnected components', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1);
            ordering.addComparison(2, 3);

            const order = ordering.getTopologicalOrder();
            expect(order.length).toBe(4);
            // 0 before 1, 2 before 3
            expect(order.indexOf(0)).toBeLessThan(order.indexOf(1));
            expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
        });
    });

    describe('getComparisons', () => {
        it('should return a copy', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1);
            const comps = ordering.getComparisons();
            comps.push({ younger: 9, older: 10, source: 'test' });
            expect(ordering.comparisons.length).toBe(1);
        });
    });

    describe('getComparisonsForScar', () => {
        it('should return comparisons involving a scar', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1);
            ordering.addComparison(1, 2);
            ordering.addComparison(3, 1);

            const result = ordering.getComparisonsForScar(1);
            expect(result.asYounger.length).toBe(1); // 1→2
            expect(result.asOlder.length).toBe(2);   // 0→1, 3→1
        });
    });

    describe('isFullyOrdered', () => {
        it('should return true for a complete chain', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1);
            ordering.addComparison(1, 2);
            expect(ordering.isFullyOrdered()).toBe(true);
        });

        it('should return true for disconnected pairs (no ties in toposort)', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1);
            ordering.addComparison(2, 3);
            // 4 nodes, toposort has 4 entries → fully ordered
            expect(ordering.isFullyOrdered()).toBe(true);
        });
    });

    describe('preseedFromGraph', () => {
        it('should preseed comparisons using size heuristic', () => {
            const graph = makeScarGraph(3);
            // Sizes: scar 0 = 100, scar 1 = 90, scar 2 = 80
            // Edges: 0-1, 1-2
            // Smaller = younger: scar 1 younger than 0, scar 2 younger than 1

            const ordering = new ScarOrdering(graph);
            ordering.preseedFromGraph(graph);

            expect(ordering.comparisons.length).toBe(2);
            expect(ordering.comparisons.every(c => c.source === 'preseed')).toBe(true);
        });

        it('should skip comparisons that would create cycles', () => {
            // Create a graph where size-based preseed would cycle
            const graph = {
                scars: [
                    { scarId: 0, representativeVertex: 0, vertexCount: 50 },
                    { scarId: 1, representativeVertex: 100, vertexCount: 60 },
                    { scarId: 2, representativeVertex: 200, vertexCount: 55 },
                ],
                edges: [
                    { scarA: 0, scarB: 1, sharpness: 0.5, roughness: 0.1, boundarySize: 10 },
                    { scarA: 1, scarB: 2, sharpness: 0.5, roughness: 0.1, boundarySize: 10 },
                    { scarA: 0, scarB: 2, sharpness: 0.5, roughness: 0.1, boundarySize: 10 },
                ],
            };
            // Sizes: 0=50, 1=60, 2=55
            // Edge 0-1: 0 smaller → 0 younger than 1
            // Edge 1-2: 2 smaller → 2 younger than 1
            // Edge 0-2: 0 smaller → 0 younger than 2
            // Order: 0 < 2 < 1 (youngest to oldest by these rules)
            // No cycle possible with this configuration

            const ordering = new ScarOrdering(graph);
            ordering.preseedFromGraph(graph);
            // Should add all 3 without cycles
            expect(ordering.comparisons.length).toBe(3);
        });

        it('should handle null graph', () => {
            const ordering = new ScarOrdering();
            ordering.preseedFromGraph(null);
            expect(ordering.comparisons.length).toBe(0);
        });
    });

    describe('setGlobalOrder', () => {
        it('should replace all comparisons from a linear order', () => {
            const graph = makeScarGraph(3);
            // edges: 0-1, 1-2
            const ordering = new ScarOrdering(graph);
            ordering.addComparison(0, 1, 'preseed');

            // Set global order: 0=oldest, 1, 2=youngest
            ordering.setGlobalOrder([0, 1, 2]);

            // All old comparisons cleared, new ones added as expert
            expect(ordering.comparisons.every(c => c.source === 'expert')).toBe(true);
            // Adjacency edges 0-1 and 1-2: younger → older
            // rank 1 > rank 0, so scar 1 younger than 0: comparison(1, 0)
            // rank 2 > rank 1, so scar 2 younger than 1: comparison(2, 1)
            expect(ordering.comparisons.length).toBe(2);
        });

        it('should produce valid topological order matching input', () => {
            const graph = makeScarGraph(4);
            // edges: 0-1, 1-2, 2-3
            const ordering = new ScarOrdering(graph);

            ordering.setGlobalOrder([2, 0, 3, 1]); // oldest=2, youngest=1

            const topo = ordering.getTopologicalOrder(); // youngest first
            // youngest=1 should be first
            expect(topo[0]).toBe(1);
        });

        it('should be cycle-free', () => {
            const graph = {
                scars: [
                    { scarId: 0, representativeVertex: 0, vertexCount: 100 },
                    { scarId: 1, representativeVertex: 100, vertexCount: 90 },
                    { scarId: 2, representativeVertex: 200, vertexCount: 80 },
                ],
                edges: [
                    { scarA: 0, scarB: 1 },
                    { scarA: 1, scarB: 2 },
                    { scarA: 0, scarB: 2 },
                ],
            };
            const ordering = new ScarOrdering(graph);
            ordering.setGlobalOrder([0, 1, 2]);
            expect(ordering.isFullyOrdered()).toBe(true);
        });
    });

    describe('clearPreseedComparisons', () => {
        it('should remove only preseed comparisons', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1, 'preseed');
            ordering.addComparison(1, 2, 'expert');
            ordering.addComparison(2, 3, 'preseed');

            ordering.clearPreseedComparisons();

            expect(ordering.comparisons.length).toBe(1);
            expect(ordering.comparisons[0].source).toBe('expert');
        });

        it('should rebuild adjacency correctly', () => {
            const ordering = new ScarOrdering();
            ordering.addComparison(0, 1, 'expert');
            ordering.addComparison(1, 2, 'preseed');

            ordering.clearPreseedComparisons();

            // Should be able to add 2→0 now (no longer blocked by 1→2)
            const result = ordering.addComparison(2, 0, 'expert');
            expect(result.success).toBe(true);
        });
    });

    describe('serialization', () => {
        it('should round-trip through toMetadata/fromMetadata', () => {
            const graph = makeScarGraph(3);
            const ordering = new ScarOrdering(graph);
            ordering.addComparison(0, 1, 'expert');
            ordering.addComparison(1, 2, 'preseed');

            const metadata = ordering.toMetadata();
            const restored = ScarOrdering.fromMetadata(metadata);

            expect(restored.comparisons.length).toBe(2);
            expect(restored.getComparisons()).toEqual(ordering.getComparisons());
        });

        it('should include version in metadata', () => {
            const ordering = new ScarOrdering(makeScarGraph(2));
            const metadata = ordering.toMetadata();
            expect(metadata.version).toBe(1);
        });

        it('should include scars and edges in metadata', () => {
            const graph = makeScarGraph(2);
            const ordering = new ScarOrdering(graph);
            const metadata = ordering.toMetadata();

            expect(metadata.scars.length).toBe(2);
            expect(metadata.edges.length).toBe(1);
            expect(metadata.scars[0]).toHaveProperty('scarId');
            expect(metadata.scars[0]).toHaveProperty('representativeVertex');
            expect(metadata.scars[0]).toHaveProperty('vertexCount');
        });

        it('should round sharpness and roughness to 4 decimal places', () => {
            const graph = {
                scars: [{ scarId: 0, representativeVertex: 0, vertexCount: 10 }],
                edges: [{
                    scarA: 0, scarB: 1,
                    sharpness: 1.23456789,
                    roughness: 0.00001111,
                    boundarySize: 5
                }],
            };
            const ordering = new ScarOrdering(graph);
            const metadata = ordering.toMetadata();

            expect(metadata.edges[0].sharpness).toBe(1.2346);
            expect(metadata.edges[0].roughness).toBe(0);
        });

        it('should handle empty ordering', () => {
            const ordering = new ScarOrdering();
            const metadata = ordering.toMetadata();

            expect(metadata.scars).toEqual([]);
            expect(metadata.edges).toEqual([]);
            expect(metadata.comparisons).toEqual([]);

            const restored = ScarOrdering.fromMetadata(metadata);
            expect(restored.comparisons).toEqual([]);
        });

        it('should accept external scarGraph in fromMetadata', () => {
            const graph = makeScarGraph(3);
            const ordering = new ScarOrdering(graph);
            ordering.addComparison(0, 1, 'expert');
            const metadata = ordering.toMetadata();

            const newGraph = makeScarGraph(3);
            const restored = ScarOrdering.fromMetadata(metadata, newGraph);
            expect(restored.scarGraph).toBe(newGraph);
        });
    });
});
