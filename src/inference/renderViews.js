// Orthographic multi-view renderer — browser equivalent of rasterize.py:rasterize_for_cv.
// For each view it renders a face-ID + world-Z buffer (RGBA32F) via three.js, then
// assembles the 6-channel model input in Python layout and records the visible face per
// pixel (for back-projection).
//
// Parity rules established by the Phase-1 spike (all matched Python to ~1e-3):
//  - autoframe: recenter rotated verts by mean, D = max||v||; ortho bounds ±D*512/511 so
//    GPU pixel centers coincide with Python linspace(-D,D,512).
//  - camera looks from +Z so the nearest (default LESS depth test) fragment is MAX world-z,
//    matching rasterize.py filter_low_depths.
//  - pixel orientation: Python image[xIdx][yIdx] == GPU buffer (row=yIdx, col=xIdx).
//  - depth channel: world-z, background filled 0, then global min-max over all 512x512.
//  - face-ID readback rounded (float target != exact int).
import * as THREE from 'three';
import { computeFaceNormals } from './meshFeatures.js';
import { VIRIDIS_LUT } from './viridisLut.js';
import { applyRotation } from './rotations.js';

const LIGHT = (() => { const v = [0.2, 0.2, 1.0]; const n = Math.hypot(...v); return [v[0]/n, v[1]/n, v[2]/n]; })();

export class ViewRenderer {
  constructor(resolution = 512) {
    this.RES = resolution;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: false });
    this.renderer.setSize(this.RES, this.RES);
    this.renderer.setClearColor(0x000000, 0); // faceId 0 == background
    this.target = new THREE.WebGLRenderTarget(this.RES, this.RES, {
      type: THREE.FloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      vertexShader: `
        precision highp float;
        uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
        in vec3 position; in float faceId;
        flat out float vId; out float vZ;
        void main() { vId = faceId; vZ = position.z;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        precision highp float;
        flat in float vId; in float vZ; out vec4 frag;
        void main() { frag = vec4(vId, vZ, 0.0, 1.0); }`,
    });
    this._scene = new THREE.Scene();
    this._readBuf = new Float32Array(this.RES * this.RES * 4);
  }

  /**
   * Render one view.
   * @param {Float32Array} vertsAligned PCA-aligned verts, flat (V,3)
   * @param {Int32Array} faces flat (nF,3)
   * @param {number[]} R row-major 3x3 view rotation
   * @param {Float32Array} maxAngles per-face max_angles channel (view-independent)
   * @returns {{img: Float32Array, faceOfPixel: Int32Array, normalZ: Float32Array}}
   *          img: (6*RES*RES) Python channel-major layout; normalZ: per-face z of rotated normal.
   */
  renderView(vertsAligned, faces, R, maxAngles) {
    const RES = this.RES, N = RES * RES, nF = faces.length / 3;
    const vrot = applyRotation(vertsAligned, R);
    const vc = recenter(vrot);
    const normals = computeFaceNormals(vc, faces);          // recenter doesn't change normals
    const rgb = faceColors(normals);                         // per-face viridis RGB
    const normalZ = new Float32Array(nF);
    for (let f = 0; f < nF; f++) normalZ[f] = normals[3*f+2];

    let D = 0;
    for (let i = 0; i < vc.length/3; i++) { const d = Math.hypot(vc[3*i], vc[3*i+1], vc[3*i+2]); if (d > D) D = d; }

    // Build non-indexed geometry: per-corner position + faceId attribute.
    const positions = new Float32Array(nF * 9);
    const faceId = new Float32Array(nF * 3);
    for (let f = 0; f < nF; f++) {
      for (let v = 0; v < 3; v++) {
        const vi = faces[3*f+v];
        positions[9*f+3*v] = vc[3*vi]; positions[9*f+3*v+1] = vc[3*vi+1]; positions[9*f+3*v+2] = vc[3*vi+2];
        faceId[3*f+v] = f + 1;
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('faceId', new THREE.BufferAttribute(faceId, 1));
    const mesh = new THREE.Mesh(geom, this.material);
    this._scene.clear();
    this._scene.add(mesh);

    const s = D * RES / (RES - 1);
    const camDist = 4 * D;
    const cam = new THREE.OrthographicCamera(-s, s, s, -s, camDist - 2*D, camDist + 2*D);
    cam.position.set(0, 0, camDist); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);

    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this._scene, cam);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, RES, RES, this._readBuf);
    geom.dispose();

    const buf = this._readBuf;
    const img = new Float32Array(6 * N);
    const faceOfPixel = new Int32Array(N).fill(-1);
    const zRaw = new Float32Array(N);
    let zlo = Infinity, zhi = -Infinity;
    for (let xi = 0; xi < RES; xi++) {
      for (let yi = 0; yi < RES; yi++) {
        const gp = (yi * RES + xi) * 4;       // GPU (row=yi, col=xi)
        const fid = Math.round(buf[gp]) - 1;
        const pflat = xi * RES + yi;          // Python flat = xIdx*RES + yIdx
        let zval = 0;
        if (fid >= 0) {
          faceOfPixel[pflat] = fid;
          img[0*N+pflat] = rgb[3*fid]; img[1*N+pflat] = rgb[3*fid+1]; img[2*N+pflat] = rgb[3*fid+2];
          img[3*N+pflat] = 1.0;
          img[4*N+pflat] = maxAngles[fid];  // per-face, view-independent
          zval = buf[gp+1];
        }
        zRaw[pflat] = zval;
        if (zval < zlo) zlo = zval; if (zval > zhi) zhi = zval;
      }
    }
    const zspan = (zhi - zlo) || 1;
    for (let p = 0; p < N; p++) img[5*N + p] = (zRaw[p] - zlo) / zspan;
    return { img, faceOfPixel, normalZ };
  }

  dispose() { this.target.dispose(); this.material.dispose(); this.renderer.dispose(); }
}

function recenter(verts) {
  const n = verts.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += verts[3*i]; cy += verts[3*i+1]; cz += verts[3*i+2]; }
  cx /= n; cy /= n; cz /= n;
  const out = new Float32Array(verts.length);
  for (let i = 0; i < n; i++) { out[3*i]=verts[3*i]-cx; out[3*i+1]=verts[3*i+1]-cy; out[3*i+2]=verts[3*i+2]-cz; }
  return out;
}

// Per-face viridis RGB: brightness = dot(normal, light), global min-max, LUT interpolation.
function faceColors(normals) {
  const nF = normals.length / 3;
  const bright = new Float32Array(nF);
  let lo = Infinity, hi = -Infinity;
  for (let f = 0; f < nF; f++) {
    const b = normals[3*f]*LIGHT[0] + normals[3*f+1]*LIGHT[1] + normals[3*f+2]*LIGHT[2];
    bright[f] = b; if (b < lo) lo = b; if (b > hi) hi = b;
  }
  const span = (hi - lo) || 1;
  const rgb = new Float32Array(nF * 3);
  for (let f = 0; f < nF; f++) {
    const x = ((bright[f] - lo) / span) * 255;
    const i0 = Math.min(255, Math.max(0, Math.floor(x)));
    const i1 = Math.min(255, i0 + 1);
    const frac = x - i0;
    for (let k = 0; k < 3; k++)
      rgb[3*f+k] = VIRIDIS_LUT[3*i0+k]*(1-frac) + VIRIDIS_LUT[3*i1+k]*frac;
  }
  return rgb;
}
