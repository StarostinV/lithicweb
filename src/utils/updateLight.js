export function updateLightDirection(camera, light) {
    const forward = camera.getForwardRay().direction;
    light.direction = forward.negate();
}
