import * as THREE from 'three';

export function updateLightDirection(camera, light) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.negate();
    light.position.copy(forward);
}
