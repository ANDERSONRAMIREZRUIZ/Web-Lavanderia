/* =========================================================
   Lavandería Fanor Vargas · hero
   Escena 100% <canvas> 2D, sin librerías y sin imágenes.

   El scroll cuenta el ciclo del servicio en tres actos:
     01 Recogida · bolsa con la ropa dentro
     02 Lavado   · lavadora de carga frontal en marcha
     03 Entrega  · pila doblada, percha y etiqueta LISTO
   Se cruzan con fundidos mientras suben y bajan.

   Además: burbujas con película iridiscente, gotas al
   explotarlas, grano de película y viñeta.
   ========================================================= */

(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (a, b, x) => {
    const k = clamp((x - a) / (b - a));
    return k * k * (3 - 2 * k);
  };
  const TAU = Math.PI * 2;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const canvas = $("#scene");
  const hero = $(".hero");
  const sticky = $(".hero__sticky");
  const bar = $(".progress__bar");
  const hint = $(".hint");
  const pauseBtn = $(".pause");
  const stageEls = [...document.querySelectorAll(".stages .stage")];

  if (!canvas || !hero || !sticky) return;
  const ctx = canvas.getContext("2d", { alpha: false });

  /* ---------------- paleta (leída del CSS) ---------------- */
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;

  const INK = token("--ink", "#061019");
  const CREAM = token("--cream", "#eaf3fa");
  const ACCENT = token("--accent", "#4db8ff");
  const ACCENT_RGB = token("--accent-rgb", "77, 184, 255");
  const TEXT_RGB = "234, 243, 250";
  const SANS = '"Instrument Sans", system-ui, sans-serif';

  /* ---------------- estado ---------------- */
  let W = 1, H = 1, dpr = 1;
  let S = 100;              // unidad de la escena
  let cx = 0, cy = 0;       // centro de la escena

  let t = 0;                // tiempo de animación (s)
  let target = 0, cur = 0;  // progreso de scroll
  let mx = 0, my = 0, tmx = 0, tmy = 0;

  let paused = false, inView = true;
  let raf = 0, last = performance.now(), dtFrame = 1 / 60;
  let boost = 0, lastY = window.scrollY;
  let stageIdx = -1;

  const bubbles = [];
  const drops = [];
  let sprites = [];
  let grainPat = [], grainIdx = 0, grainClock = 0;
  let vignette = null;
  let pointer = null;

  /* =========================================================
     0. Utilidades de dibujo
     ========================================================= */

  function rrect(x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function shadow(x, y, rx, ry, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.55, `rgba(0,0,0,${a * 0.42})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* pequeña prenda doblada, usada en la bolsa y dentro del tambor */
  function fabric(x, y, w, h, rot, c1, c2, seam = true) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    rrect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.32);
    ctx.fillStyle = g;
    ctx.fill();

    if (seam) {
      ctx.beginPath();
      ctx.moveTo(-w * 0.28, -h * 0.06);
      ctx.lineTo(w * 0.28, -h * 0.06);
      ctx.strokeStyle = "rgba(6,16,25,0.22)";
      ctx.lineWidth = Math.max(1, S * 0.008);
      ctx.stroke();
    }

    /* filo superior iluminado */
    ctx.beginPath();
    ctx.moveTo(-w * 0.34, -h * 0.46);
    ctx.lineTo(w * 0.32, -h * 0.46);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(0.8, S * 0.006);
    ctx.stroke();

    ctx.restore();
  }

  function sparkle(x, y, r, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = `rgba(168,226,255,${alpha})`;
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
    ctx.moveTo(0, -r); ctx.lineTo(0, r);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.7})`;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.18, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* =========================================================
     1. Tamaños y geometría
     ========================================================= */

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const narrow = W < 900;
    S = narrow
      ? Math.min(W * 0.225, H * 0.122)
      : Math.min(W * 0.118, H * 0.21);

    cx = narrow ? W * 0.5 : W * 0.715;
    cy = narrow ? Math.max(H * 0.26, 88 + S * 1.24) : H * 0.5;

    vignette = ctx.createRadialGradient(
      W * 0.48, H * 0.42, Math.min(W, H) * 0.1,
      W * 0.5, H * 0.5, Math.max(W, H) * 0.82
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.55, "rgba(0,0,0,0.14)");
    vignette.addColorStop(1, "rgba(0,0,0,0.6)");

    if (!sprites.length) buildSprites();
    seedBubbles();
    buildGrain();
  }

  /* =========================================================
     2. Burbujas
     ========================================================= */

  function bubbleSprite(size, hue) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const r = size / 2;

    const body = g.createRadialGradient(r * 0.84, r * 0.76, r * 0.05, r, r, r);
    body.addColorStop(0, "rgba(255,255,255,0.02)");
    body.addColorStop(0.7, "rgba(170,220,255,0.035)");
    body.addColorStop(0.94, "rgba(255,255,255,0.10)");
    body.addColorStop(1, "rgba(255,255,255,0)");
    g.beginPath();
    g.arc(r, r, r * 0.99, 0, TAU);
    g.fillStyle = body;
    g.fill();

    /* película fina */
    for (let i = 0; i < 7; i++) {
      const rr = r * (0.56 + i * 0.061);
      g.beginPath();
      g.arc(r, r, rr, 0, TAU);
      g.strokeStyle = `hsla(${hue + i * 18}, 85%, ${74 - i * 3}%, ${0.14 - i * 0.011})`;
      g.lineWidth = r * 0.05;
      g.stroke();
    }

    /* filo */
    g.save();
    g.shadowColor = "rgba(120, 200, 255, 0.45)";
    g.shadowBlur = r * 0.07;
    g.beginPath();
    g.arc(r, r, r * 0.955, 0, TAU);
    g.strokeStyle = "rgba(255,255,255,0.28)";
    g.lineWidth = Math.max(1, r * 0.013);
    g.stroke();
    g.restore();

    /* reflejo frío abajo a la derecha */
    const rim2 = g.createRadialGradient(r * 1.34, r * 1.36, 0, r * 1.34, r * 1.36, r * 0.34);
    rim2.addColorStop(0, "rgba(170, 225, 255, 0.28)");
    rim2.addColorStop(1, "rgba(170, 225, 255, 0)");
    g.fillStyle = rim2;
    g.beginPath();
    g.arc(r, r, r * 0.99, 0, TAU);
    g.fill();

    /* reflejo principal */
    const hx = r * 0.66, hy = r * 0.62, hr = r * 0.3;
    const spec = g.createRadialGradient(hx, hy, 0, hx, hy, hr);
    spec.addColorStop(0, "rgba(255,255,255,0.92)");
    spec.addColorStop(0.32, "rgba(255,255,255,0.26)");
    spec.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = spec;
    g.beginPath();
    g.arc(hx, hy, hr, 0, TAU);
    g.fill();

    g.fillStyle = "rgba(255,255,255,0.8)";
    g.beginPath();
    g.arc(r * 1.3, r * 1.28, r * 0.02, 0, TAU);
    g.fill();

    return c;
  }

  function buildSprites() {
    sprites = [
      bubbleSprite(256, 196),
      bubbleSprite(256, 186),
      bubbleSprite(256, 206),
    ];
  }

  function newBubble(anywhere) {
    const narrow = W < 900;
    const maxR = narrow ? 30 : 52;
    const r = (narrow ? 7 : 10) + Math.random() * Math.random() * maxR;

    let x;
    if (narrow) {
      x = rand(W * 0.03, W * 0.97);
    } else {
      /* fuera de la columna de texto: borde izquierdo o mitad derecha */
      x = Math.random() < 0.76
        ? rand(W * 0.56, W * 1.02)
        : rand(-W * 0.02, W * 0.07);
    }

    return {
      x,
      y: anywhere ? rand(-H * 0.1, H * 1.05) : H + r + rand(0, H * 0.35),
      r,
      vy: rand(6, 15) * (0.6 + r / 70),
      ph: rand(0, TAU),
      fq: rand(0.25, 0.6),
      drift: rand(6, 18),
      alpha: rand(0.2, 0.5) * (r > 42 ? 0.78 : 1),
      pushX: 0,
      pop: -1,
      sprite: sprites[(Math.random() * sprites.length) | 0],
    };
  }

  function seedBubbles() {
    bubbles.length = 0;
    const n = W < 760 ? 8 : 13;
    for (let i = 0; i < n; i++) bubbles.push(newBubble(true));
  }

  function updateBubbles(dt) {
    for (const b of bubbles) {
      if (b.pop >= 0) {
        b.pop += dt;
        if (b.pop > 1.2) Object.assign(b, newBubble(false));
        continue;
      }

      b.y -= (b.vy + Math.max(0, boost) * 1.6) * dt;
      b.x += Math.sin(t * b.fq + b.ph) * b.drift * dt + b.pushX * dt;
      b.pushX *= Math.exp(-dt * 2.4);

      if (pointer) {
        const dx = b.x - pointer.x;
        const dy = b.y - pointer.y;
        const d = Math.hypot(dx, dy);
        const reach = b.r + 90;
        if (d < reach && d > 0.01) {
          const f = (1 - d / reach) * 260;
          b.pushX += (dx / d) * f * dt;
          b.y += (dy / d) * f * dt * 1.4;
        }
      }

      if (b.y + b.r < -20) Object.assign(b, newBubble(false));
      if (b.x < -b.r * 3) b.x = W + b.r;
      if (b.x > W + b.r * 3) b.x = -b.r;
    }
  }

  function popAt(x, y) {
    let hit = null;
    for (const b of bubbles) {
      if (b.pop >= 0) continue;
      if (Math.hypot(b.x - x, b.y - y) < b.r + 6) hit = b;
    }
    if (!hit) return false;

    hit.pop = 0;
    for (let i = 0; i < 16; i++) {
      const a = rand(0, TAU);
      const sp = rand(50, 190);
      drops.push({
        x: hit.x,
        y: hit.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        r: rand(0.8, 2.6),
        life: 1,
      });
    }
    return true;
  }

  function updateDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.life -= dt * 1.5;
      if (d.life <= 0) { drops.splice(i, 1); continue; }
      d.vy += 260 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }
  }

  /* =========================================================
     3. Grano
     ========================================================= */

  function buildGrain() {
    grainPat = [];
    for (let k = 0; k < 4; k++) {
      const c = document.createElement("canvas");
      c.width = c.height = 150;
      const g = c.getContext("2d");
      const img = g.createImageData(150, 150);
      for (let i = 0; i < img.data.length; i += 4) {
        const val = 84 + Math.random() * 110;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      grainPat.push(ctx.createPattern(c, "repeat"));
    }
  }

  function drawGrain() {
    if (reduce) return;
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = grainPat[grainIdx];
    ctx.translate(-rand(0, 150), -rand(0, 150));
    ctx.fillRect(0, 0, W + 150, H + 150);
    ctx.restore();
  }

  /* =========================================================
     3.4 Entorno urbano · Siluetas estáticas de la ciudad
     ========================================================= */

  const cityFarData = [
    { w: 90, h: 260 },
    { w: 120, h: 330 },
    { w: 75, h: 210 },
    { w: 105, h: 290 },
    { w: 140, h: 360 },
    { w: 90, h: 240 },
    { w: 110, h: 310 },
    { w: 80, h: 270 },
    { w: 130, h: 340 },
    { w: 75, h: 220 },
    { w: 115, h: 300 },
    { w: 95, h: 250 }
  ];

  const cityMidData = [
    { w: 85, h: 180, step: 0 },
    { w: 110, h: 240, step: 1 },
    { w: 95, h: 195, step: 0 },
    { w: 125, h: 270, step: 2 },
    { w: 90, h: 185, step: 0 },
    { w: 105, h: 230, step: 1 },
    { w: 80, h: 170, step: 0 },
    { w: 115, h: 250, step: 2 },
    { w: 95, h: 205, step: 0 },
    { w: 120, h: 260, step: 1 }
  ];

  function drawCity(roadY, progress, alpha) {
    const u = S;
    ctx.save();
    ctx.globalAlpha = alpha;

    /* 1. Silueta de los cerros al fondo en constante desplazamiento de camino */
    const mountShift = -(progress * 160 + t * 5) % (W + 600);
    ctx.save();
    ctx.fillStyle = "#071624";
    ctx.beginPath();
    ctx.moveTo(-100, roadY);
    for (let x = -100; x <= W + 200; x += 60) {
      const mx = x - mountShift;
      const my = roadY - u * 1.6 - Math.sin(mx * 0.0035) * u * 0.45 - Math.cos(mx * 0.007) * u * 0.25;
      ctx.lineTo(x, my);
    }
    ctx.lineTo(W + 200, roadY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    /* 2. Siluetas de rascacielos lejanos (puras siluetas oscuras en movimiento) */
    const farTotal = cityFarData.reduce((acc, b) => acc + b.w + 16, 0);
    const farShift = -(progress * 420 + t * 14) % farTotal;

    ctx.save();
    ctx.fillStyle = "#0a1f30";
    for (let loop = -1; loop <= Math.ceil(W / farTotal) + 1; loop++) {
      let bx = loop * farTotal + farShift;
      for (const b of cityFarData) {
        if (bx + b.w > -100 && bx < W + 100) {
          const bh = b.h * (u / 120);
          rrect(bx, roadY - bh, b.w, bh, 2);
          ctx.fill();
        }
        bx += b.w + 16;
      }
    }
    ctx.restore();

    /* 3. Siluetas urbanas intermedias en paralaje (sin ventanas blancas) */
    const midTotal = cityMidData.reduce((acc, b) => acc + b.w + 14, 0);
    const midShift = -(progress * 820 + t * 32) % midTotal;

    for (let loop = -1; loop <= Math.ceil(W / midTotal) + 1; loop++) {
      let bx = loop * midTotal + midShift;
      for (const b of cityMidData) {
        if (bx + b.w > -100 && bx < W + 100) {
          const bh = b.h * (u / 120);

          const bG = ctx.createLinearGradient(0, roadY - bh, 0, roadY);
          bG.addColorStop(0, "#112c3f");
          bG.addColorStop(0.6, "#0b2030");
          bG.addColorStop(1, "#071622");
          ctx.fillStyle = bG;

          if (b.step === 1) {
            rrect(bx, roadY - bh * 0.8, b.w, bh * 0.8, 3);
            ctx.fill();
            rrect(bx + b.w * 0.15, roadY - bh, b.w * 0.7, bh * 0.25, 2);
            ctx.fill();
          } else if (b.step === 2) {
            rrect(bx, roadY - bh * 0.85, b.w, bh * 0.85, 3);
            ctx.fill();
            rrect(bx + b.w * 0.25, roadY - bh, b.w * 0.5, bh * 0.18, 2);
            ctx.fill();
          } else {
            rrect(bx, roadY - bh, b.w, bh, 3);
            ctx.fill();
          }

          /* Borde sutil arquitectónico sin luces blancas */
          ctx.strokeStyle = "rgba(77, 184, 255, 0.15)";
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        bx += b.w + 14;
      }
    }

    /* 4. Asfalto de la carretera */
    const roadGrad = ctx.createLinearGradient(0, roadY, 0, H);
    roadGrad.addColorStop(0, "#071520");
    roadGrad.addColorStop(0.2, "#05101a");
    roadGrad.addColorStop(1, "#030a10");
    ctx.fillStyle = roadGrad;
    ctx.fillRect(0, roadY, W, H - roadY);

    /* Línea de bordillo en azul acento tenue */
    ctx.beginPath();
    ctx.moveTo(0, roadY);
    ctx.lineTo(W, roadY);
    ctx.strokeStyle = "rgba(77, 184, 255, 0.26)";
    ctx.lineWidth = Math.max(1, u * 0.012);
    ctx.stroke();

    /* Líneas de carril discontinuas en movimiento continuo (efecto de ir en camino) */
    const dashSpacing = 82;
    const dashLen = 46;
    const dashH = Math.max(2, u * 0.018);
    const dashY = roadY + u * 0.16;
    const dashShift = -(progress * 1900 + t * 90) % dashSpacing;

    ctx.fillStyle = "rgba(77, 184, 255, 0.35)";
    for (let dx = dashShift - dashSpacing; dx < W + dashSpacing; dx += dashSpacing) {
      rrect(dx, dashY, dashLen, dashH, 1);
      ctx.fill();
    }

    ctx.restore();
  }

  /* =========================================================
     3.5 Acto 00 · Camioneta de recogida y entrega a domicilio
     ========================================================= */

  function drawVan(vx, vy, progress, alpha, uScale) {
    const u = uScale || S * (W < 900 ? 1.38 : 1.58);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(vx, vy);

    /* vibración sutil solo al avanzar con el scroll */
    const isMoving = progress > 0.005;
    const vib = isMoving ? Math.sin(t * 26) * u * 0.012 : 0;
    ctx.translate(0, vib);

    /* 1. Sombra sobre el asfalto */
    shadow(0, u * 0.54, u * 1.35, u * 0.16, 0.58 * alpha);

    /* 2. Haz de luz de los faros LED (hacia la derecha) */
    const headlightGlow = ctx.createRadialGradient(
      u * 1.05, u * 0.12, u * 0.05,
      u * 1.8, u * 0.18, u * 1.05
    );
    headlightGlow.addColorStop(0, `rgba(${ACCENT_RGB}, 0.5)`);
    headlightGlow.addColorStop(0.35, `rgba(${ACCENT_RGB}, 0.15)`);
    headlightGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = headlightGlow;
    ctx.beginPath();
    ctx.moveTo(u * 1.06, u * 0.06);
    ctx.lineTo(u * 2.6, -u * 0.12);
    ctx.lineTo(u * 2.7, u * 0.62);
    ctx.lineTo(u * 1.06, u * 0.22);
    ctx.closePath();
    ctx.fill();

    /* 3. Estela aerodinámica al acelerar a la derecha */
    if (progress > 0.02) {
      ctx.save();
      const trailLen = u * (0.35 + progress * 0.9);
      const trailA = Math.min(0.65, progress * 1.6);
      ctx.strokeStyle = `rgba(${ACCENT_RGB}, ${trailA * 0.45})`;
      ctx.lineWidth = Math.max(1, u * 0.013);
      ctx.lineCap = "round";
      [-u * 0.3, -u * 0.08, u * 0.16].forEach((ty, idx) => {
        ctx.beginPath();
        ctx.moveTo(-u * 1.15, ty);
        ctx.lineTo(-u * 1.15 - trailLen * (1 - idx * 0.2), ty);
        ctx.stroke();
      });
      ctx.restore();
    }

    /* 4. Silueta de la carrocería con pasos de rueda */
    ctx.beginPath();
    ctx.moveTo(-u * 1.05, u * 0.34);
    ctx.lineTo(-u * 1.05, -u * 0.46);
    ctx.quadraticCurveTo(-u * 1.05, -u * 0.55, -u * 0.94, -u * 0.55);
    ctx.lineTo(u * 0.36, -u * 0.55);
    ctx.quadraticCurveTo(u * 0.48, -u * 0.54, u * 0.62, -u * 0.28);
    ctx.lineTo(u * 0.96, -u * 0.04);
    ctx.quadraticCurveTo(u * 1.14, -u * 0.01, u * 1.14, u * 0.18);
    ctx.lineTo(u * 1.14, u * 0.34);
    ctx.quadraticCurveTo(u * 1.12, u * 0.42, u * 1.0, u * 0.42);
    ctx.lineTo(u * 0.86, u * 0.42);
    ctx.arc(u * 0.64, u * 0.42, u * 0.22, 0, Math.PI, true);
    ctx.lineTo(-u * 0.42, u * 0.42);
    ctx.arc(-u * 0.64, u * 0.42, u * 0.22, 0, Math.PI, true);
    ctx.lineTo(-u * 0.98, u * 0.42);
    ctx.quadraticCurveTo(-u * 1.05, u * 0.42, -u * 1.05, u * 0.34);
    ctx.closePath();

    /* Degradado metálico azul noche */
    const vanG = ctx.createLinearGradient(-u * 1.05, -u * 0.55, u * 1.14, u * 0.42);
    vanG.addColorStop(0, "#255675");
    vanG.addColorStop(0.32, "#183e56");
    vanG.addColorStop(0.75, "#0e2a3c");
    vanG.addColorStop(1, "#071824");
    ctx.fillStyle = vanG;
    ctx.fill();

    /* Borde iluminado superior */
    ctx.strokeStyle = "rgba(168, 226, 255, 0.28)";
    ctx.lineWidth = Math.max(1, u * 0.012);
    ctx.stroke();

    /* 5. Franja decorativa y detalles de la carrocería */
    ctx.save();
    ctx.clip(); // clip a la carrocería

    /* Franja en degradado celeste deportivo */
    const stripeG = ctx.createLinearGradient(-u * 1.0, 0, u * 1.0, 0);
    stripeG.addColorStop(0, "rgba(77, 184, 255, 0.2)");
    stripeG.addColorStop(0.5, "rgba(77, 184, 255, 0.95)");
    stripeG.addColorStop(1, "rgba(168, 226, 255, 0.9)");

    ctx.beginPath();
    ctx.moveTo(-u * 1.05, u * 0.18);
    ctx.lineTo(u * 0.96, u * 0.18);
    ctx.lineTo(u * 0.9, u * 0.28);
    ctx.lineTo(-u * 1.05, u * 0.28);
    ctx.closePath();
    ctx.fillStyle = stripeG;
    ctx.fill();

    /* Fina línea de luz encima de la franja */
    ctx.beginPath();
    ctx.moveTo(-u * 1.05, u * 0.16);
    ctx.lineTo(u * 0.98, u * 0.16);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = Math.max(0.8, u * 0.008);
    ctx.stroke();

    /* Líneas de ensamblado de paneles */
    ctx.strokeStyle = "rgba(6, 16, 25, 0.48)";
    ctx.lineWidth = Math.max(1, u * 0.01);

    /* Puerta conductor */
    ctx.beginPath();
    ctx.moveTo(u * 0.24, -u * 0.48);
    ctx.lineTo(u * 0.24, u * 0.38);
    ctx.stroke();

    /* Puerta lateral corredera */
    ctx.beginPath();
    ctx.moveTo(-u * 0.4, -u * 0.52);
    ctx.lineTo(-u * 0.4, u * 0.38);
    ctx.stroke();

    /* Moldura parachoques delantero y trasero */
    ctx.fillStyle = "rgba(6, 16, 25, 0.55)";
    rrect(u * 0.92, u * 0.24, u * 0.22, u * 0.16, u * 0.04);
    ctx.fill();

    rrect(-u * 1.06, u * 0.28, u * 0.12, u * 0.12, u * 0.03);
    ctx.fill();
    ctx.restore();

    /* 6. Ventana lateral del conductor */
    ctx.beginPath();
    ctx.moveTo(u * 0.28, -u * 0.48);
    ctx.lineTo(u * 0.58, -u * 0.48);
    ctx.lineTo(u * 0.68, -u * 0.2);
    ctx.lineTo(u * 0.28, -u * 0.2);
    ctx.closePath();
    const winG = ctx.createLinearGradient(u * 0.3, -u * 0.48, u * 0.6, -u * 0.2);
    winG.addColorStop(0, "#8cd6fc");
    winG.addColorStop(0.35, "#2d6380");
    winG.addColorStop(1, "#0d2636");
    ctx.fillStyle = winG;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
    ctx.lineWidth = Math.max(0.8, u * 0.008);
    ctx.stroke();

    /* Brillo diagonal en la ventana */
    ctx.beginPath();
    ctx.moveTo(u * 0.38, -u * 0.46);
    ctx.lineTo(u * 0.46, -u * 0.46);
    ctx.lineTo(u * 0.34, -u * 0.22);
    ctx.lineTo(u * 0.3, -u * 0.22);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.fill();

    /* Espejo retrovisor */
    rrect(u * 0.64, -u * 0.22, u * 0.09, u * 0.11, u * 0.03);
    ctx.fillStyle = "#0c202d";
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(0.8, u * 0.008);
    ctx.stroke();

    /* 7. PUBLICIDAD Y ROTULACIÓN DE LAVANDERÍA A DOMICILIO */
    /* Logotipo circular de la marca */
    const markX = -u * 0.72;
    const markY = -u * 0.16;
    const markR = u * 0.12;
    ctx.beginPath();
    ctx.arc(markX, markY, markR, 0, TAU);
    ctx.fillStyle = "rgba(77, 184, 255, 0.18)";
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(1, u * 0.014);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(markX, markY, markR * 0.42, 0, TAU);
    ctx.fillStyle = ACCENT;
    ctx.fill();

    /* TÍTULO PRINCIPAL: "Fanor Vargas" */
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.max(7, u * 0.115)}px ${SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Fanor Vargas", -u * 0.54, -u * 0.22);

    /* PÍLDORA DESTACADA: "LAVANDERÍA A DOMICILIO" */
    rrect(-u * 0.54, -u * 0.12, u * 0.82, u * 0.14, u * 0.035);
    ctx.fillStyle = "rgba(77, 184, 255, 0.22)";
    ctx.fill();
    ctx.strokeStyle = "rgba(77, 184, 255, 0.6)";
    ctx.lineWidth = Math.max(0.7, u * 0.008);
    ctx.stroke();

    ctx.fillStyle = ACCENT;
    ctx.font = `700 ${Math.max(5, u * 0.054)}px ${SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("LAVANDERÍA A DOMICILIO", -u * 0.5, -u * 0.05);

    /* Subtexto: "Recogida & Entrega · Bogotá" */
    ctx.fillStyle = "rgba(234, 243, 250, 0.82)";
    ctx.font = `600 ${Math.max(4.5, u * 0.046)}px ${SANS}`;
    ctx.fillText("Recogida & Entrega · Bogotá", -u * 0.54, u * 0.07);

    /* 8. Faros LED delantero y piloto trasero */
    rrect(u * 1.04, u * 0.07, u * 0.08, u * 0.11, u * 0.02);
    ctx.fillStyle = "#f0f9ff";
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = u * 0.12;
    ctx.fill();
    ctx.shadowBlur = 0;

    /* Piloto trasero vertical LED en azul hielo / cian */
    rrect(-u * 1.05, -u * 0.05, u * 0.04, u * 0.22, u * 0.015);
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = u * 0.08;
    ctx.fill();
    ctx.shadowBlur = 0;

    /* 9. Ruedas de aleación con giro sincronizado con el scroll */
    const wheelAngle = progress * 36;
    const wheelR = u * 0.19;
    const rimR = u * 0.12;

    [-u * 0.64, u * 0.64].forEach((wx) => {
      const wy = u * 0.42;

      /* Neumático */
      ctx.beginPath();
      ctx.arc(wx, wy, wheelR, 0, TAU);
      ctx.fillStyle = "#060f17";
      ctx.fill();
      ctx.strokeStyle = "rgba(168, 226, 255, 0.16)";
      ctx.lineWidth = Math.max(1, u * 0.01);
      ctx.stroke();

      /* Llanta */
      ctx.beginPath();
      ctx.arc(wx, wy, rimR, 0, TAU);
      const rimG = ctx.createRadialGradient(wx, wy, 0, wx, wy, rimR);
      rimG.addColorStop(0, "#cbe8f8");
      rimG.addColorStop(0.6, "#4a7690");
      rimG.addColorStop(1, "#142d3c");
      ctx.fillStyle = rimG;
      ctx.fill();

      /* Radios girando */
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(wheelAngle);
      for (let sp = 0; sp < 5; sp++) {
        const a = (sp / 5) * TAU;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * rimR * 0.88, Math.sin(a) * rimR * 0.88);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
        ctx.lineWidth = Math.max(1.2, u * 0.016);
        ctx.stroke();
      }

      /* Tapa central */
      ctx.beginPath();
      ctx.arc(0, 0, rimR * 0.28, 0, TAU);
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.restore();
    });

    ctx.restore();
  }

  /* =========================================================
     4. Acto 01 · bolsa de recogida
     ========================================================= */

  function drawBag(alpha) {
    const u = S;
    ctx.save();
    ctx.globalAlpha = alpha;
    const bagShiftY = Math.max(0, cur - 0.16) * u * 0.7;
    ctx.translate(cx + mx * 10, cy + my * 8 - bagShiftY);

    shadow(0, u * 1.2, u * 0.92, u * 0.15, 0.55);

    /* asa */
    ctx.beginPath();
    ctx.arc(0, -u * 0.82, u * 0.42, Math.PI, TAU);
    ctx.strokeStyle = "rgba(168,226,255,0.32)";
    ctx.lineWidth = u * 0.075;
    ctx.lineCap = "round";
    ctx.stroke();

    /* tirantes del asa hasta la boca */
    ctx.beginPath();
    ctx.moveTo(-u * 0.42, -u * 0.82);
    ctx.lineTo(-u * 0.42, -u * 0.52);
    ctx.moveTo(u * 0.42, -u * 0.82);
    ctx.lineTo(u * 0.42, -u * 0.52);
    ctx.strokeStyle = "rgba(168,226,255,0.28)";
    ctx.lineWidth = u * 0.06;
    ctx.stroke();

    /* ropa asomando por la boca */
    fabric(-u * 0.32, -u * 0.82, u * 0.52, u * 0.32, -0.24, "#e3f3fd", "#93c0d8");
    fabric(u * 0.12, -u * 0.9, u * 0.58, u * 0.34, 0.12, "#f4fbff", "#b6d5e7");
    fabric(u * 0.4, -u * 0.74, u * 0.4, u * 0.28, 0.34, "#9ed9f2", "#4a93b4");
    fabric(-u * 0.02, -u * 0.7, u * 0.44, u * 0.26, 0.04, "#5b9cba", "#2b6884");
    fabric(-u * 0.5, -u * 0.68, u * 0.28, u * 0.22, 0.16, "#dceffb", "#a2c6da");

    /* cuerpo de la bolsa */
    const halfW = u * 0.78;
    const top = -u * 0.56;
    const bot = u * 1.02;

    const bagG = ctx.createLinearGradient(-halfW, 0, halfW, 0);
    bagG.addColorStop(0, "#33708c");
    bagG.addColorStop(0.45, "#1f4d66");
    bagG.addColorStop(1, "#102d3f");

    rrect(-halfW, top, halfW * 2, bot - top, u * 0.14);
    ctx.fillStyle = bagG;
    ctx.fill();

    /* detalles dentro de la bolsa */
    ctx.save();
    rrect(-halfW, top, halfW * 2, bot - top, u * 0.14);
    ctx.clip();

    /* luz del borde izquierdo */
    const rim = ctx.createLinearGradient(-halfW, 0, -halfW + u * 0.26, 0);
    rim.addColorStop(0, "rgba(168,226,255,0.32)");
    rim.addColorStop(1, "rgba(168,226,255,0)");
    ctx.fillStyle = rim;
    ctx.fillRect(-halfW, top, u * 0.3, bot - top);

    /* pliegue */
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.42, -u * 0.5);
    ctx.quadraticCurveTo(-halfW * 0.6, u * 0.1, -halfW * 0.4, bot);
    ctx.strokeStyle = "rgba(6,16,25,0.18)";
    ctx.lineWidth = Math.max(1, u * 0.02);
    ctx.stroke();

    /* sombra inferior */
    const sh = ctx.createLinearGradient(0, bot - u * 0.45, 0, bot);
    sh.addColorStop(0, "rgba(6,16,25,0)");
    sh.addColorStop(1, "rgba(6,16,25,0.55)");
    ctx.fillStyle = sh;
    ctx.fillRect(-halfW, bot - u * 0.45, halfW * 2, u * 0.45);
    ctx.restore();

    /* boca */
    ctx.beginPath();
    ctx.moveTo(-halfW + u * 0.12, top + u * 0.02);
    ctx.lineTo(halfW - u * 0.12, top + u * 0.02);
    ctx.strokeStyle = "rgba(234,243,250,0.20)";
    ctx.lineWidth = Math.max(1, u * 0.014);
    ctx.stroke();

    /* etiqueta cosida */
    rrect(-u * 0.23, u * 0.04, u * 0.46, u * 0.36, u * 0.05);
    ctx.fillStyle = "rgba(234,243,250,0.92)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(-u * 0.09, u * 0.2, u * 0.06, 0, TAU);
    ctx.strokeStyle = "#1a5a7a";
    ctx.lineWidth = Math.max(1.2, u * 0.016);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-u * 0.09, u * 0.225, u * 0.022, 0, TAU);
    ctx.fillStyle = "#4db8ff";
    ctx.fill();

    ctx.fillStyle = "#1a5a7a";
    ctx.font = `700 ${Math.max(5, u * 0.05)}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LAVADO", u * 0.09, u * 0.2);

    /* cordón */
    ctx.beginPath();
    ctx.moveTo(-halfW + u * 0.16, top + u * 0.14);
    ctx.quadraticCurveTo(-halfW + u * 0.05, u * 0.14, -halfW + u * 0.12, u * 0.42);
    ctx.moveTo(halfW - u * 0.16, top + u * 0.14);
    ctx.quadraticCurveTo(halfW - u * 0.05, u * 0.14, halfW - u * 0.12, u * 0.42);
    ctx.strokeStyle = "rgba(234,243,250,0.24)";
    ctx.lineWidth = Math.max(1, u * 0.014);
    ctx.stroke();

    ctx.restore();
  }

  /* =========================================================
     5. Acto 02 · lavadora
     ========================================================= */

  function drawMachine(alpha) {
    const u = S;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx + mx * 10, cy + my * 8 + (0.5 - cur) * u * 0.55);

    /* halo azul detrás */
    const halo = ctx.createRadialGradient(0, u * 0.3, 0, 0, u * 0.3, u * 2.6);
    halo.addColorStop(0, `rgba(${ACCENT_RGB},0.20)`);
    halo.addColorStop(0.5, `rgba(${ACCENT_RGB},0.06)`);
    halo.addColorStop(1, `rgba(${ACCENT_RGB},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, u * 0.3, u * 2.6, 0, TAU);
    ctx.fill();

    shadow(0, u * 1.5, u * 1.0, u * 0.18, 0.55);

    const halfW = u * 1.16;
    const top = -u * 1.08;
    const bot = u * 1.34;
    const rad = u * 0.24;

    /* cuerpo */
    const body = ctx.createLinearGradient(-halfW, 0, halfW, 0);
    body.addColorStop(0, "#20495f");
    body.addColorStop(0.5, "#173447");
    body.addColorStop(1, "#0b1e2b");

    rrect(-halfW, top, halfW * 2, bot - top, rad);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = "rgba(168,226,255,0.16)";
    ctx.lineWidth = Math.max(1, u * 0.012);
    ctx.stroke();

    /* panel superior */
    ctx.save();
    rrect(-halfW, top, halfW * 2, bot - top, rad);
    ctx.clip();

    const panel = ctx.createLinearGradient(0, top, 0, top + u * 0.46);
    panel.addColorStop(0, "rgba(234,243,250,0.12)");
    panel.addColorStop(1, "rgba(234,243,250,0.02)");
    ctx.fillStyle = panel;
    ctx.fillRect(-halfW, top, halfW * 2, u * 0.46);

    ctx.beginPath();
    ctx.moveTo(-halfW, top + u * 0.46);
    ctx.lineTo(halfW, top + u * 0.46);
    ctx.strokeStyle = "rgba(6,16,25,0.55)";
    ctx.lineWidth = Math.max(1, u * 0.014);
    ctx.stroke();

    /* sombra lateral derecha */
    const side = ctx.createLinearGradient(halfW - u * 0.5, 0, halfW, 0);
    side.addColorStop(0, "rgba(0,0,0,0)");
    side.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = side;
    ctx.fillRect(halfW - u * 0.5, top, u * 0.5, bot - top);
    ctx.restore();

    /* botones, pantalla y mando */
    const py = top + u * 0.23;

    [-0.86, -0.68, -0.5].forEach((bx, i) => {
      ctx.beginPath();
      ctx.arc(bx * u, py, u * 0.042, 0, TAU);
      ctx.fillStyle = i === 0 ? ACCENT : "rgba(234,243,250,0.26)";
      ctx.fill();
    });

    rrect(-u * 0.34, py - u * 0.065, u * 0.5, u * 0.13, u * 0.03);
    ctx.fillStyle = "rgba(6,16,25,0.5)";
    ctx.fill();

    ctx.fillStyle = `rgba(${ACCENT_RGB},0.9)`;
    ctx.font = `600 ${Math.max(5, u * 0.062)}px ${SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("38°", -u * 0.28, py + u * 0.004);

    const dx = u * 0.74;
    ctx.beginPath();
    ctx.arc(dx, py, u * 0.145, 0, TAU);
    ctx.fillStyle = "rgba(6,16,25,0.45)";
    ctx.fill();
    ctx.strokeStyle = "rgba(234,243,250,0.24)";
    ctx.lineWidth = Math.max(1, u * 0.012);
    ctx.stroke();

    const da = -Math.PI / 2 + Math.sin(t * 0.45) * 1.1;
    ctx.beginPath();
    ctx.moveTo(dx, py);
    ctx.lineTo(dx + Math.cos(da) * u * 0.105, py + Math.sin(da) * u * 0.105);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(1.4, u * 0.02);
    ctx.lineCap = "round";
    ctx.stroke();

    /* puerta */
    const rOut = u * 0.92;
    const rIn = u * 0.78;
    const dcy = u * 0.34;

    const bez = ctx.createLinearGradient(-rOut, dcy - rOut, rOut, dcy + rOut);
    bez.addColorStop(0, "#d6eefb");
    bez.addColorStop(0.26, "#6aa3bd");
    bez.addColorStop(0.55, "#254c61");
    bez.addColorStop(0.8, "#82b9d2");
    bez.addColorStop(1, "#e2f5ff");

    ctx.beginPath();
    ctx.arc(0, dcy, rOut, 0, TAU);
    ctx.fillStyle = bez;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, dcy, rIn + u * 0.035, 0, TAU);
    ctx.fillStyle = "#0a1a24";
    ctx.fill();

    /* interior del tambor */
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, dcy, rIn, 0, TAU);
    ctx.clip();

    const inner = ctx.createRadialGradient(-rIn * 0.35, dcy - rIn * 0.4, rIn * 0.05, 0, dcy, rIn);
    inner.addColorStop(0, "#1a3d50");
    inner.addColorStop(0.55, "#0e2534");
    inner.addColorStop(1, "#061520");
    ctx.fillStyle = inner;
    ctx.fillRect(-rIn, dcy - rIn, rIn * 2, rIn * 2);

    /* perforaciones del tambor */
    ctx.fillStyle = "rgba(234,243,250,0.085)";
    for (let ring = 0; ring < 3; ring++) {
      const rr = rIn * (0.9 - ring * 0.055);
      const n = 24 + ring * 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + ring * 0.13;
        ctx.beginPath();
        ctx.arc(
          Math.cos(a) * rr,
          dcy + Math.sin(a) * rr,
          u * 0.01,
          0,
          TAU
        );
        ctx.fill();
      }
    }

    /* agua */
    const surf = dcy + rIn * 0.38;
    const wave = (x) =>
      surf + Math.sin(x / (rIn * 0.3) + t * 1.1) * rIn * 0.032;

    ctx.beginPath();
    ctx.moveTo(-rIn, wave(-rIn));
    for (let x = -rIn; x <= rIn; x += rIn / 10) ctx.lineTo(x, wave(x));
    ctx.lineTo(rIn, dcy + rIn);
    ctx.lineTo(-rIn, dcy + rIn);
    ctx.closePath();
    const water = ctx.createLinearGradient(0, surf, 0, dcy + rIn);
    water.addColorStop(0, `rgba(${ACCENT_RGB},0.52)`);
    water.addColorStop(1, `rgba(${ACCENT_RGB},0.12)`);
    ctx.fillStyle = water;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-rIn, wave(-rIn));
    for (let x = -rIn; x <= rIn; x += rIn / 10) ctx.lineTo(x, wave(x));
    ctx.strokeStyle = "rgba(210,244,255,0.55)";
    ctx.lineWidth = Math.max(1, u * 0.01);
    ctx.stroke();

    /* ropa girando */
    const cols = [
      ["#e8f4fc", "#a9cde0"],
      ["#7fc4e6", "#2f7ba1"],
      ["#2b6480", "#123245"],
      ["#bfe4fa", "#5fa3c4"],
    ];
    const sizes = [
      [0.62, 0.4],
      [0.46, 0.32],
      [0.54, 0.36],
      [0.4, 0.28],
    ];
    for (let i = 0; i < 4; i++) {
      const a = t * 1.15 + i * (TAU / 4);
      const gx = Math.cos(a) * rIn * 0.46;
      const gy = dcy + Math.sin(a) * rIn * 0.32 + rIn * 0.02;
      fabric(
        gx, gy,
        rIn * sizes[i][0], rIn * sizes[i][1],
        a * 1.35,
        cols[i][0], cols[i][1]
      );
    }

    /* velo de agua sobre la ropa */
    ctx.beginPath();
    ctx.moveTo(-rIn, wave(-rIn));
    for (let x = -rIn; x <= rIn; x += rIn / 10) ctx.lineTo(x, wave(x));
    ctx.lineTo(rIn, dcy + rIn);
    ctx.lineTo(-rIn, dcy + rIn);
    ctx.closePath();
    ctx.fillStyle = `rgba(${ACCENT_RGB},0.12)`;
    ctx.fill();

    /* espuma */
    for (let i = 0; i < 8; i++) {
      const sx = Math.sin(i * 2.3 + t * 0.5) * rIn * 0.62;
      const sy = surf + Math.sin(i * 1.7 + t * 0.9) * rIn * 0.05;
      const sr = rIn * (0.028 + (i % 3) * 0.016);
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, TAU);
      ctx.fillStyle = "rgba(230,248,255,0.22)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.26)";
      ctx.lineWidth = Math.max(0.6, u * 0.006);
      ctx.stroke();
    }

    /* sombra interior */
    const shade = ctx.createRadialGradient(0, dcy, rIn * 0.45, 0, dcy, rIn);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = shade;
    ctx.fillRect(-rIn, dcy - rIn, rIn * 2, rIn * 2);

    /* cristal */
    const glare = ctx.createRadialGradient(
      -rIn * 0.42, dcy - rIn * 0.5, 0,
      -rIn * 0.42, dcy - rIn * 0.5, rIn * 0.7
    );
    glare.addColorStop(0, "rgba(255,255,255,0.22)");
    glare.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glare;
    ctx.fillRect(-rIn, dcy - rIn, rIn * 2, rIn * 2);

    ctx.beginPath();
    ctx.arc(0, dcy, rIn * 0.86, -2.55, -1.2);
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = rIn * 0.06;
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, dcy, rIn * 0.84, 0.95, 1.5);
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = rIn * 0.03;
    ctx.stroke();

    ctx.restore();

    /* filo del cristal */
    const rimG = ctx.createLinearGradient(-rIn, dcy - rIn, rIn, dcy + rIn);
    rimG.addColorStop(0, "rgba(255,255,255,0.35)");
    rimG.addColorStop(0.5, "rgba(255,255,255,0.08)");
    rimG.addColorStop(1, "rgba(255,255,255,0.22)");
    ctx.beginPath();
    ctx.arc(0, dcy, rIn, 0, TAU);
    ctx.strokeStyle = rimG;
    ctx.lineWidth = Math.max(1, u * 0.012);
    ctx.stroke();

    /* bisagra */
    rrect(halfW - u * 0.15, dcy - u * 0.15, u * 0.13, u * 0.3, u * 0.05);
    ctx.fillStyle = "#0a1a24";
    ctx.fill();
    ctx.strokeStyle = "rgba(168,226,255,0.18)";
    ctx.lineWidth = Math.max(1, u * 0.01);
    ctx.stroke();

    /* patas */
    [-0.8, 0.8].forEach((fx) => {
      rrect(fx * u - u * 0.09, bot - u * 0.02, u * 0.18, u * 0.11, u * 0.04);
      ctx.fillStyle = "rgba(6,16,25,0.9)";
      ctx.fill();
    });

    ctx.restore();
  }

  /* =========================================================
     6. Acto 03 · pila doblada
     ========================================================= */

  function drawStack(alpha) {
    const u = S;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx + mx * 10, cy + my * 8 + (cur - 0.95) * u * 0.5);

    shadow(0, u * 1.14, u * 1.0, u * 0.16, 0.55);

    const layers = [
      { w: 1.78, h: 0.44, dx: 0.02, c1: "#2f6f8d", c2: "#123649", r: -0.03 },
      { w: 1.94, h: 0.42, dx: -0.03, c1: "#9ed3ee", c2: "#4c90b4", r: 0.025 },
      { w: 1.82, h: 0.44, dx: 0.03, c1: "#eaf6fd", c2: "#b3d3e4", r: -0.018 },
      { w: 1.9, h: 0.4, dx: -0.02, c1: "#f2fafe", c2: "#c9dfec", r: 0.04 },
    ];

    let base = u * 1.02;
    let topEdge = null;

    layers.forEach((L, idx) => {
      const w = L.w * u;
      const h = L.h * u;
      const yc = base - h / 2;
      base -= h * 0.9;

      if (idx === layers.length - 1) topEdge = yc - h / 2;

      ctx.save();
      ctx.translate(L.dx * u, yc);
      ctx.rotate(L.r);

      const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, L.c1);
      g.addColorStop(1, L.c2);
      rrect(-w / 2, -h / 2, w, h, u * 0.075);
      ctx.fillStyle = g;
      ctx.fill();

      /* filo superior */
      ctx.beginPath();
      ctx.moveTo(-w / 2 + u * 0.08, -h / 2 + 1);
      ctx.lineTo(w / 2 - u * 0.08, -h / 2 + 1);
      ctx.strokeStyle = "rgba(255,255,255,0.38)";
      ctx.lineWidth = Math.max(0.8, u * 0.008);
      ctx.stroke();

      /* pliegues */
      [0.16, -0.28].forEach((px) => {
        ctx.beginPath();
        ctx.moveTo(w * px, -h / 2 + u * 0.035);
        ctx.lineTo(w * px, h / 2 - u * 0.035);
        ctx.strokeStyle = "rgba(6,16,25,0.13)";
        ctx.lineWidth = Math.max(0.8, u * 0.008);
        ctx.stroke();
      });

      /* sombra inferior */
      const sh = ctx.createLinearGradient(0, h * 0.02, 0, h / 2);
      sh.addColorStop(0, "rgba(6,16,25,0)");
      sh.addColorStop(1, "rgba(6,16,25,0.3)");
      ctx.fillStyle = sh;
      rrect(-w / 2, -h / 2, w, h, u * 0.075);
      ctx.fill();

      ctx.restore();
    });

    /* cuello y mangas de la camisa doblada */
    if (topEdge !== null) {
      ctx.save();
      ctx.translate(-u * 0.02, topEdge);
      ctx.rotate(0.04);

      /* mangas dobladas a los lados */
      [-1, 1].forEach((s) => {
        ctx.save();
        ctx.translate(s * u * 0.6, u * 0.085);
        ctx.rotate(s * 0.08);
        rrect(-u * 0.19, -u * 0.07, u * 0.38, u * 0.14, u * 0.04);
        ctx.fillStyle = "#e2f1fb";
        ctx.fill();
        ctx.strokeStyle = "rgba(6,16,25,0.14)";
        ctx.lineWidth = Math.max(0.8, u * 0.006);
        ctx.stroke();
        ctx.restore();
      });

      /* cuello */
      rrect(-u * 0.28, -u * 0.005, u * 0.56, u * 0.12, u * 0.045);
      ctx.fillStyle = "rgba(255,255,255,0.98)";
      ctx.fill();
      ctx.strokeStyle = "rgba(6,16,25,0.16)";
      ctx.lineWidth = Math.max(0.8, u * 0.006);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-u * 0.08, u * 0.02);
      ctx.lineTo(0, u * 0.12);
      ctx.lineTo(u * 0.08, u * 0.02);
      ctx.closePath();
      ctx.fillStyle = "#dcecf7";
      ctx.fill();

      /* botonadura */
      ctx.beginPath();
      ctx.moveTo(0, u * 0.13);
      ctx.lineTo(0, u * 0.27);
      ctx.strokeStyle = "rgba(6,16,25,0.18)";
      ctx.lineWidth = Math.max(0.8, u * 0.007);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, u * 0.21, u * 0.015, 0, TAU);
      ctx.fillStyle = "rgba(6,16,25,0.34)";
      ctx.fill();
      ctx.restore();
    }

    /* etiqueta LISTO */
    ctx.beginPath();
    ctx.moveTo(u * 0.46, -u * 0.52);
    ctx.quadraticCurveTo(u * 0.64, -u * 0.44, u * 0.66, -u * 0.26);
    ctx.strokeStyle = "rgba(234,243,250,0.42)";
    ctx.lineWidth = Math.max(1, u * 0.016);
    ctx.stroke();

    ctx.save();
    ctx.translate(u * 0.7, -u * 0.14);
    ctx.rotate(0.16);
    rrect(-u * 0.2, -u * 0.13, u * 0.4, u * 0.26, u * 0.045);
    ctx.fillStyle = CREAM;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(-u * 0.14, 0, u * 0.022, 0, TAU);
    ctx.fillStyle = "#0a2434";
    ctx.fill();

    ctx.fillStyle = "#0a2434";
    ctx.font = `700 ${Math.max(6, u * 0.088)}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LISTO", u * 0.03, u * 0.006);
    ctx.restore();

    /* destellos */
    for (let i = 0; i < 3; i++) {
      const sx = [-1.14, 1.06, -0.82][i] * u;
      const sy = [-0.08, -0.62, -1.0][i] * u;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.25 + i * 1.7));
      sparkle(sx, sy, u * 0.075 * tw, 0.5 * tw);
    }

    ctx.restore();
  }

  /* =========================================================
     7. Burbujas y gotas
     ========================================================= */

  function drawBubbles() {
    for (const b of bubbles) {
      const k = b.pop >= 0 ? Math.min(1, b.pop / 0.24) : 0;

      /* se apagan al pasar por detrás de la escena */
      const dist = Math.hypot(b.x - cx, b.y - cy);
      const behind = clamp((dist - S * 1.5) / (S * 0.7));
      const alpha = b.alpha * (1 - k) * behind * 0.9;
      if (alpha <= 0.01) continue;

      const r = b.r * (1 + k * 0.34);
      const wob = Math.sin(t * 1.7 + b.ph) * 0.03;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(b.x, b.y);
      ctx.scale(1 + wob, 1 - wob);
      ctx.drawImage(b.sprite, -r, -r, r * 2, r * 2);
      ctx.restore();
    }
  }

  function drawDrops() {
    if (!drops.length) return;
    ctx.save();
    for (const d of drops) {
      ctx.globalAlpha = Math.max(0, d.life) * 0.85;
      ctx.fillStyle = "#dff4ff";
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* =========================================================
     8. Render
     ========================================================= */

  function drawGlow() {
    const w2 = smooth(0.30, 0.52, cur) * (1 - smooth(0.66, 0.88, cur));
    const g = ctx.createRadialGradient(cx, cy, S * 0.2, cx, cy, S * 3.6);
    g.addColorStop(0, `rgba(${ACCENT_RGB},${0.09 + 0.11 * w2})`);
    g.addColorStop(0.45, `rgba(${ACCENT_RGB},0.035)`);
    g.addColorStop(1, `rgba(${ACCENT_RGB},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function render() {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);

    drawGlow();

    /* 1. Camioneta más grande y centrada al inicio */
    const uVan = S * (W < 900 ? 1.38 : 1.58);
    const kVan = smooth(0.0, 0.22, cur);
    const vanStartX = W * 0.5;
    const exitDist = (W * 0.5) + uVan * 1.5;
    const vanX = vanStartX + kVan * exitDist + mx * 10;
    const vanAlpha = 1 - smooth(0.19, 0.25, cur);

    /* 2. Ciclo de las prendas (bolsa -> lavadora -> pila doblada) */
    const k2 = smooth(0.30, 0.52, cur);
    const k3 = smooth(0.66, 0.88, cur);
    const w1 = 1 - k2;
    const w2 = k2 * (1 - k3);
    const w3 = k3;

    if (w1 > 0.01) drawBag(w1);
    if (w2 > 0.01) drawMachine(w2);
    if (w3 > 0.01) drawStack(w3);

    /* Capa sobrepuesta: la ciudad nocturna y la camioneta en marcha */
    if (vanAlpha > 0.01) {
      const vanY = cy + my * 8;
      const roadY = vanY + uVan * 0.61;
      drawCity(roadY, kVan, vanAlpha);
      drawVan(vanX, vanY, kVan, vanAlpha, uVan);
    }

    drawBubbles();
    drawDrops();

    if (vignette) {
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
    }

    if (!reduce) {
      grainClock += dtFrame;
      if (grainClock > 0.07) {
        grainClock = 0;
        grainIdx = (grainIdx + 1) % grainPat.length;
      }
      drawGrain();
    }
  }

  function paintUI() {
    if (bar) bar.style.transform = `scaleX(${cur})`;
    sticky.style.setProperty("--p", cur.toFixed(4));
    if (hint) hint.classList.toggle("is-hidden", cur > 0.03);

    /* Los textos principales aparecen tras el primer scroll */
    const isScrolled = cur > 0.05;
    document.body.classList.toggle("is-scrolled", isScrolled);

    const idx = cur < 0.42 ? 0 : cur < 0.72 ? 1 : 2;
    if (idx !== stageIdx) {
      stageIdx = idx;
      stageEls.forEach((el, i) => el.classList.toggle("is-on", i === idx));
    }
  }

  /* =========================================================
     9. Bucle
     ========================================================= */

  function measure() {
    const total = Math.max(1, hero.offsetHeight - window.innerHeight);
    target = clamp(-hero.getBoundingClientRect().top / total);
  }

  function wake() {
    if (raf || reduce || !inView) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    dtFrame = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;

    if (!paused) t += dtFrame;

    boost *= Math.exp(-dtFrame * 3.2);
    const ease = 1 - Math.exp(-dtFrame * 9);
    cur += (target - cur) * ease;
    mx += (tmx - mx) * (1 - Math.exp(-dtFrame * 6));
    my += (tmy - my) * (1 - Math.exp(-dtFrame * 6));

    if (!paused) {
      updateBubbles(dtFrame);
      updateDrops(dtFrame);
    }

    render();
    paintUI();

    const settling =
      Math.abs(target - cur) > 0.0005 ||
      Math.abs(tmx - mx) > 0.002 ||
      Math.abs(tmy - my) > 0.002;

    if (!paused || settling) raf = requestAnimationFrame(frame);
  }

  /* =========================================================
     10. Eventos
     ========================================================= */

  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    boost = Math.min(120, boost + Math.abs(y - lastY) * 0.3);
    lastY = y;

    measure();

    if (reduce) {
      cur = target;
      render();
      paintUI();
    } else {
      wake();
    }
  }, { passive: true });

  window.addEventListener("resize", () => {
    resize();
    measure();
    if (reduce) { cur = target; render(); paintUI(); }
    wake();
  });

  window.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    tmx = (e.clientX / window.innerWidth - 0.5) * 2;
    tmy = (e.clientY / window.innerHeight - 0.5) * 2;

    const inside = x > 0 && y > 0 && x < rect.width && y < rect.height;
    pointer = inside ? { x, y } : null;

    if (inside && !reduce) {
      const over = bubbles.some(
        (b) => b.pop < 0 && Math.hypot(b.x - x, b.y - y) < b.r + 4
      );
      canvas.style.cursor = over ? "pointer" : "";
    } else {
      canvas.style.cursor = "";
    }
  }, { passive: true });

  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button")) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    if (popAt(x, y)) wake();
  }, { passive: true });

  window.addEventListener("pointerup", () => { canvas.style.cursor = ""; }, { passive: true });

  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      paused = !paused;
      pauseBtn.setAttribute("aria-pressed", String(paused));
      document.body.classList.toggle("is-paused", paused);
      if (!paused) wake();
    });
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) wake();
    }, { threshold: 0 }).observe(hero);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });

  /* =========================================================
     11. Arranque
     ========================================================= */

  resize();
  measure();

  cur = reduce ? target : 0;

  if (reduce) {
    render();
    paintUI();
    document.body.classList.add("is-ready");
  } else {
    render();
    paintUI();
    wake();

    const ready = () => {
      measure();
      document.body.classList.add("is-ready");
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => requestAnimationFrame(ready));
      window.setTimeout(ready, 1200);
    } else {
      ready();
    }
  }
})();
