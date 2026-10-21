"use client";

import { useEffect, useRef } from "react";
import { FLUID_FRAG } from "./fluid-shader";

const VERT = "attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }";

export function FluidDots({ size = 28 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const gl = cv?.getContext("webgl", { premultipliedAlpha: true, alpha: true });
    if (!cv || !gl) return;
    const mk = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    const vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FLUID_FRAG);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "iResolution"), uTime = gl.getUniformLocation(prog, "iTime"), uTint = gl.getUniformLocation(prog, "uTint");
    const px = Math.round(size * 4 * Math.min(window.devicePixelRatio || 1, 2));
    cv.width = px; cv.height = px; gl.viewport(0, 0, px, px);
    const t0 = performance.now();
    let raf = 0;
    const frame = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      if (dark) gl.uniform3f(uTint, 1, 1, 1); else gl.uniform3f(uTint, 0.1, 0.1, 0.12);
      gl.uniform2f(uRes, px, px);
      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { cancelAnimationFrame(raf); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf); };
  }, [size]);
  return <canvas ref={ref} aria-hidden style={{ width: size * 4, height: size * 4, margin: -size * 1.5, display: "block", pointerEvents: "none" }} />;
}
