import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

// ---------------------- グローバル ----------------------
let camera, scene, renderer;
let model = null;
let facePlateMaterial = null;

const moveState = { forward: 0, turn: 0 };
const MOVE_SPEED = 0.5;
const TURN_SPEED = 0.8;
const clock = new THREE.Clock();

let hitTestSource = null;
let hitTestSourceRequested = false;
let reticle = null;

// ---------------------- 初期化 ----------------------
init();
setupUI();

async function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  // ライト
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(1, 2, 0.5);
  scene.add(dir);

  // 当たり位置を示すリング
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.12, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff99 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // ARButton（本物）は隠しておく
  const realARButton = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test']
  });
  realARButton.style.display = 'none';
  document.body.appendChild(realARButton);

  // 自前ボタンから本物を呼ぶ
  const startBtn = document.getElementById('start-ar-button');
  const welcomeScreen = document.getElementById('welcome-screen');
  const arUI = document.getElementById('ar-ui');

  startBtn.onclick = () => {
    realARButton.click();              // ← ここがポイント
    welcomeScreen.style.display = 'none';
    arUI.style.display = 'block';
  };

  // モデル読み込み
  loadModel();

  // レンダリング開始
  renderer.setAnimationLoop(renderLoop);

  window.addEventListener('resize', onWindowResize);
}

// ---------------------- モデル読み込み ----------------------
function loadModel() {
  const loader = new GLTFLoader();
  loader.load(
    'AR-Train_Nagai.glb',
    (gltf) => {
      model = gltf.scene;

      // 顔写真エリアを探す（なければ任意のmeshを使う）
      const facePlateName = 'Face_Plate';
      model.traverse((child) => {
        if (child.isMesh && child.name.includes(facePlateName)) {
          facePlateMaterial = child.material.clone();
          child.material = facePlateMaterial;
        }
      });
      if (!facePlateMaterial) {
        // 見つからなかった場合は先頭のMeshのマテリアルを使う
        model.traverse((child) => {
          if (child.isMesh && !facePlateMaterial) {
            facePlateMaterial = child.material;
          }
        });
      }
    },
    undefined,
    (err) => console.error('モデルのロードに失敗しました', err)
  );
}

// ---------------------- UI設定 ----------------------
function setupUI() {
  const stopMove = () => { moveState.forward = 0; moveState.turn = 0; };

  document.getElementById('btn-forward').addEventListener('pointerdown', () => moveState.forward = 1);
  document.getElementById('btn-backward').addEventListener('pointerdown', () => moveState.forward = -1);
  document.getElementById('btn-left').addEventListener('pointerdown', () => moveState.turn = -1);
  document.getElementById('btn-right').addEventListener('pointerdown', () => moveState.turn = 1);
  document.getElementById('btn-stop').addEventListener('click', stopMove);

  document.addEventListener('pointerup', stopMove);

  // テクスチャ変更
  document.getElementById('texture-upload').addEventListener('change', onTextureSelected);
}

// ---------------------- テクスチャ変更 ----------------------
function onTextureSelected(e) {
  if (!facePlateMaterial) {
    alert('Face_Plate が見つからないため、テクスチャを適用できません。');
    return;
  }
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const texLoader = new THREE.TextureLoader();
    texLoader.load(
      reader.result,
      (tex) => {
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        if (facePlateMaterial.map) facePlateMaterial.map.dispose();
        facePlateMaterial.map = tex;
        facePlateMaterial.needsUpdate = true;
      },
      undefined,
      (err) => console.error(err)
    );
  };
  reader.readAsDataURL(file);
}

// ---------------------- リサイズ ----------------------
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------------------- 毎フレーム ----------------------
function renderLoop(timestamp, frame) {
  const delta = clock.getDelta();

  // 初回に hit-test source を取る
  const session = renderer.xr.getSession();
  if (session && !hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then((refSpace) => {
      session.requestHitTestSource({ space: refSpace }).then((source) => {
        hitTestSource = source;
      });
    });
    session.addEventListener('end', () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
    });
    hitTestSourceRequested = true;
  }

  // ヒットテストで reticle を動かす
  if (frame && hitTestSource) {
    const refSpace = renderer.xr.getReferenceSpace();
    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length) {
      const hit = hits[0];
      const pose = hit.getPose(refSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);

      // 画面タップでモデルを置く
      renderer.domElement.onclick = () => {
        if (model) {
          model.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
          model.quaternion.set(
            pose.transform.orientation.x,
            pose.transform.orientation.y,
            pose.transform.orientation.z,
            pose.transform.orientation.w
          );
          if (!model.parent) scene.add(model);
        }
      };
    } else {
      reticle.visible = false;
    }
  }

  // モデルの移動・回転
  if (model && model.parent) {
    if (moveState.forward !== 0) {
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(model.quaternion);
      model.position.addScaledVector(dir, moveState.forward * MOVE_SPEED * delta);
    }
    if (moveState.turn !== 0) {
      // Y軸回転
      model.rotateY(-moveState.turn * TURN_SPEED * delta);
    }
  }

  renderer.render(scene, camera);
}
