<template>
  <div class="map-container" v-if="refresh" id="map-container"></div>
</template>

<script lang="ts">
import * as THREE from "three";
import * as d3 from "d3";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import Stats from "three/examples/jsm/libs/stats.module.js";

const PROJECTION_CENTER: any = [106.76581, 30.640725];
const PROJECTION_SCALE: any = 250;
let downbias = 30;

let textureLoader = new THREE.TextureLoader();
let map = new THREE.Group();
let bars: any = [];
const textloader = new FontLoader();
let container: any = null;
let scene: any = null;
let camera: any = null;
let renderer: any = null;
let controller: any = null;
let heightp: any = null;
let heightbar: any = {};
let datalist: any = {};
let composer: any = null;
let stats: any = null;
let blockp: any = null;
let textobj: any = [];
let timer: any = null;
let timeindex: any = 0;
let handlerId: any = null;

@Component
export default class Map3D extends Vue {
  private static cachedFont: any = null;
  private static readonly BAR_BASE_HEIGHT = 12;
  private static readonly NORMAL_BAR_SIZE = 2;
  private static readonly HIGHLIGHT_BAR_SIZE = 4;
  private static readonly MAX_BAR_HEIGHT = 80;
  private static readonly HIGHLIGHT_BLOCK_DEPTH = 6;

  clock: any = new THREE.Clock();
  glowComposer: any = null;
  finalComposer: any = null;
  unrealBloomPass: any = null;
  nowp: any = {
    name: "",
    value: 0,
  };
  CNjson: any = require("@/assets/json/100000_full.json");
  location: any = require("@/assets/json/location.json");
  refresh: any = true;

  private readonly projection = d3
    .geoMercator()
    .center(PROJECTION_CENTER)
    .scale(PROJECTION_SCALE)
    .translate([0, 0]);
  private provinceDataMap: Map<string, any> = new Map();
  private highlightBlockCache: Map<string, THREE.Object3D> = new Map();

  private highlightSideMaterial!: THREE.MeshBasicMaterial;
  private highlightTopMaterial!: THREE.MeshBasicMaterial;
  private normalBarMaterial!: THREE.MeshBasicMaterial;
  private normalTopMaterial!: THREE.MeshBasicMaterial;
  private highlightBarMaterial!: THREE.MeshStandardMaterial; // 高亮柱体材质

  private isCarouselPaused = false;
  max: any = 1;
  geoinfo: any = {
    aiFileCountList: [],
  };
  nowProvince: string = "";

  async mounted() {
    try {
      await this.preloadTextures();
      this.init();
      window.addEventListener("resize", this.onWindowResize, false);
    } catch (error) {
      console.error("Failed to initialize:", error);
    }
  }

  private async preloadTextures(): Promise<void> {
    const loadTexture = (url: string) => {
      return new Promise<THREE.Texture>((resolve, reject) => {
        textureLoader.load(url, resolve, undefined, (err) => reject(err));
      });
    };

    const [hlmTexture, hlSideTexture, bar2Texture, bar3Texture] =
      await Promise.all([
        loadTexture(require("@/assets/img/mapimg/hlm.png")),
        loadTexture(require("@/assets/img/mapimg/HL-SIDE.png")),
        loadTexture(require("@/assets/img/mapimg/bar2.png")),
        loadTexture(require("@/assets/img/mapimg/bar3.png")), // 加载高亮柱体纹理
      ]);

    hlmTexture.format = THREE.RGBAFormat;
    hlSideTexture.format = THREE.RGBAFormat;
    bar2Texture.format = THREE.RGBAFormat;
    bar3Texture.format = THREE.RGBAFormat;

    hlSideTexture.wrapS = THREE.RepeatWrapping;
    hlSideTexture.wrapT = THREE.RepeatWrapping;
    hlSideTexture.repeat.set(1, 0.1);

    this.highlightTopMaterial = new THREE.MeshBasicMaterial({
      map: hlmTexture,
      transparent: true,
    });
    this.highlightSideMaterial = new THREE.MeshBasicMaterial({
      map: hlSideTexture,
      transparent: true,
    });
    this.normalBarMaterial = new THREE.MeshBasicMaterial({
      map: bar2Texture,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.normalTopMaterial = new THREE.MeshBasicMaterial({ color: 0xe3fcfb });

    // 为高亮柱体创建更亮的材质
    this.highlightBarMaterial = new THREE.MeshStandardMaterial({
      map: bar3Texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      metalness: 0.1,
      roughness: 0.8,
    });
  }

  beforeDestroy() {
    clearInterval(timer);
    this.disposeScene();
    const divElement: any = document.getElementById("map-container");
    if (divElement) {
      divElement.removeEventListener("mousemove", this.onMouseMove, false);
      divElement.removeEventListener("click", this.onMouseClick, false);
      divElement.removeEventListener("mouseleave", this.onMouseLeave, false);
    }
  }

  disposeScene() {
    if (scene) {
      scene.traverse((child: any) => {
        if (child.material) {
          if (child.material instanceof Array) {
            child.material.forEach((mat: any) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
        if (child.geometry) {
          child.geometry.dispose();
        }
      });
      scene.clear();
    }

    this.highlightBlockCache.forEach((block) => {
      block.traverse((child: any) => {
        if (child.material) child.material.dispose();
        if (child.geometry) child.geometry.dispose();
      });
    });
    this.highlightBlockCache.clear();

    if (this.highlightTopMaterial) this.highlightTopMaterial.dispose();
    if (this.highlightSideMaterial) this.highlightSideMaterial.dispose();
    if (this.normalBarMaterial) this.normalBarMaterial.dispose();
    if (this.normalTopMaterial) this.normalTopMaterial.dispose();
    if (this.highlightBarMaterial) this.highlightBarMaterial.dispose();

    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
    if (composer) composer.dispose();
    if (this.glowComposer) this.glowComposer.dispose();
    if (this.finalComposer) this.finalComposer.dispose();

    cancelAnimationFrame(handlerId);
    this.provinceDataMap.clear();
    bars = [];
    map = new THREE.Group();

    scene = null;
    camera = null;
    renderer = null;
    controller = null;
    this.refresh = false;
  }

  init() {
    container = document.getElementById("map-container");
    if (!container) {
      console.error("Map container not found!");
      return;
    }
    this.setScene();
    this.setCamera();
    this.setRenderer();
    this.setLight();
    this.setController();
    this.addStatus();
    this.initGeoJson();
    this.renderf();
    this.initmouse();
    this.inittimer();
  }

  setLight() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 4);
    directionalLight.position.set(0.2, 1, -1);
    scene.add(directionalLight);
  }

  logTransform(value: any, base: any = 0.5) {
    if (value <= 0) return 0;
    return Math.pow(value, base);
  }

  initData(data: any) {
    this.geoinfo = data;
    this.provinceDataMap.clear();
    datalist = {};
    this.max = 1;

    this.location.province.forEach((province: any) => {
      this.provinceDataMap.set(province.name, province);
    });

    this.geoinfo.aiFileCountList.forEach((count: any) => {
      const province = this.provinceDataMap.get(count.provinceName);
      if (province) {
        const num = count.aiReview ?? 0;
        datalist[province.name] = num;
        this.max = Math.max(this.max, num);
      }
    });
    this.initBars();
  }

  onMouseMove(event: any) {
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    mouse.x = (x / rect.width) * 2 - 1;
    mouse.y = -(y / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      const targetObj = intersects[0].object;
      if (targetObj.name && targetObj.name.includes("block")) {
        if (heightp !== targetObj.name) {
          this.pauseCarousel();
          this.heightchange(targetObj.name);
        }
      }
    }
  }

  onMouseLeave() {
    this.restartCarousel();
  }

  inittimer() {
    let list: any = Array.from(this.provinceDataMap.keys()).map(
      (name) => `block-${name}`
    );
    timer = setInterval(() => {
      timeindex = (timeindex + 1) % list.length;
      let name = list[timeindex];
      this.heightchange(name);
    }, 5 * 1000);
  }

  private pauseCarousel() {
    if (!this.isCarouselPaused && timer) {
      clearInterval(timer);
      timer = null;
      this.isCarouselPaused = true;
    }
  }

  private restartCarousel() {
    if (this.isCarouselPaused && !timer) {
      this.inittimer();
      this.isCarouselPaused = false;
    }
  }

  initmouse() {
    const divElement: any = document.getElementById("map-container");
    divElement.addEventListener("mousemove", this.onMouseMove, false);
    divElement.addEventListener("click", this.onMouseClick, false);
    divElement.addEventListener("mouseleave", this.onMouseLeave, false);
  }

  onMouseClick() {
    // 可以保持为空或添加点击交互逻辑
  }

  heightchange(name: any) {
    let pname;

    // 先检查 name 是否为有效字符串
    if (typeof name === "string" && name.includes("-")) {
      pname = name.split("-")[1];
    } else {
      // 如果 name 不是字符串，或不包含 '-', 则直接使用 name 本身
      // 你也可以根据需求给一个默认值，比如 ''
      pname = name;
    }
    if (!pname || this.nowProvince === pname) return;

    // --- 新增逻辑：恢复上一个高亮省份的普通柱体 ---
    if (heightp) {
      const oldPname = heightp.split("-")[1];
      const oldProvinceInfo = this.provinceDataMap.get(oldPname);
      if (oldProvinceInfo) {
        // 这里不再是重新创建，而是找到并恢复
        const normalBarObj = bars.find((obj: any) => obj.name === oldPname);
        if (normalBarObj) {
          scene.add(normalBarObj.cube);
          scene.add(normalBarObj.top);
        }
      }
    }

    // 更新新的高亮
    this.nowProvince = pname;
    this.$emit("changeProvince", pname);
    this.hightlightbar(pname);
    this.addheightblock(pname);
    this.nowp.value = datalist[pname] || 0;
    this.nowp.name = pname;
    this.updateInfoText(pname, this.nowp.value);

    heightp = name;
  }

  addheightblock(provinceName: string) {
    if (blockp) {
      scene.remove(blockp);
    }

    let maphl: any = this.highlightBlockCache.get(provinceName);
    if (!maphl) {
      maphl = this.createHighlightBlockForProvince(provinceName);
      if (!maphl) {
        console.warn(`Failed to create highlight block for: ${provinceName}`);
        blockp = null;
        return;
      }
      this.highlightBlockCache.set(provinceName, maphl);
    }

    scene.add(maphl);
    blockp = maphl;
  }

  private createHighlightBlockForProvince(
    provinceName: string
  ): THREE.Object3D | null {
    const maphl = new THREE.Group();
    const meshArrs = new THREE.Group();

    let pinfo: any = {};
    const found = this.CNjson.features.some((feature: any) => {
      if (feature.properties.name.includes(provinceName)) {
        pinfo = feature;
        return true;
      }
      return false;
    });
    if (!found || !pinfo.properties) {
      return null;
    }

    const coordinates = pinfo.geometry.coordinates;
    coordinates.forEach((multiPolygon: any) => {
      multiPolygon.forEach((polygon: any) => {
        const shape = new THREE.Shape();
        for (let i = 0; i < polygon.length; i++) {
          const point: any = this.projection(polygon[i]);
          const x = point[0],
            y = -point[1];
          i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
        }

        const extrudeSettings = {
          depth: Map3D.HIGHLIGHT_BLOCK_DEPTH,
          bevelEnabled: false,
        };
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

        const mesh = new THREE.Mesh(geometry, [
          this.highlightTopMaterial.clone(),
          this.highlightSideMaterial.clone(),
        ]);

        mesh.rotateX(-Math.PI / 2);
        mesh.position.set(0, 14, downbias);
        meshArrs.add(mesh);
      });
    });

    maphl.add(meshArrs);
    return maphl;
  }
  hightlightbar(provinceName: string) {
    if (heightbar.top && heightbar.cube) {
      scene.remove(heightbar.top);
      scene.remove(heightbar.cube);
    }
    heightbar.top = null;
    heightbar.cube = null;

    const pinfo = this.provinceDataMap.get(provinceName);
    if (!pinfo) return;

    const value = datalist[provinceName] || 0;
    const normalizedHeight = this.logTransform(value);
    const barHeight = (Map3D.MAX_BAR_HEIGHT * normalizedHeight) / this.max || 5;
    const loca: any = this.projection([pinfo.lon, pinfo.lat - 5]);

    const barMeshes = this.createBarMesh(
      loca[0],
      loca[1],
      barHeight * 1.5,
      Map3D.HIGHLIGHT_BAR_SIZE,
      this.highlightBarMaterial,
      this.normalTopMaterial
    );
    if (barMeshes) {
      heightbar.cube = barMeshes.cube;
      heightbar.top = barMeshes.top;
      scene.add(heightbar.cube);
      scene.add(heightbar.top);
    }

    // --- 新增逻辑：隐藏对应的普通柱体 ---
    const normalBarObj = bars.find((obj: any) => obj.name === provinceName);
    if (normalBarObj) {
      scene.remove(normalBarObj.cube);
      scene.remove(normalBarObj.top);
    }
  }

  private createBarMesh(
    x: number,
    z: number,
    height: number,
    size: number,
    cubeMaterial: THREE.Material,
    topMaterial: THREE.Material
  ): { cube: THREE.Mesh; top: THREE.Mesh } | null {
    if (height <= 0) return null;

    const geometry = new THREE.BoxGeometry(size, height, size);
    const cube = new THREE.Mesh(geometry, cubeMaterial);
    cube.position.set(x, Map3D.BAR_BASE_HEIGHT + height / 2, z);
    cube.rotation.y = Math.PI / 4;

    const topGeometry = new THREE.PlaneGeometry(size, size);
    const topPlane = new THREE.Mesh(topGeometry, topMaterial);
    topPlane.position.set(x, Map3D.BAR_BASE_HEIGHT + height + 0.01, z);
    topPlane.rotation.x = -Math.PI / 2;
    topPlane.rotation.z = Math.PI / 4;

    return { cube, top: topPlane };
  }

  initnomalbar(element: any) {
    const value = datalist[element.name] ?? 0;
    if (value <= 0) return;

    const normalizedHeight = this.logTransform(value);
    const barHeight = (Map3D.MAX_BAR_HEIGHT * normalizedHeight) / this.max;
    const loca: any = this.projection([element.lon, element.lat - 5]);

    const barMeshes = this.createBarMesh(
      loca[0],
      loca[1],
      barHeight,
      Map3D.NORMAL_BAR_SIZE,
      this.normalBarMaterial.clone(),
      this.normalTopMaterial.clone()
    );
    if (barMeshes) {
      const cubeobj = {
        top: barMeshes.top,
        cube: barMeshes.cube,
        name: element.name,
      };
      bars.push(cubeobj);
      scene.add(barMeshes.top);
      scene.add(barMeshes.cube);
    }
  }

  initBars() {
    bars.forEach((obj: any) => {
      scene.remove(obj.cube);
      scene.remove(obj.top);
    });
    bars = [];
    this.location.province.forEach((element: any) =>
      this.initnomalbar(element)
    );
  }

  private updateInfoText(provinceName: string, value: number) {
    const pinfo = this.provinceDataMap.get(provinceName);
    if (!pinfo) return;

    const loca: any = this.projection([pinfo.lon, pinfo.lat - 5]);
    const normalizedHeight = this.logTransform(datalist[provinceName] || 0);
    const barHeight = (Map3D.MAX_BAR_HEIGHT * normalizedHeight) / this.max || 5;

    const textinfo = {
      name: provinceName,
      xyz: [loca[0], Map3D.BAR_BASE_HEIGHT + barHeight + 10, loca[2]],
      value: value,
    };
    this.addText(textinfo);
  }

  // ... [其余未修改的函数保持不变] ...
  setScene() {
    scene = new THREE.Scene();
  }
  setCamera() {
    camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(40, 360, 200);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    camera.lookAt(new THREE.Vector3(0, 0, 0));
    scene.add(camera);
  }
  onWindowResize() {
    if (camera && container) {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
      if (composer)
        composer.setSize(container.clientWidth, container.clientHeight);
    }
  }
  setRenderer() {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      logarithmicDepthBuffer: true,
    });
    renderer.shadowMap.enabled = true;
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    renderer.setClearColor(0xffffff, 0);
  }
  setController() {
    controller = new OrbitControls(camera, renderer.domElement);
    controller.enablePan = false;
    controller.enableZoom = false;
    controller.enableRotate = false;
    controller.enableDamping = true;
    controller.dampingFactor = 0.04;
    controller.target.set(0, 0.5, 0);
  }
  addStatus() {
    stats = new Stats();
  }
  initGeoJson() {
    this.initMap();
  }
  initMap() {
    const material5 = new THREE.MeshStandardMaterial({
      color: 0x338ad8,
      transparent: true,
      emissive: new THREE.Color("#1f1315"),
      emissiveIntensity: 2,
      opacity: 0.1,
    });
    const material12 = new THREE.MeshStandardMaterial({
      color: 0x338ad8,
      transparent: true,
      emissive: new THREE.Color("#74d0e2"),
      emissiveIntensity: 100,
      opacity: 0.2,
    });
    const material1 = new THREE.MeshPhongMaterial({
      color: 0x338ad8,
      transparent: true,
      shininess: 50,
      opacity: 0.8,
    });
    let textureMMID = textureLoader.load(
      require("@/assets/img/mapimg/chinawx1.png")
    );
    const scaleMMID = 0.0035;
    textureMMID.repeat.set(scaleMMID, scaleMMID);
    textureMMID.offset.set(0.543, 0.375);
    const materialMMID = new THREE.MeshStandardMaterial({
      map: textureMMID,
      color: "rgba(25,69,108,1)",
      transparent: false,
      opacity: 1,
    });
    this.CNjson.features.forEach((elem: any) => {
      const meshArrs = new THREE.Object3D();
      elem.geometry.coordinates.forEach((multiPolygon: any) => {
        multiPolygon.forEach((polygon: any) => {
          const shape = new THREE.Shape();
          polygon.forEach((p: any, i: number) => {
            const point: any = this.projection(p);
            const x = point[0],
              y = -point[1];
            i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
          });
          const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: 0.2,
            bevelEnabled: false,
          });
          const mesh = new THREE.Mesh(geometry, [material5, material12]);
          mesh.rotateX(-Math.PI / 2);
          mesh.position.set(0, 14.5, downbias);
          meshArrs.add(mesh);
          mesh.name = "block-" + elem.properties.name;
          const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3,
          });
          const edges = new THREE.EdgesGeometry(geometry);
          const edgesMesh = new THREE.LineSegments(edges, edgeMaterial);
          edgesMesh.rotateX(-Math.PI / 2);
          edgesMesh.position.set(0, 14.5, downbias);
          meshArrs.add(edgesMesh);
        });
      });
      map.add(meshArrs);
    });
    this.CNjson.features.forEach((elem: any) => {
      const meshArrs = new THREE.Object3D();
      elem.geometry.coordinates.forEach((multiPolygon: any) => {
        multiPolygon.forEach((polygon: any) => {
          const shape = new THREE.Shape();
          polygon.forEach((p: any, i: number) => {
            const point: any = this.projection(p);
            const x = point[0],
              y = -point[1];
            i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
          });
          const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: 12,
            bevelEnabled: false,
          });
          const mesh = new THREE.Mesh(geometry, [materialMMID, material1]);
          mesh.name = elem.properties.name;
          mesh.rotateX(-Math.PI / 2);
          mesh.position.set(0, 1.5, downbias);
          meshArrs.add(mesh);
        });
      });
      map.add(meshArrs);
    });
    scene.add(map);
  }
  createComposer() {
    const renderScene = new RenderPass(scene, camera);
    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
  }
  createEffectComposer() {
    let renderScene = new RenderPass(scene, camera);
    this.unrealBloomPass = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      1,
      1.1,
      0.3
    );
    this.glowComposer = new EffectComposer(renderer);
    this.glowComposer.renderToScreen = false;
    this.glowComposer.addPass(renderScene);
    this.glowComposer.addPass(this.unrealBloomPass);
    this.finalComposer = new EffectComposer(renderer);
    this.finalComposer.addPass(renderScene);
  }
  renderf() {
    this.animate();
  }
  animate() {
    requestAnimationFrame(this.animate);
    if (controller) controller.update();
    if (stats) stats.update();
    if (composer) {
      composer.render();
    } else if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }
  addText(info: any) {
    let value = info.value;
    if (
      value == undefined ||
      value == null ||
      value == "undefined" ||
      value == "null" ||
      value == "NaN" ||
      value == ""
    )
      value = "-";
    if (Map3D.cachedFont) {
      this.createTextMesh(Map3D.cachedFont, info, value);
      return;
    }
    textloader.load("./fonts/Alimama ShuHeiTi_Bold.json", (font: any) => {
      Map3D.cachedFont = font;
      this.createTextMesh(font, info, value);
    });
  }
  private createTextMesh(font: any, info: any, value: any) {
    if (textobj) {
      scene.remove(textobj);
      if (textobj.geometry) textobj.geometry.dispose();
      if (textobj.material) textobj.material.dispose();
    }
    const geometry = new TextGeometry(info.name, {
      font: font,
      size: 4,
      height: 0.001,
    });
    geometry.center();
    const materials = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthTest: false,
    });
    const textMesh = new THREE.Mesh(geometry, materials);
    textMesh.position.set(info.xyz[0], info.xyz[1] + 30, info.xyz[2]);
    textMesh.rotation.set(-1, 0, 0.2);
    scene.add(textMesh);
    textobj = textMesh;
  }
}
</script>
