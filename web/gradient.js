/* The living marble behind the chat and the landing hero: three colours flowing slowly into each
   other. One small WebGL shader (it replaces a 1.25 MB 3D bundle that did the same job).
   window.CassieGradient.mount(el, { props: { color1, color2, color3, brightness, uSpeed }, still, pixelDensity })
   → { update(props), destroy() }. Colours glide to new ones over 0.7 s; it pauses while the tab
   is hidden and draws once when still (reduced motion). */
(function () {
  'use strict';
  const MARBLE = { color1: '#18171e', color2: '#8e8a92', color3: '#f1ebe1', brightness: 1.15, uSpeed: 0.22 };
  const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec3 c1,c2,c3;uniform float b;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.)*1.4;
  float q=fbm(p+vec2(t*.05,t*.03));
  float w=fbm(p+q*1.9+vec2(-t*.035,t*.025));
  float s=clamp(w*1.25+(uv.x-uv.y)*.35-.1,0.,1.);
  vec3 col=mix(c1,c2,smoothstep(0.,.55,s));col=mix(col,c3,smoothstep(.45,1.,s));
  gl_FragColor=vec4(min(col*(.82+.15*b),1.),1.);
}`;
  const rgb = (hex) => { const v = parseInt(String(hex || '#000000').slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };

  function mount(el, opts = {}) {
    let props = { ...MARBLE, ...(opts.props || {}) };
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) throw new Error('no webgl');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; ['r', 't', 'c1', 'c2', 'c3', 'b'].forEach((k) => { U[k] = gl.getUniformLocation(prog, k); });
    el.appendChild(canvas);

    let cols = ['color1', 'color2', 'color3'].map((k) => rgb(props[k]));
    let from = cols, to = cols, fadeAt = 0;
    const dpr = Math.min(opts.pixelDensity || 1, window.devicePixelRatio || 1);
    // its size, kept up to date by the ResizeObserver below (reading it every frame made the page lay itself
    // out every frame, a freeze of about 100 ms on a slow phone right after a jump down the page)
    let cw = el.clientWidth, ch = el.clientHeight, seen = true;
    function size() {
      if (!ro) { cw = el.clientWidth; ch = el.clientHeight; }
      const w = Math.max(1, Math.round(cw * dpr * 0.5)), h = Math.max(1, Math.round(ch * dpr * 0.5)); // half resolution: it's a soft blur anyway
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    }
    const t0 = performance.now();
    let raf = 0, last = 0, alive = true;
    function draw(now) {
      size();
      const k = fadeAt ? Math.min(1, (now - fadeAt) / 700) : 1, e = k * k * (3 - 2 * k);
      cols = from.map((c, i) => c.map((v, j) => v + (to[i][j] - v) * e));
      if (k >= 1) { from = to; fadeAt = 0; }
      gl.uniform2f(U.r, canvas.width, canvas.height);
      gl.uniform1f(U.t, opts.still ? 7 : ((now - t0) / 1000) * (props.uSpeed || 0.22) * 4);
      gl.uniform3fv(U.c1, cols[0]); gl.uniform3fv(U.c2, cols[1]); gl.uniform3fv(U.c3, cols[2]);
      gl.uniform1f(U.b, props.brightness || 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function loop(now) {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden || !seen) return; // (scrolled out of sight: nothing to draw)
      if (now - last < 33) return; // about 30 frames a second is plenty for a slow drift
      last = now; draw(now);
    }
    const ro = window.ResizeObserver ? new ResizeObserver(() => { cw = el.clientWidth; ch = el.clientHeight; if (opts.still) requestAnimationFrame(draw); }) : null;
    if (ro) ro.observe(el);
    const io = window.IntersectionObserver ? new IntersectionObserver((es) => { seen = es[es.length - 1].isIntersecting; }) : null;
    if (io) io.observe(el);
    if (opts.still) requestAnimationFrame(draw); else raf = requestAnimationFrame(loop);
    return {
      update(p = {}) {
        props = { ...props, ...p };
        from = cols; to = ['color1', 'color2', 'color3'].map((k) => rgb(props[k])); fadeAt = performance.now();
        if (opts.still) { fadeAt = 0; from = to; requestAnimationFrame(draw); }
      },
      destroy() { alive = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect(); canvas.remove(); const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); },
    };
  }
  window.CassieGradient = { mount, MARBLE };
})();
