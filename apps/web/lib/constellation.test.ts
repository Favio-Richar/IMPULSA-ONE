import { describe, expect, it } from "vitest";
import {
  HUB,
  PULSE_SECONDS,
  SCENE_BUDGETS,
  chooseSceneQuality,
  connectConstellation,
  createNodes,
  createRng,
  damp,
  fibonacciSphere,
  pulseAt,
  pulseIntensity,
  type DeviceHints,
} from "./constellation";

const desktop: DeviceHints = { webgl: true, reducedMotion: false, saveData: false, viewportWidth: 1440, cores: 8, memoryGb: 8 };

describe("calidad de la escena según el dispositivo (ADR-009)", () => {
  it("un escritorio capaz recibe la escena animada completa", () => {
    expect(chooseSceneQuality(desktop)).toEqual({ mode: "animated", tier: "high" });
  });

  it("sin WebGL o con ahorro de datos no hay escena: queda el fondo CSS", () => {
    expect(chooseSceneQuality({ ...desktop, webgl: false }).mode).toBe("off");
    expect(chooseSceneQuality({ ...desktop, saveData: true }).mode).toBe("off");
  });

  it("con movimiento reducido se pinta un cuadro fijo, sin animación", () => {
    expect(chooseSceneQuality({ ...desktop, reducedMotion: true }).mode).toBe("static");
  });

  it("teléfonos y equipos modestos usan la versión liviana", () => {
    expect(chooseSceneQuality({ ...desktop, viewportWidth: 412 }).tier).toBe("low");
    expect(chooseSceneQuality({ ...desktop, cores: 4 }).tier).toBe("low");
    expect(chooseSceneQuality({ ...desktop, memoryGb: 2 }).tier).toBe("low");
    expect(chooseSceneQuality({ webgl: true, reducedMotion: false, saveData: false, viewportWidth: 1280 }).tier).toBe("high");
  });

  it("la versión liviana es de verdad más liviana en todo", () => {
    const { low, high } = SCENE_BUDGETS;
    expect(low.dust).toBeLessThan(high.dust);
    expect(low.nodes).toBeLessThan(high.nodes);
    expect(low.pulses).toBeLessThan(high.pulses);
    expect(low.maxPixelRatio).toBeLessThanOrEqual(high.maxPixelRatio);
    expect(high.maxPixelRatio).toBeLessThanOrEqual(2);
  });
});

describe("geometría", () => {
  it("la semilla hace la figura reproducible y los valores quedan en [0, 1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    const values = Array.from({ length: 200 }, () => a());
    expect(values).toEqual(Array.from({ length: 200 }, () => b()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(createRng(7)()).not.toBe(createRng(8)());
  });

  it("la esfera de Fibonacci pone cada punto sobre el radio y los reparte en ambos hemisferios", () => {
    const points = fibonacciSphere(500, 3, createRng(1));
    expect(points).toHaveLength(1500);
    let above = 0;
    for (let index = 0; index < 500; index += 1) {
      const [x, y, z] = [points[index * 3]!, points[index * 3 + 1]!, points[index * 3 + 2]!];
      expect(Math.hypot(x, y, z)).toBeCloseTo(3, 5);
      if (y > 0) above += 1;
    }
    expect(Math.abs(above - 250)).toBeLessThanOrEqual(2);
  });

  it("con jitter los puntos se alejan del radio, pero dentro del margen pedido", () => {
    const points = fibonacciSphere(300, 2, createRng(3), 0.2);
    for (let index = 0; index < 300; index += 1) {
      const r = Math.hypot(points[index * 3]!, points[index * 3 + 1]!, points[index * 3 + 2]!);
      expect(r).toBeGreaterThanOrEqual(1.6 - 1e-6);
      expect(r).toBeLessThanOrEqual(2.4 + 1e-6);
    }
    expect(fibonacciSphere(1, 1, createRng(1))[1]).toBe(0);
  });

  it("los nodos quedan en la cáscara pedida, con tamaños acotados", () => {
    const nodes = createNodes(26, createRng(9), 1.6, 3);
    expect(nodes).toHaveLength(26);
    for (const node of nodes) {
      const horizontal = Math.hypot(node.x, node.z);
      expect(Math.hypot(horizontal, node.y / 0.8)).toBeGreaterThanOrEqual(1.6 - 1e-6);
      expect(Math.hypot(horizontal, node.y / 0.8)).toBeLessThanOrEqual(3 + 1e-6);
      expect(node.size).toBeGreaterThanOrEqual(0.07);
      expect(node.size).toBeLessThan(0.16);
    }
  });
});

describe("conexiones", () => {
  const nodes = createNodes(20, createRng(5), 1.6, 3);

  it("todos los nodos se unen al centro", () => {
    const edges = connectConstellation(nodes, 3);
    const toHub = edges.filter(([a]) => a === HUB).map(([, b]) => b);
    expect(toHub).toEqual(nodes.map((_, index) => index));
  });

  it("sin aristas repetidas, sin lazos y siempre a < b", () => {
    const edges = connectConstellation(nodes, 3);
    const keys = edges.map(([a, b]) => `${a}:${b}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [a, b] of edges) {
      expect(a).toBeLessThan(b);
    }
  });

  it("cada nodo queda unido al menos a sus k vecinos más cercanos", () => {
    const k = 3;
    const edges = connectConstellation(nodes, k);
    for (let index = 0; index < nodes.length; index += 1) {
      const degree = edges.filter(([a, b]) => a !== HUB && (a === index || b === index)).length;
      expect(degree).toBeGreaterThanOrEqual(k);
    }
  });

  it("el vecino unido es de verdad el más cercano", () => {
    const edges = connectConstellation(nodes, 1);
    const node = nodes[0]!;
    let nearest = -1;
    let best = Infinity;
    nodes.forEach((other, index) => {
      if (index === 0) return;
      const d = (other.x - node.x) ** 2 + (other.y - node.y) ** 2 + (other.z - node.z) ** 2;
      if (d < best) {
        best = d;
        nearest = index;
      }
    });
    expect(edges).toContainEqual([0, nearest]);
  });

  it("con pocos nodos no inventa vecinos", () => {
    const two = createNodes(2, createRng(1), 1, 2);
    expect(connectConstellation(two, 5)).toEqual([[HUB, 0], [HUB, 1], [0, 1]]);
    expect(connectConstellation([], 3)).toEqual([]);
  });
});

describe("pulsos y suavizado", () => {
  it("el progreso siempre está en [0, 1) y la arista existe", () => {
    for (let index = 0; index < 20; index += 1) {
      for (let time = 0; time < 30; time += 0.73) {
        const { edge, progress } = pulseAt(index, time, 37);
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThan(1);
        expect(edge).toBeGreaterThanOrEqual(0);
        expect(edge).toBeLessThan(37);
      }
    }
    expect(pulseAt(3, 5, 0)).toEqual({ edge: 0, progress: 0 });
  });

  it("dentro de una vuelta el pulso avanza por la misma arista; al completarla cambia de arista", () => {
    const start = pulseAt(0, 0, 50);
    const later = pulseAt(0, PULSE_SECONDS * 0.5, 50);
    expect(later.edge).toBe(start.edge);
    expect(later.progress).toBeCloseTo(0.5, 5);
    expect(pulseAt(0, PULSE_SECONDS * 1.01, 50).edge).not.toBe(start.edge);
  });

  it("los pulsos arrancan desfasados entre sí", () => {
    const progresses = new Set(Array.from({ length: 8 }, (_, index) => pulseAt(index, 0, 40).progress.toFixed(3)));
    expect(progresses.size).toBe(8);
  });

  it("el brillo del pulso nace y muere en cero y es máximo a mitad de camino", () => {
    expect(pulseIntensity(0)).toBeCloseTo(0, 6);
    expect(pulseIntensity(1)).toBeCloseTo(0, 6);
    expect(pulseIntensity(0.5)).toBeCloseTo(1, 6);
    expect(pulseIntensity(-2)).toBeCloseTo(0, 6);
  });

  it("damp converge al objetivo sin pasarse y no se mueve con dt = 0", () => {
    expect(damp(0, 1, 5, 0)).toBe(0);
    let value = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      const next = damp(value, 1, 5, 1 / 60);
      expect(next).toBeGreaterThan(value);
      expect(next).toBeLessThanOrEqual(1);
      value = next;
    }
    expect(value).toBeCloseTo(1, 3);
    // Independiente de los FPS: un paso de 2/60 equivale a dos de 1/60.
    expect(damp(0, 1, 5, 2 / 60)).toBeCloseTo(damp(damp(0, 1, 5, 1 / 60), 1, 5, 1 / 60), 10);
  });
});
