import * as THREE from 'three';

class Arrow {
    constructor(startPoint, vertexNormalStart, startIndex, offset, color, shaftRadius, headRadius, headLength) {
        this.startPoint = startPoint;
        this.endPoint = startPoint.clone();
        this.startIndex = startIndex;
        this.endIndex = startIndex;
        this.vertexNormalStart = vertexNormalStart;
        this.vertexNormalEnd = vertexNormalStart.clone();
        this.offset = offset;
        this.color = color;
        this.shaftRadius = shaftRadius;
        this.headRadius = headRadius;
        this.headLength = headLength;

        this.start = this.startPoint.clone().addScaledVector(this.vertexNormalStart, this.offset);
        this.end = this.endPoint.clone().addScaledVector(this.vertexNormalEnd, this.offset);

        this.arrowGroup = new THREE.Group();
        this.updateArrowGroup();  
    }

    clear() {
        this.arrowGroup.children.forEach(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        this.arrowGroup.clear();

    }

    updateArrowGroup() {
        this.clear();
        let [head, shaft, direction] = createArrowComponents(
            this.start, this.end, this.color, this.shaftRadius, this.headRadius, this.headLength
        );
        this.direction = direction;
        this.arrowGroup.add(shaft);
        this.arrowGroup.add(head);
        this.shaft = shaft;
        this.arrowGroup.position.copy(this.start);
        this.arrowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.direction);

    }

    updateArrow(newEndPoint, newVertexNormalEnd, endIndex) {
        // Update the end point and vertex normal
        this.endPoint = newEndPoint;
        this.endIndex = endIndex;
        this.vertexNormalEnd = newVertexNormalEnd;

        // Calculate the new start and end points with offsets
        this.end = this.endPoint.clone().addScaledVector(this.vertexNormalEnd, this.offset);
        this.updateArrowGroup();

    }

    dispose() {
        // Dispose of geometries and materials in the arrow group
        this.clear();

        // Remove the arrow group from its parent if necessary
        if (this.arrowGroup.parent) {
            this.arrowGroup.parent.remove(this.arrowGroup);
        }

        // Clear the arrow group
        this.arrowGroup = null;
    }

}

function createArrowComponents(startPoint, endPoint, color, shaftRadius, headRadius, headLength) {
    console.log("Creating custom arrow");
    console.log(startPoint, endPoint, color, shaftRadius, headRadius, headLength);

    let direction = new THREE.Vector3().subVectors(endPoint, startPoint).normalize();
    if (direction.length() === 0) {
        direction = new THREE.Vector3(0, 0, 1);
    }
    const distance = startPoint.distanceTo(endPoint);

    // Create the arrow shaft
    const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, Math.max(distance - headLength, 0.01), 8);
    const shaftMaterial = new THREE.MeshBasicMaterial({ color: color });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);

    // Position the shaft
    shaft.position.set(0, (distance - headLength) / 2, 0);
    shaft.rotation.x = 0;

    // Create the arrow head
    const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 8);
    const headMaterial = new THREE.MeshBasicMaterial({ color: color });
    const head = new THREE.Mesh(headGeometry, headMaterial);

    // Position the head
    head.position.set(0, distance - headLength / 2, 0);
    head.rotation.x = 0;

    return [head, shaft, direction];
}


export class ArrowDrawer {
    constructor(canvas, meshObject, mode) {
        this.meshObject = meshObject;
        this.canvas = canvas;
        this.mode = mode;
        this.isDrawing = false;
        this.arrow = null;
        this.arrows = [];
        this.offset = 0.2;

        // Bind event listeners to ensure 'this' context is correct
        this.leftClick = this.leftClick.bind(this);
        this.rightClick = this.rightClick.bind(this);
        this.removeArrow = this.removeArrow.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.highlightArrow = this.highlightArrow.bind(this);
        this.unhighlightArrow = this.unhighlightArrow.bind(this);


        // Add event listeners
        this.canvas.addEventListener('pointerdown', (event) => {
            if ((this.mode != 'arrow') && (this.mode != 'deleteArrows')) return;
            if (event.button === 0) this.leftClick(event);
            if (event.button === 2) this.rightClick(event);
        });

        this.canvas.addEventListener('pointermove', this.handleMouseMove);
        this.canvas.addEventListener('contextmenu', (event) => event.preventDefault()); // Prevent context menu
    }


    mesh() {
        return this.meshObject.mesh;
    }

    leftClick(event) {
        if (this.isDrawing && this.mode == 'arrow') {
            this.finishDrawing();
        } else if (this.mode == 'arrow') {
            this.startDrawing(event);
        } else if (this.mode == 'deleteArrows') {
            this.deleteArrow(event);
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
        const [intersectPoint, faceIndex, vertexNormal, closestVertexIndex, firstVertex] = this.meshObject.getAllIntersectionInfo(event);
        if (faceIndex === -1) return;
        this.isDrawing = true;

        this.arrow = new Arrow(firstVertex, vertexNormal, closestVertexIndex, this.offset, 0xff0000, 0.02, 0.05, 0.2);

        this.mesh().add(this.arrow.arrowGroup);
    }

    removeArrow() {
        if (this.arrow) {
            this.arrow.dispose();
            this.mesh().remove(this.arrow.arrowGroup);
            this.arrow = null;
        }
        this.isDrawing = false;
    }

    updateArrow(event) {
        if (!this.isDrawing) return;
        const [intersectPoint, faceIndex, vertexNormal, closestVertexIndex, endVertex] = this.meshObject.getAllIntersectionInfo(event);
        if (closestVertexIndex === -1) return;
        this.arrow.updateArrow(endVertex, vertexNormal, closestVertexIndex);
    }


    handleMouseMove(event) {
        if (this.mode == 'deleteArrows') {
            const intersectedArrow = this.getIntersectedArrow(event);
            if (intersectedArrow) {
                this.highlightArrow(intersectedArrow);
            } else {
                this.unhighlightArrow();
            }
        } else if (this.isDrawing && (this.mode == 'arrow')) {
            this.updateArrow(event);
        }
    }

    getIntersectedArrow(event) {
        const intersectFinder = this.meshObject.intersectFinder;

        intersectFinder.getMousePosition(event);

        for (const arrowObj of this.arrows) {
            const intersects = intersectFinder.getIntersects(arrowObj.shaft);
            if (intersects.length > 0) {
                return arrowObj;
            }
        }
        return null;
    }

    highlightArrow(arrow) {
        if (this.highlightedArrow && this.highlightedArrow !== arrow) {
            this.unhighlightArrow();
        }
        this.highlightedArrow = arrow;
        arrow.arrowGroup.children.forEach(child => {
            child.material.color.set(0x00ff00);
        });
    }

    unhighlightArrow() {
        if (this.highlightedArrow) {
            this.highlightedArrow.arrowGroup.children.forEach(child => {
                child.material.color.set(0xff0000);
            });
            this.highlightedArrow = null;
        }
    }

    deleteArrow(event) {
        if (this.highlightedArrow) {
            this.mesh().remove(this.highlightedArrow.arrowGroup);
            this.arrows = this.arrows.filter(arrowObj => arrowObj.arrow !== this.highlightedArrow);
            this.highlightedArrow = null;
        }
    }

}
