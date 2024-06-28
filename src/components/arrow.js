import * as THREE from 'three';

function createCustomArrow(startPoint, endPoint, color, shaftRadius, headRadius, headLength) {
    console.log("Creating custom arrow");
    console.log(startPoint, endPoint, color, shaftRadius, headRadius, headLength);

    let direction = new THREE.Vector3().subVectors(endPoint, startPoint).normalize();
    if (direction.length() === 0) {
        direction = new THREE.Vector3(0, 0, 1);
    }
    const distance = startPoint.distanceTo(endPoint);

    const arrowGroup = new THREE.Group();

    // Create the arrow shaft
    const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, Math.max(distance - headLength, 0.01), 8);
    const shaftMaterial = new THREE.MeshBasicMaterial({ color: color });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);

    // Position the shaft
    shaft.position.set(0, (distance - headLength) / 2, 0);
    shaft.rotation.x = 0;

    arrowGroup.add(shaft);

    // Create the arrow head
    const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 8);
    const headMaterial = new THREE.MeshBasicMaterial({ color: color });
    const head = new THREE.Mesh(headGeometry, headMaterial);

    // Position the head
    head.position.set(0, distance - headLength / 2, 0);
    head.rotation.x = 0;

    arrowGroup.add(head);

    // Rotate and position the whole arrow group
    arrowGroup.position.copy(startPoint);
    arrowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);

    return arrowGroup;
}


export class ArrowDrawer {
    constructor(canvas, meshObject, intersectFinder, mode) {
        this.meshObject = meshObject;
        this.canvas = canvas;
        this.intersectFinder = intersectFinder;
        this.mode = mode;
        this.isDrawing = false;
        this.arrow = null;
        this.arrows = [];

        // Bind event listeners to ensure 'this' context is correct
        this.handleDrawing = this.handleDrawing.bind(this);
        this.leftClick = this.leftClick.bind(this);
        this.rightClick = this.rightClick.bind(this);
        this.removeArrow = this.removeArrow.bind(this);

        // Add event listeners
        this.canvas.addEventListener('pointerdown', (event) => {
            if (this.mode.getMode() !== 'arrow') return;
            if (event.button === 0) this.leftClick(event);
            if (event.button === 2) this.rightClick(event);
        });

        this.canvas.addEventListener('pointermove', this.handleDrawing);
        this.canvas.addEventListener('contextmenu', (event) => event.preventDefault()); // Prevent context menu
    }

    mesh() {
        return this.meshObject.mesh;
    }

    leftClick(event) {
        if (this.isDrawing) {
            this.finishDrawing();
        } else {
            this.startDrawing(event);
        }
    }

    rightClick(event) {
        this.removeArrow();
    }

    finishDrawing() {
        this.arrows.push(this.arrow);
        this.arrow = null;
        this.isDrawing = false;
    }

    startDrawing(event) {
        const firstVertex = this.intersectFinder.getClickedPoint(this.mesh(), event);
        if (firstVertex === -1) return;
        this.isDrawing = true;

        this.startPoint = new THREE.Vector3(firstVertex.x, firstVertex.y, firstVertex.z);

        const endPoint = this.startPoint.clone(); // Initially the end point is the same as start point
        this.arrow = createCustomArrow(this.startPoint, endPoint, 0xff0000, 0.02, 0.05, 0.2);

        this.mesh().add(this.arrow);
        console.log("Arrow added to mesh:", this.arrow);
        this.handleDrawing(event);
    }

    removeArrow() {
        if (this.arrow) {
            this.mesh().remove(this.arrow);
            this.arrow = null;
        }
        this.isDrawing = false;
    }

    handleDrawing(event) {
        if (!this.mesh() || !this.isDrawing || !this.arrow) return;

        const closestVertexIndex = this.intersectFinder.getClosestVertexIndex(this.mesh(), event);

        if (closestVertexIndex !== -1) {
            this.updateArrow(closestVertexIndex);
        }
    }

    updateArrow(vertexIndex) {
        const endPoint = new THREE.Vector3().fromArray(this.mesh().geometry.attributes.position.array.slice(vertexIndex * 3, vertexIndex * 3 + 3));
        this.mesh().remove(this.arrow);
        this.arrow = createCustomArrow(this.startPoint, endPoint, 0xff0000, 0.02, 0.05, 0.2);
        this.mesh().add(this.arrow);
        console.log("Arrow updated:", this.arrow);
    }
}
