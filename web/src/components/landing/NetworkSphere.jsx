import { useEffect, useRef } from 'react';

/* Interactive "talent network" sphere for the landing hero.
   - three.js is loaded via dynamic import so it is code-split into its own
     chunk and never bloats the main app bundle (the app itself doesn't use 3D).
   - Recoloured to the product palette (indigo -> sky) with normal blending
     so it reads correctly on the light surface.
   - Fully cleaned up on unmount (geometries/materials/renderer disposed).
   - Respects prefers-reduced-motion (renders a single static frame) and pauses
     the RAF loop while scrolled off-screen to save battery.
   If WebGL or three fail to load, the canvas simply stays transparent and the
   CSS halo + floating cards still look great (graceful fallback). */
export default function NetworkSphere() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let renderer, scene, camera, group, sparkGeo;
    let raf = 0;
    let running = true;
    let disposed = false;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fine = window.matchMedia && window.matchMedia('(pointer:fine)').matches;
    let tx = 0, ty = 0, mx = 0, my = 0;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const onMouse = (e) => { tx = e.clientX / window.innerWidth - 0.5; ty = e.clientY / window.innerHeight - 0.5; };
    let cleanupExtra = () => {};

    (async () => {
      let THREE;
      try { THREE = await import('three'); } catch { return; }
      if (disposed || !canvasRef.current) return;

      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
      catch { canvas.style.display = 'none'; return; }
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.z = 5.2;
      group = new THREE.Group();
      scene.add(group);

      const N = 92, R = 2.05, pts = [];
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2;
        const rad = Math.sqrt(1 - y * y);
        const th = i * Math.PI * (3 - Math.sqrt(5));
        pts.push(new THREE.Vector3(Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R));
      }
      const cA = new THREE.Color(0x818cf8), cB = new THREE.Color(0x4f46e5), cC = new THREE.Color(0x0284c7);
      const grad = (t) => (t < 0.5 ? cA.clone().lerp(cB, t * 2) : cB.clone().lerp(cC, (t - 0.5) * 2));

      const nPos = new Float32Array(N * 3), nCol = new Float32Array(N * 3);
      for (let j = 0; j < N; j++) {
        nPos[j * 3] = pts[j].x; nPos[j * 3 + 1] = pts[j].y; nPos[j * 3 + 2] = pts[j].z;
        const c = grad((pts[j].y / R + 1) / 2);
        nCol[j * 3] = c.r; nCol[j * 3 + 1] = c.g; nCol[j * 3 + 2] = c.b;
      }
      const nGeo = new THREE.BufferGeometry();
      nGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
      nGeo.setAttribute('color', new THREE.BufferAttribute(nCol, 3));
      const nMat = new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.NormalBlending, depthWrite: false, sizeAttenuation: true });
      group.add(new THREE.Points(nGeo, nMat));

      const lp = [], lc = [], maxD = 1.05;
      for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
        if (pts[a].distanceTo(pts[b]) < maxD) {
          lp.push(pts[a].x, pts[a].y, pts[a].z, pts[b].x, pts[b].y, pts[b].z);
          const ca = grad((pts[a].y / R + 1) / 2), cb = grad((pts[b].y / R + 1) / 2);
          lc.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b);
        }
      }
      const lGeo = new THREE.BufferGeometry();
      lGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
      lGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(lc), 3));
      const lMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, blending: THREE.NormalBlending, depthWrite: false });
      group.add(new THREE.LineSegments(lGeo, lMat));

      const SP = 4;
      sparkGeo = new THREE.BufferGeometry();
      sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SP * 3), 3));
      const spMat = new THREE.PointsMaterial({ size: 0.24, color: 0x059669, transparent: true, opacity: 0.9, blending: THREE.NormalBlending, depthWrite: false });
      group.add(new THREE.Points(sparkGeo, spMat));

      const resize = () => {
        const r = canvas.getBoundingClientRect();
        const w = r.width || 420, h = r.height || 420;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
      };
      resize();
      window.addEventListener('resize', resize);
      if (fine) window.addEventListener('mousemove', onMouse);

      group.rotation.x = 0.35;

      const frame = (now) => {
        if (!running || disposed) return;
        const el = (now - t0) / 1000;
        group.rotation.y += 0.0016;
        mx += (tx - mx) * 0.04; my += (ty - my) * 0.04;
        group.rotation.x = 0.35 + my * 0.5;
        group.rotation.z = mx * 0.18;
        const sp = sparkGeo.attributes.position.array;
        for (let k = 0; k < SP; k++) {
          const ang = el * 0.6 + k * (Math.PI * 2 / SP), rr = 2.45;
          sp[k * 3] = Math.cos(ang) * rr;
          sp[k * 3 + 1] = Math.sin(ang * 1.3) * 1.4;
          sp[k * 3 + 2] = Math.sin(ang) * rr;
        }
        sparkGeo.attributes.position.needsUpdate = true;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      };

      let vio;
      if (reduce) {
        renderer.render(scene, camera);
      } else {
        raf = requestAnimationFrame(frame);
        vio = new IntersectionObserver((entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting && !running) { running = true; raf = requestAnimationFrame(frame); }
            else if (!e.isIntersecting) { running = false; }
          });
        }, { threshold: 0 });
        vio.observe(canvas);
      }

      cleanupExtra = () => {
        window.removeEventListener('resize', resize);
        if (fine) window.removeEventListener('mousemove', onMouse);
        if (vio) vio.disconnect();
        scene && scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) { (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose()); }
        });
        renderer && renderer.dispose();
      };
    })();

    return () => {
      disposed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      cleanupExtra();
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 z-[2] h-full w-full" aria-hidden />;
}
