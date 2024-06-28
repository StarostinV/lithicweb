import { kdTree } from 'kd-tree-javascript';

export function createKDTree(positions) {
    const points = [];
    for (let i = 0; i < positions.length; i += 3) {
        points.push({
            x: positions[i],
            y: positions[i + 1],
            z: positions[i + 2],
            index: i / 3 // Store the index of the vertex
        });
    }

    const distance = (a, b) => {
        return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
    };

    console.log('KD-Tree created with', points.length, 'points');

    return new kdTree(points, distance, ['x', 'y', 'z']);
}
