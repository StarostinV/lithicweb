import * as THREE from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';

// Accelerate raycasting
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * IntersectFinder - Handles raycasting and intersection queries on meshes.
 * 
 * Properly handles mesh transformations by converting between world and local
 * coordinate spaces. All BVH queries are performed in local space, while
 * raycaster results are in world space.
 */
export class IntersectFinder {
    constructor(scene) {
        this.scene = scene;
        this.camera = scene.camera;
        this.canvas = scene.canvas;
        this.raycaster = new THREE.Raycaster();
        this.raycaster.firstHitOnly = true;
        this.mouse = new THREE.Vector2();
        
        // Reusable objects to avoid allocations
        this._inverseMatrix = new THREE.Matrix4();
        this._localPoint = new THREE.Vector3();
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
    
    /**
     * Transforms a world-space point to the mesh's local coordinate space.
     * @param {THREE.Mesh} mesh - The mesh
     * @param {THREE.Vector3} worldPoint - Point in world space
     * @returns {THREE.Vector3} Point in local space
     */
    worldToLocal(mesh, worldPoint) {
        mesh.updateMatrixWorld(true);
        this._inverseMatrix.copy(mesh.matrixWorld).invert();
        return this._localPoint.copy(worldPoint).applyMatrix4(this._inverseMatrix);
    }
    
    /**
     * Transforms a local-space point to world coordinate space.
     * @param {THREE.Mesh} mesh - The mesh
     * @param {THREE.Vector3} localPoint - Point in local space
     * @returns {THREE.Vector3} Point in world space
     */
    localToWorld(mesh, localPoint) {
        mesh.updateMatrixWorld(true);
        return localPoint.clone().applyMatrix4(mesh.matrixWorld);
    }

    getClickedPoint(mesh, event) {
        // Set up mouse position
        this.getMousePosition(event);

        // Perform raycasting
        const intersects = this.getIntersects(mesh);
        if (intersects.length === 0) {
            return -1;
        }

        // Get the intersection point (in world space)
        return intersects[0].point;
    }

    getClickedFace(mesh, event) {
        const intersectPoint = this.getClickedPoint(mesh, event);
        if (intersectPoint === -1) {
            return -1;
        }
        // Convert to local space for BVH query
        const localPoint = this.worldToLocal(mesh, intersectPoint);
        return mesh.geometry.boundsTree.closestPointToPoint(localPoint).faceIndex;
    }

    getClosestVertexIndex(mesh, event) {
        // Get the intersection point (world space)
        const intersectPoint = this.getClickedPoint(mesh, event);

        if (intersectPoint === -1) {
            return [-1, -1, -1];
        }

        // Convert to local space for BVH query
        const localPoint = this.worldToLocal(mesh, intersectPoint);
        const faceIndex = mesh.geometry.boundsTree.closestPointToPoint(localPoint).faceIndex;

        if (faceIndex === -1) {
            return [-1, -1, -1];
        }

        const [a, b, c, vertexA, vertexB, vertexC] = getFaceVertices(mesh, faceIndex);

        // Find the closest vertex to the intersection point (in local space)
        let minDistanceSq = Infinity;
        let closestVertexIndex = -1;

        [vertexA, vertexB, vertexC].forEach((vertex, index) => {
            const distanceSq = vertex.distanceToSquared(localPoint);
            if (distanceSq < minDistanceSq) {
                minDistanceSq = distanceSq;
                closestVertexIndex = [a, b, c][index];
            }
        });

        return [intersectPoint, faceIndex, closestVertexIndex];
    }

    getVerticesWithinRadius(mesh, event, radius) {
        const worldPoint = this.getClickedPoint(mesh, event);
        if (worldPoint === -1) {
            return [];
        }
        
        // Convert click point to local space for BVH queries
        const localPoint = this.worldToLocal(mesh, worldPoint);
        
        // Scale radius to local space (handle non-uniform scale)
        // For simplicity, use average scale factor
        mesh.updateMatrixWorld(true);
        const scale = mesh.matrixWorld.getMaxScaleOnAxis();
        const localRadius = radius / scale;
        
        const positions = mesh.geometry.attributes.position;
        const normals = mesh.geometry.attributes.normal;
        const vertex = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const nearbyVertexIndices = new Set();
        
        // Get camera direction in local space for backface culling
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);
        // Transform camera direction to local space (use inverse transpose for directions)
        const normalMatrix = new THREE.Matrix3().setFromMatrix4(
            this._inverseMatrix.copy(mesh.matrixWorld).invert()
        );
        cameraDirection.applyMatrix3(normalMatrix).normalize();
        
        const index = mesh.geometry.index.array;
    
        mesh.geometry.boundsTree.shapecast({
            intersectsBounds: (box) => {
                return box.distanceToPoint(localPoint) <= localRadius * 2;
            },
            intersectsTriangle: (triangle, triIndex, contained) => {
                for (let i = 0; i < 3; i++) {
                    const vertexIndex = index[triIndex * 3 + i];
                    vertex.fromBufferAttribute(positions, vertexIndex);
                    normal.fromBufferAttribute(normals, vertexIndex);
    
                    // Check if the vertex normal is facing the camera (in local space)
                    if (vertex.distanceTo(localPoint) <= localRadius && normal.dot(cameraDirection) < 0) {
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