/* [INPUT]: Procedural Studio Display geometry and a target canvas.
 * [OUTPUT]: An on-demand orthographic render with owned GPU resources.
 * [POS]: Website hardware renderer; loaded only by the optional Studio display.
 * [PROTOCOL]: Keep settings/AGENTS.md and model acceptance in sync. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createStudioDisplayModel } from './studio-display-model';

export function mountStudioDisplay(canvas: HTMLCanvasElement, review = false) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: review,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(review ? 918 : 736, review ? 744 : 600, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene();
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentMap.texture;
  environment.dispose();
  pmrem.dispose();
  const model = createStudioDisplayModel();
  scene.add(model.root);
  RectAreaLightUniformsLib.init();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb1b2b4, 0.5));
  const softbox = new THREE.RectAreaLight(0xffffff, 4, 280, 220);
  softbox.position.set(-40, 150, 180);
  softbox.lookAt(0, 80, -50);
  scene.add(softbox);
  const upper = new THREE.RectAreaLight(0xffffff, 2, 500, 180);
  upper.position.set(0, 600, 200);
  upper.lookAt(0, 250, 0);
  scene.add(upper);
  const key = new THREE.DirectionalLight(0xffffff, 0.5);
  key.position.set(-350, 650, 600);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(500, 100, 400);
  scene.add(fill);
  const scale = review ? 756 / 623 : 682 / 597.7;
  const width = (review ? 918 : 736) / scale,
    height = (review ? 744 : 600) / scale;
  const camera = new THREE.OrthographicCamera(
    -width / 2,
    width / 2,
    height / 2,
    -height / 2,
    0.1,
    3000,
  );
  const centerY = review ? 239 : 297 - 60 / scale;
  const centerX = review ? 0 : -1 / scale;
  let disposed = false;
  function render(progress = 0, yaw = 0) {
    if (disposed) return;
    const amount = THREE.MathUtils.clamp(progress, 0, 1);
    model.stand.position.set(0, amount * 130, -amount * 100);
    model.stand.visible = amount < 0.999;
    camera.position.set(centerX + Math.sin(yaw) * 1200, centerY, Math.cos(yaw) * 1200);
    camera.lookAt(centerX, centerY, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    canvas.dataset.ready = 'true';
  }
  render();
  return {
    render,
    model,
    camera,
    scene,
    renderer,
    dispose() {
      disposed = true;
      model.dispose();
      environmentMap.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
