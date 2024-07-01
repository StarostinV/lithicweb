import * as THREE from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';

// Accelerate raycasting
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class IntersectFinder {
    constructor(scene) {
        this.scene = scene;
        this.camera = scene.camera;
        this.canvas = scene.canvas;
        this.raycaster = new THREE.Raycaster();
        this.raycaster.firstHitOnly = true;
        this.mouse = new THREE.Vector2();
    }

    getMousePosition(event) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        return this.mouse;
    }

    getIntersects(mesh) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        return this.raycaster.intersectObject(mesh, true);
    }

    getClickedPoint(mesh, event) {
        // Set up mouse position
        this.getMousePosition(event);

        // Perform raycasting
        const intersects = this.getIntersects(mesh);
        if (intersects.length === 0) {
            return -1;
        }

        // Get the intersection point
        return intersects[0].point;
    }

    getClickedFace(mesh, event) {
        const intersectPoint = this.getClickedPoint(mesh, event);
        if (intersectPoint === -1) {
            return -1;
        }
        return mesh.geometry.boundsTree.closestPointToPoint(intersectPoint).faceIndex;
    }

    getClosestVertexIndex(mesh, event) {
        // Get the intersection point
        const intersectPoint = this.getClickedPoint(mesh, event);

        if (intersectPoint === -1) {
            return [-1, -1, -1];
        }

        const faceIndex = mesh.geometry.boundsTree.closestPointToPoint(intersectPoint).faceIndex;

        if (faceIndex === -1) {
            return [-1, -1, -1];
        }

        const [a, b, c, vertexA, vertexB, vertexC] = getFaceVertices(mesh, faceIndex);

        // Find the closest vertex to the intersection point
        let minDistanceSq = Infinity;
        let closestVertexIndex = -1;

        [vertexA, vertexB, vertexC].forEach((vertex, index) => {
            const distanceSq = vertex.distanceToSquared(intersectPoint);
            if (distanceSq < minDistanceSq) {
                minDistanceSq = distanceSq;
                closestVertexIndex = [a, b, c][index];
            }
        });

        return [intersectPoint, faceIndex, closestVertexIndex];
    }

    getVerticesWithinRadius(mesh, event, radius) {
        const point = this.getClickedPoint(mesh, event);
        if (point === -1) {
            return [];
        }
        const positions = mesh.geometry.attributes.position;
        const normals = mesh.geometry.attributes.normal;
        console.log(normals);
        const vertex = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const nearbyVertexIndices = new Set();
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);
        const index = mesh.geometry.index.array;
    
        mesh.geometry.boundsTree.shapecast({
            intersectsBounds: (box) => {
                return box.distanceToPoint(point) <= radius * 2;
            },
            intersectsTriangle: (triangle, triIndex, contained) => {
    
                for (let i = 0; i < 3; i++) {
                    const vertexIndex = index[triIndex * 3 + i];
                    vertex.fromBufferAttribute(positions, vertexIndex);
                    normal.fromBufferAttribute(normals, vertexIndex);
    
                    // Check if the vertex normal is facing the camera
                    if (vertex.distanceTo(point) <= radius && normal.dot(cameraDirection) < 0) {
                        nearbyVertexIndices.add(vertexIndex);
                    }
                }
            }
        });
        
        return Array.from(nearbyVertexIndices);
    }
    
}


export function getFaceVertices(mesh, faceIndex) {
    const positionAttribute = mesh.geometry.attributes.position;
    const indices = mesh.geometry.index;

    // Get vertex indices of the intersected face
    const a = indices.getX(faceIndex * 3);
    const b = indices.getX(faceIndex * 3 + 1);
    const c = indices.getX(faceIndex * 3 + 2);

    // Get vertex positions
    const vertexA = new THREE.Vector3().fromBufferAttribute(positionAttribute, a);
    const vertexB = new THREE.Vector3().fromBufferAttribute(positionAttribute, b);
    const vertexC = new THREE.Vector3().fromBufferAttribute(positionAttribute, c);

    return [a, b, c, vertexA, vertexB, vertexC];
}