"use client";

import { useEffect, useRef, useState } from "react";
import {
  HUB,
  SCENE_BUDGETS,
  chooseSceneQuality,
  connectConstellation,
  createNodes,
  createRng,
  damp,
  fibonacciSphere,
  pulseAt,
  pulseIntensity,
  type SceneMode,
} from "../../lib/constellation";

/** Estado que la escena publica en `data-scene` (lo leen las pruebas de Playwright). */
type SceneState = "pending" | SceneMode | "error";

const TEAL = 0x0f6f6b;
const TEAL_SOFT = 0x5fb3ab;
const TEAL_LIGHT = 0x99d9d2;
const PULSE = 0x0d9488;
const SEED = 20260927;
/** Instante fijo que se dibuja con movimiento reducido: pulsos repartidos, ninguno apagado del todo. */
const PULSE_STILL_TIME = 1.3;

function detectWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return context !== null;
  } catch {
    return false;
  }
}

function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: 1500 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 300);
  return () => window.clearTimeout(handle);
}

// Puntos redondos y difusos; los lejanos se apagan. `aAlpha` permite que cada pulso tenga su brillo.
const POINT_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aScale;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * aScale * uPixelRatio / -mvPosition.z;
    vAlpha = aAlpha * smoothstep(-15.0, -6.0, mvPosition.z);
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float distanceToCenter = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.05, distanceToCenter) * uOpacity * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/**
 * "Constelación de enlaces" del hero comercial (ADR-009): tu enlace en el centro, lo que Impulza
 * conecta alrededor, y pulsos que viajan como visitas. Va en la columna del teléfono, entre el mosaico
 * de plantillas y el teléfono, nunca detrás del texto. Pura decoración: `aria-hidden`, sin puntero. three.js se carga recién cuando el navegador está
 * ocioso; sin WebGL 2, con ahorro de datos o ante cualquier fallo queda el fondo CSS de siempre.
 */
export function HeroScene({ className = "" }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // WCAG 2.2.2: todo movimiento que arranca solo y dura más de 5 s se tiene que poder pausar.
  const [canPause, setCanPause] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const syncLoopRef = useRef<(() => void) | null>(null);

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    syncLoopRef.current?.();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Se escribe directo en el DOM: es solo una marca para las pruebas, no cambia lo que se pinta.
    const report = (state: SceneState) => {
      container.dataset.scene = state;
    };
    report("pending");

    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const quality = chooseSceneQuality({
      webgl: detectWebGL2(),
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      saveData: connection?.saveData === true,
      viewportWidth: window.innerWidth,
      cores: navigator.hardwareConcurrency || undefined,
      memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    });
    if (quality.mode === "off") {
      report("off");
      return;
    }

    let cancelled = false;
    let teardown: (() => void) | undefined;

    const cancelIdle = whenIdle(() => {
      import("three")
        .then((THREE) => {
          if (cancelled) return;
          const budget = SCENE_BUDGETS[quality.tier];
          const animated = quality.mode === "animated";
          const rng = createRng(SEED);

          const renderer = new THREE.WebGLRenderer({ antialias: budget.antialias, alpha: true, powerPreference: "low-power" });
          const pixelRatio = Math.min(window.devicePixelRatio || 1, budget.maxPixelRatio);
          renderer.setPixelRatio(pixelRatio);
          renderer.setClearColor(0x000000, 0);
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.domElement.style.width = "100%";
          renderer.domElement.style.height = "100%";
          renderer.domElement.style.display = "block";
          container.appendChild(renderer.domElement);

          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
          camera.position.set(0, 0, 10);

          scene.add(new THREE.HemisphereLight(0xffffff, 0xcfeae6, 1.6));
          const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
          keyLight.position.set(3, 5, 6);
          scene.add(keyLight);

          // `tilt` sigue al puntero; `spin` gira solo. Separados para que no se mezclen los ejes.
          const tilt = new THREE.Group();
          const spin = new THREE.Group();
          tilt.add(spin);
          scene.add(tilt);

          const disposables: Array<{ dispose: () => void }> = [];
          const track = <T extends { dispose: () => void }>(item: T): T => {
            disposables.push(item);
            return item;
          };

          // Polvo de fondo.
          const dustCount = budget.dust;
          const dustGeometry = track(new THREE.BufferGeometry());
          dustGeometry.setAttribute("position", new THREE.BufferAttribute(fibonacciSphere(dustCount, 3.6, rng, 0.35), 3));
          dustGeometry.setAttribute("aScale", new THREE.BufferAttribute(Float32Array.from({ length: dustCount }, () => 0.5 + rng()), 1));
          dustGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(dustCount).fill(1), 1));
          const pointUniforms = (color: number, size: number, opacity: number) => ({
            uColor: { value: new THREE.Color(color) },
            uSize: { value: size },
            uOpacity: { value: opacity },
            uPixelRatio: { value: pixelRatio },
          });
          const dustMaterial = track(
            new THREE.ShaderMaterial({
              uniforms: pointUniforms(TEAL_SOFT, 70, 0.55),
              vertexShader: POINT_VERTEX,
              fragmentShader: POINT_FRAGMENT,
              transparent: true,
              depthWrite: false,
            }),
          );
          spin.add(new THREE.Points(dustGeometry, dustMaterial));

          // Nodos y centro.
          const nodes = createNodes(budget.nodes, rng, 1.7, 3.1);
          const sphere = track(new THREE.SphereGeometry(1, budget.antialias ? 24 : 16, budget.antialias ? 16 : 12));
          const nodeMaterial = track(
            new THREE.MeshStandardMaterial({ color: TEAL, roughness: 0.35, metalness: 0.15, emissive: TEAL, emissiveIntensity: 0.18 }),
          );
          const nodeMesh = new THREE.InstancedMesh(sphere, nodeMaterial, nodes.length);
          const matrix = new THREE.Matrix4();
          nodes.forEach((node, index) => {
            matrix.makeScale(node.size, node.size, node.size).setPosition(node.x, node.y, node.z);
            nodeMesh.setMatrixAt(index, matrix);
          });
          spin.add(nodeMesh);

          const hub = new THREE.Mesh(sphere, track(new THREE.MeshStandardMaterial({ color: TEAL, roughness: 0.25, metalness: 0.2, emissive: TEAL, emissiveIntensity: 0.35 })));
          hub.scale.setScalar(0.34);
          spin.add(hub);
          const shellGeometry = track(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.66, 1)));
          const shell = new THREE.LineSegments(shellGeometry, track(new THREE.LineBasicMaterial({ color: TEAL_SOFT, transparent: true, opacity: 0.55 })));
          spin.add(shell);
          const ring = new THREE.Mesh(
            track(new THREE.RingGeometry(0.95, 1.0, 64)),
            track(new THREE.MeshBasicMaterial({ color: TEAL_LIGHT, transparent: true, opacity: 0.6, side: THREE.DoubleSide })),
          );
          ring.rotation.x = Math.PI * 0.42;
          spin.add(ring);

          // Conexiones.
          const edges = connectConstellation(nodes, budget.neighbors);
          const endpoint = (index: number) => (index === HUB ? { x: 0, y: 0, z: 0 } : nodes[index]!);
          const edgePositions = new Float32Array(edges.length * 6);
          edges.forEach(([a, b], index) => {
            const from = endpoint(a);
            const to = endpoint(b);
            edgePositions.set([from.x, from.y, from.z, to.x, to.y, to.z], index * 6);
          });
          const edgeGeometry = track(new THREE.BufferGeometry());
          edgeGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));
          spin.add(new THREE.LineSegments(edgeGeometry, track(new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0.2 }))));

          // Pulsos que viajan por las conexiones.
          const pulseCount = budget.pulses;
          const pulsePositions = new Float32Array(pulseCount * 3);
          const pulseAlpha = new Float32Array(pulseCount);
          const pulseGeometry = track(new THREE.BufferGeometry());
          const pulsePositionAttribute = new THREE.BufferAttribute(pulsePositions, 3);
          const pulseAlphaAttribute = new THREE.BufferAttribute(pulseAlpha, 1);
          pulseGeometry.setAttribute("position", pulsePositionAttribute);
          pulseGeometry.setAttribute("aAlpha", pulseAlphaAttribute);
          pulseGeometry.setAttribute("aScale", new THREE.BufferAttribute(new Float32Array(pulseCount).fill(1), 1));
          const pulseMaterial = track(
            new THREE.ShaderMaterial({
              uniforms: pointUniforms(PULSE, 170, 0.95),
              vertexShader: POINT_VERTEX,
              fragmentShader: POINT_FRAGMENT,
              transparent: true,
              depthWrite: false,
            }),
          );
          spin.add(new THREE.Points(pulseGeometry, pulseMaterial));

          const updatePulses = (time: number) => {
            for (let index = 0; index < pulseCount; index += 1) {
              const { edge, progress } = pulseAt(index, time, edges.length);
              const [a, b] = edges[edge]!;
              const from = endpoint(a);
              const to = endpoint(b);
              // Los pulsos del centro salen hacia afuera: como una visita que entra por tu enlace.
              pulsePositions[index * 3] = from.x + (to.x - from.x) * progress;
              pulsePositions[index * 3 + 1] = from.y + (to.y - from.y) * progress;
              pulsePositions[index * 3 + 2] = from.z + (to.z - from.z) * progress;
              pulseAlpha[index] = pulseIntensity(progress);
            }
            pulsePositionAttribute.needsUpdate = true;
            pulseAlphaAttribute.needsUpdate = true;
          };

          // Centrada en el teléfono; se achica si la columna es angosta para que no se corte.
          const layout = () => {
            const width = container.clientWidth || 1;
            const height = container.clientHeight || 1;
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            tilt.scale.setScalar(Math.min(1, camera.aspect));
          };

          let pointerX = 0;
          let pointerY = 0;
          const onPointerMove = (event: PointerEvent) => {
            pointerX = (event.clientX / window.innerWidth) * 2 - 1;
            pointerY = (event.clientY / window.innerHeight) * 2 - 1;
          };

          const timer = new THREE.Timer();
          let elapsed = 0;
          const pose = (time: number) => {
            spin.rotation.y = time * 0.07;
            shell.rotation.y = -time * 0.25;
            shell.rotation.x = time * 0.12;
            updatePulses(time);
          };
          // Al volver de una pausa el primer delta sería enorme: se limita a 0,1 s.
          const frame = (timestamp?: number) => {
            timer.update(timestamp);
            const delta = Math.min(timer.getDelta(), 0.1);
            elapsed += delta;
            tilt.rotation.x = damp(tilt.rotation.x, 0.18 + pointerY * 0.12, 3, delta);
            tilt.rotation.y = damp(tilt.rotation.y, pointerX * 0.25, 3, delta);
            pose(elapsed);
            renderer.render(scene, camera);
          };

          const renderStill = () => {
            tilt.rotation.set(0.18, 0, 0);
            pose(PULSE_STILL_TIME);
            renderer.render(scene, camera);
          };

          // Solo se anima con la escena en pantalla, la pestaña visible y sin pausa del visitante.
          let onScreen = true;
          const syncLoop = () => {
            const run = animated && !pausedRef.current && onScreen && document.visibilityState === "visible";
            renderer.setAnimationLoop(run ? frame : null);
          };
          const intersection = new IntersectionObserver(([entry]) => {
            onScreen = entry?.isIntersecting ?? true;
            syncLoop();
          });
          intersection.observe(container);
          const resize = new ResizeObserver(() => {
            layout();
            if (!animated) renderStill();
          });
          resize.observe(container);
          document.addEventListener("visibilitychange", syncLoop);
          syncLoopRef.current = syncLoop;
          if (animated) window.addEventListener("pointermove", onPointerMove, { passive: true });

          const onContextLost = (event: Event) => {
            event.preventDefault();
            renderer.setAnimationLoop(null);
            report("error");
          };
          renderer.domElement.addEventListener("webglcontextlost", onContextLost);

          layout();
          if (animated) {
            frame();
            syncLoop();
          } else {
            renderStill();
          }
          report(quality.mode);
          setCanPause(animated);
          requestAnimationFrame(() => setVisible(true));

          teardown = () => {
            syncLoopRef.current = null;
            renderer.setAnimationLoop(null);
            intersection.disconnect();
            resize.disconnect();
            document.removeEventListener("visibilitychange", syncLoop);
            window.removeEventListener("pointermove", onPointerMove);
            renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
            nodeMesh.dispose();
            for (const item of disposables) item.dispose();
            timer.dispose();
            renderer.dispose();
            renderer.domElement.remove();
          };
        })
        .catch(() => {
          if (!cancelled) report("error");
        });
    });

    return () => {
      cancelled = true;
      cancelIdle();
      teardown?.();
    };
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        aria-hidden="true"
        className={`pointer-events-none absolute transition-opacity duration-1000 ease-out [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_60%,transparent_100%)] ${visible ? "opacity-100" : "opacity-0"} ${className}`}
      />
      {canPause ? (
        <button
          type="button"
          onClick={togglePause}
          aria-pressed={paused}
          aria-label={paused ? "Reanudar la animación" : "Pausar la animación"}
          title={paused ? "Reanudar la animación" : "Pausar la animación"}
          className="absolute bottom-0 right-0 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-[#e2e8f0] bg-white/90 text-[#0f172a] shadow-sm backdrop-blur transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {paused ? (
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current">
              <path d="M4 2.5v11l9-5.5z" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current">
              <path d="M4 2.5h3v11H4zm5 0h3v11H9z" />
            </svg>
          )}
        </button>
      ) : null}
    </>
  );
}
