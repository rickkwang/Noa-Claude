import { useEffect, useRef } from "react";
import { useIsDark } from "../hooks/useIsDark";
import type { AppSettings } from "../types";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const MAX_DROPS = 24;
const MAX_ACTIVE_DROPS = 24;
const MAX_OBSTACLES = 8;
const DROP_LIFETIME = 2.4;
const DROP_COOLDOWN_MS = 50;

const VERT_SRC = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const NOISE_GLSL = `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  return 0.57 * noise(p) + 0.28 * noise(p * 2.03 + 7.1) + 0.15 * noise(p * 4.07 + 21.3);
}
`;

const FIELD_FRAG_SRC = `
precision highp float;
uniform vec2 size;
uniform vec2 cell;
uniform float time;
uniform float scale;
uniform float seed;
uniform vec4 drops[24];
uniform int count;
uniform vec4 obsBox[8];
uniform float obsRadius[8];
uniform int obsCount;
${NOISE_GLSL}

float sdRoundBox(vec2 pt, vec2 b, float r) {
  vec2 q = abs(pt) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float obsSdf(vec2 pt) {
  float d = 1e5;
  for (int j = 0; j < 8; j++) {
    if (j < obsCount) {
      d = min(d, sdRoundBox(pt - obsBox[j].xy, obsBox[j].zw, obsRadius[j]));
    }
  }
  return d;
}

void main() {
  vec2 p = (floor(gl_FragCoord.xy) + 0.5) * cell;
  float flow = time * 0.025;
  float dObs = obsSdf(p);
  float obsMask = obsCount > 0 ? smoothstep(0.0, 18.0, dObs) : 1.0;
  float edgeDrag = obsCount > 0 ? (1.0 - smoothstep(0.0, 38.0, dObs)) * 14.0 : 0.0;

  vec2 q = p / max(scale, 0.4);
  vec2 drift = vec2(flow * 0.37, -flow * 0.27) + seed;
  vec2 warp = vec2(fbm(q * 0.005 + drift), fbm(q * 0.005 + drift + 25.0));
  float water = fbm(q * 0.014 + warp * 3.2 + drift);
  float fine = noise(q * 0.039 + warp * 2.0 + drift * 1.6);
  float calm = fbm(q * 0.008 + vec2(time * 0.012, -time * 0.009) + seed);
  float gray = pow(smoothstep(0.48, 0.74, calm), 1.7) * 0.47;

  float blue = 0.0;
  float wake = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i < count) {
      float age = time - drops[i].z;
      if (age > 0.0 && age < 2.4) {
        vec2 delta = (p - drops[i].xy) / max(scale, 0.4);
        float distance = length(delta);
        float radius = 475.0 * (1.0 - exp(-age * 1.45));
        float bend = fbm(q * 0.007 + drops[i].xy * 0.017 + vec2(drops[i].z * 11.3) + drift * 0.55) - 0.5;
        float wrinkle = noise(q * 0.027 + warp * 2.7 + drift) - 0.5;
        float refractRamp = smoothstep(0.06, 0.45, age);
        float distortion = (bend * (60.0 + min(age, 2.0) * 90.0) + wrinkle * 16.0) * refractRamp;
        float edge = distance + distortion + edgeDrag - radius;
        float width = 18.0 + 24.0 * (1.0 - exp(-age * 1.4));
        float ring = exp(-pow(edge / width, 2.0));
        float breakup = mix(1.0, smoothstep(0.28 + age * 0.09, 0.56 + age * 0.07, water + fine * 0.16), refractRamp);
        float fade = 1.0 - smoothstep(0.45, 1.75, age);
        float crest = ring * breakup * fade;

        float wakeBand = smoothstep(-140.0 - 55.0 * (1.0 - exp(-age * 1.3)), -16.0, edge) * (1.0 - smoothstep(-8.0, 30.0, edge));
        float tail = wakeBand * (1.0 - smoothstep(0.8, 2.1, age));
        float eddies = pow(smoothstep(0.43, 0.69, water * 0.85 + fine * 0.22), 1.5);
        float filaments = exp(-abs(water - 0.51) * 20.0);
        eddies = mix(eddies, filaments * 0.55, 0.35);
        float onset = smoothstep(0.0, 0.05, age);

        float minPath = 1e5;
        if (obsCount > 0) {
          minPath = min(minPath, obsSdf(mix(drops[i].xy, p, 0.25)));
          minPath = min(minPath, obsSdf(mix(drops[i].xy, p, 0.45)));
          minPath = min(minPath, obsSdf(mix(drops[i].xy, p, 0.65)));
          minPath = min(minPath, obsSdf(mix(drops[i].xy, p, 0.85)));
        }
        float transmit = obsCount > 0 ? smoothstep(-24.0, 16.0, minPath) : 1.0;

        float dropBlue = (crest * 0.68 + tail * eddies * 0.45) * drops[i].w * onset * transmit;
        blue = max(blue, dropBlue);
        float grayBand = smoothstep(-145.0 - 50.0 * (1.0 - exp(-age * 1.2)), -15.0, edge) * (1.0 - smoothstep(-6.0, 24.0, edge));
        float grayTail = grayBand * (1.0 - smoothstep(1.0, 2.4, age));
        float dropWake = grayTail * (0.05 + 0.72 * pow(smoothstep(0.40, 0.70, water), 1.5)) * transmit;
        wake = max(wake, dropWake);
      }
    }
  }

  gray = max(gray, wake);
  blue = 0.72 * pow(clamp(blue * 1.65, 0.0, 1.0), 0.64);
  float grain = 0.67 + 0.33 * hash(floor(p / cell) + 31.0);
  gray *= grain * obsMask;
  blue *= grain * obsMask;
  gl_FragColor = vec4(clamp(gray, 0.0, 1.0), blue, 0.0, 1.0);
}
`;

const DRAW_FRAG_SRC = `
precision highp float;
uniform sampler2D field;
uniform sampler2D atlas;
uniform vec2 resolution;
uniform vec2 size;
uniform vec2 grid;
uniform vec2 cell;
uniform float time;
uniform float seed;
uniform float isDark;
uniform vec3 accentColor;
${NOISE_GLSL}

void main() {
  vec2 p = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) * size / resolution;
  vec2 id = floor(p / cell);
  vec2 within = fract(p / cell);
  vec2 light = texture2D(field, (id + 0.5) / grid).rg;

  float tick = floor(time * 1.6 + hash(id) * 13.0);
  float glyph = floor(hash(id + vec2(tick * 7.13, seed + tick * 0.17)) * 62.0);
  vec2 tile = vec2(mod(glyph, 16.0), floor(glyph / 16.0));
  vec2 uv = (tile + within) / vec2(16.0, 4.0);
  float ink = texture2D(atlas, uv).a;

  vec3 grayInk = isDark > 0.5 ? vec3(0.54, 0.55, 0.58) : vec3(0.51, 0.50, 0.49);
  vec3 color = mix(grayInk, accentColor, smoothstep(0.015, 0.46, light.y));
  float alpha = isDark > 0.5
    ? clamp(light.x * 0.48 + light.y * 1.15, 0.0, 0.85)
    : clamp(light.x * 0.38 + light.y * 0.80, 0.0, 0.75);

  gl_FragColor = vec4(color, alpha * ink);
}
`;

type DropEntry = [number, number, number, number];

function readAccentRgb(isDark: boolean): [number, number, number] {
  const fallback: [number, number, number] = isDark ? [0.26, 0.58, 0.86] : [0.40, 0.44, 0.70];
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim();
  if (!raw) return fallback;
  if (raw.startsWith("#")) {
    const hex = raw.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt((hex[0] ?? "0") + (hex[0] ?? "0"), 16);
      const g = Number.parseInt((hex[1] ?? "0") + (hex[1] ?? "0"), 16);
      const b = Number.parseInt((hex[2] ?? "0") + (hex[2] ?? "0"), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return [r / 255, g / 255, b / 255];
      }
    } else if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return [r / 255, g / 255, b / 255];
      }
    }
  }
  const match = raw.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (match) {
    const r = Number.parseFloat(match[1] ?? "0");
    const g = Number.parseFloat(match[2] ?? "0");
    const b = Number.parseFloat(match[3] ?? "0");
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r / 255, g / 255, b / 255];
    }
  }
  return fallback;
}

interface GlResources {
  field: WebGLProgram;
  draw: WebGLProgram;
  buffer: WebGLBuffer;
  fieldTex: WebGLTexture;
  atlasTex: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

export function DigitalWavesBackground({
  theme,
}: {
  theme: AppSettings["appearance"]["theme"];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDark = useIsDark(theme);
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const cell: [number, number] = [6.5, 13];
    const seed = 7;
    const fontSize = 9.5;
    let disposed = false;
    let lost = false;
    let time = 0;
    let last = performance.now();
    let raf = 0;
    let width = 1;
    let height = 1;
    let cols = 1;
    let rows = 1;
    let dpr = 1;
    let lastDropMs = 0;
    let accentRgb = readAccentRgb(isDarkRef.current);
    let manual: DropEntry[] = [];
    let resources: GlResources | null = null;
    const programs: WebGLProgram[] = [];
    const locations = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>();

    function compileShader(type: number, source: string): WebGLShader {
      const s = gl!.createShader(type);
      if (!s) throw new Error("Failed to create shader");
      gl!.shaderSource(s, source);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        const log = gl!.getShaderInfoLog(s) || "Shader compile error";
        gl!.deleteShader(s);
        throw new Error(log);
      }
      return s;
    }

    function createProgram(fragSource: string): WebGLProgram {
      const p = gl!.createProgram();
      if (!p) throw new Error("Failed to create program");
      const v = compileShader(gl!.VERTEX_SHADER, VERT_SRC);
      const f = compileShader(gl!.FRAGMENT_SHADER, fragSource);
      gl!.attachShader(p, v);
      gl!.attachShader(p, f);
      gl!.linkProgram(p);
      gl!.deleteShader(v);
      gl!.deleteShader(f);
      if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) {
        throw new Error(gl!.getProgramInfoLog(p) || "Program link error");
      }
      programs.push(p);
      return p;
    }

    function loc(p: WebGLProgram, name: string): WebGLUniformLocation | null {
      let map = locations.get(p);
      if (!map) {
        map = {};
        locations.set(p, map);
      }
      if (!(name in map)) {
        map[name] = gl!.getUniformLocation(p, name);
      }
      return map[name] ?? null;
    }

    function createTexture(): WebGLTexture {
      const t = gl!.createTexture();
      if (!t) throw new Error("Failed to create texture");
      gl!.bindTexture(gl!.TEXTURE_2D, t);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      return t;
    }

    function buildAtlas(atlasTex: WebGLTexture) {
      const atlasRatio = Math.max(2, dpr);
      const tw = Math.ceil(cell[0] * atlasRatio);
      const th = Math.ceil(cell[1] * atlasRatio);
      const atlasCanvas = document.createElement("canvas");
      atlasCanvas.width = tw * 16;
      atlasCanvas.height = th * 4;
      const ctx = atlasCanvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = `500 ${fontSize * atlasRatio}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      for (let i = 0; i < CHARS.length; i++) {
        const ch = CHARS[i];
        if (ch) {
          ctx.fillText(ch, (i % 16 + 0.5) * tw, Math.floor(i / 16) * th + th * 0.68);
        }
      }

      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(gl!.TEXTURE_2D, atlasTex);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, atlasCanvas);
    }

    function resize(force = false) {
      if (!resources || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (!force && w === width && h === height && dpr === ratio) return;

      width = w;
      height = h;
      dpr = ratio;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / cell[0]);
      rows = Math.ceil(h / cell[1]);

      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, resources.fieldTex);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, cols, rows, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, resources.framebuffer);
      gl!.framebufferTexture2D(
        gl!.FRAMEBUFFER,
        gl!.COLOR_ATTACHMENT0,
        gl!.TEXTURE_2D,
        resources.fieldTex,
        0,
      );
      buildAtlas(resources.atlasTex);
    }

    function init() {
      programs.length = 0;
      locations.clear();
      const buffer = gl!.createBuffer();
      if (!buffer) throw new Error("Failed to create buffer");
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
      gl!.bufferData(
        gl!.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl!.STATIC_DRAW,
      );
      const framebuffer = gl!.createFramebuffer();
      if (!framebuffer) throw new Error("Failed to create framebuffer");

      resources = {
        field: createProgram(FIELD_FRAG_SRC),
        draw: createProgram(DRAW_FRAG_SRC),
        buffer,
        fieldTex: createTexture(),
        atlasTex: createTexture(),
        framebuffer,
      };
      resize(true);
    }

    function useProgram(p: WebGLProgram) {
      if (!resources) return;
      gl!.useProgram(p);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, resources.buffer);
      const attr = gl!.getAttribLocation(p, "position");
      gl!.enableVertexAttribArray(attr);
      gl!.vertexAttribPointer(attr, 2, gl!.FLOAT, false, 0, 0);
    }

    function draw() {
      if (disposed || lost || !resources) return;
      resize();

      manual = manual.filter((d) => time - d[2] < DROP_LIFETIME);

      const active = manual.slice(-MAX_ACTIVE_DROPS);
      const data = new Float32Array(MAX_DROPS * 4);
      active.forEach((d, i) => {
        data[i * 4] = d[0] * width;
        data[i * 4 + 1] = d[1] * height;
        data[i * 4 + 2] = d[2];
        data[i * 4 + 3] = d[3];
      });

      const obsBoxes = new Float32Array(MAX_OBSTACLES * 4);
      const obsRadii = new Float32Array(MAX_OBSTACLES);
      let obsCount = 0;
      const canvasRect = canvas!.getBoundingClientRect();
      const obstacleEls = container!.querySelectorAll<HTMLElement>("[data-wave-obstacle]");
      for (const el of obstacleEls) {
        if (obsCount >= MAX_OBSTACLES) break;
        if (el.closest('[inert]') || el.closest('[data-open="false"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const pad = 8;
        const hx = r.width * 0.5 + pad;
        const hy = r.height * 0.5 + pad;
        const rawRadius = Number.parseFloat(el.dataset.waveObstacle ?? "14") || 14;
        obsBoxes[obsCount * 4] = r.left - canvasRect.left + r.width * 0.5;
        obsBoxes[obsCount * 4 + 1] = r.top - canvasRect.top + r.height * 0.5;
        obsBoxes[obsCount * 4 + 2] = hx;
        obsBoxes[obsCount * 4 + 3] = hy;
        obsRadii[obsCount] = Math.min(rawRadius + pad * 0.5, hx, hy);
        obsCount++;
      }

      const p = resources.field;
      useProgram(p);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, resources.framebuffer);
      gl!.viewport(0, 0, cols, rows);
      gl!.disable(gl!.BLEND);
      gl!.uniform2f(loc(p, "size"), width, height);
      gl!.uniform2f(loc(p, "cell"), cell[0], cell[1]);
      gl!.uniform1f(loc(p, "time"), time);
      gl!.uniform1f(loc(p, "seed"), seed);
      gl!.uniform1f(loc(p, "scale"), 1.0);
      gl!.uniform1i(loc(p, "count"), active.length);
      gl!.uniform4fv(loc(p, "drops[0]"), data);
      gl!.uniform1i(loc(p, "obsCount"), obsCount);
      gl!.uniform4fv(loc(p, "obsBox[0]"), obsBoxes);
      gl!.uniform1fv(loc(p, "obsRadius[0]"), obsRadii);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);

      const q = resources.draw;
      useProgram(q);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.enable(gl!.BLEND);
      gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, resources.fieldTex);
      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(gl!.TEXTURE_2D, resources.atlasTex);
      gl!.uniform1i(loc(q, "field"), 0);
      gl!.uniform1i(loc(q, "atlas"), 1);
      gl!.uniform2f(loc(q, "resolution"), canvas!.width, canvas!.height);
      gl!.uniform2f(loc(q, "size"), width, height);
      gl!.uniform2f(loc(q, "grid"), cols, rows);
      gl!.uniform2f(loc(q, "cell"), cell[0], cell[1]);
      gl!.uniform1f(loc(q, "time"), time);
      gl!.uniform1f(loc(q, "seed"), seed);
      gl!.uniform1f(loc(q, "isDark"), isDarkRef.current ? 1.0 : 0.0);
      gl!.uniform3f(loc(q, "accentColor"), accentRgb[0], accentRgb[1], accentRgb[2]);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }

    function drop(x: number, y: number, strength = 1) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(strength)) return;
      const now = performance.now();
      if (now - lastDropMs < DROP_COOLDOWN_MS) return;
      lastDropMs = now;
      manual.push([x / width, y / height, time - 0.016, Math.max(0, Math.min(2, strength))]);
      if (manual.length > MAX_ACTIVE_DROPS) {
        manual.shift();
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement | null)?.closest("[data-wave-obstacle]")) return;
      const rect = canvas!.getBoundingClientRect();
      drop(e.clientX - rect.left, e.clientY - rect.top);
    }

    function onLost(e: Event) {
      e.preventDefault();
      lost = true;
    }

    function onRestored() {
      lost = false;
      init();
      draw();
    }

    function loop(now: number) {
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!document.hidden && !lost) {
        time += dt;
        draw();
      }
      raf = requestAnimationFrame(loop);
    }

    try {
      init();
      draw();
    } catch {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!lost && !disposed) draw();
    });
    observer.observe(canvas);
    const themeObserver = new MutationObserver(() => {
      accentRgb = readAccentRgb(isDarkRef.current);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
    container.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      themeObserver.disconnect();
      container.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      programs.forEach((p) => gl.deleteProgram(p));
      if (resources) {
        gl.deleteTexture(resources.fieldTex);
        gl.deleteTexture(resources.atlasTex);
        gl.deleteFramebuffer(resources.framebuffer);
        gl.deleteBuffer(resources.buffer);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
    />
  );
}
