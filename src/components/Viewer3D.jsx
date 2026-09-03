import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Live 3D preview of the loaded mesh with the cutting/projection plane drawn in
// place, so the offset slider can be judged before converting.
export default function Viewer3D({ mesh, basis, offset, mode, resetKey }) {
  const hostRef = useRef(null);
  const ctxRef = useRef(null);
  const [failure, setFailure] = useState(null);

  // One-time scene setup.
  useEffect(() => {
    const host = hostRef.current;

    // WebGL can be missing entirely, blocked by policy, or lost at runtime.
    // None of that should stop the actual conversion, so the viewer degrades
    // to a message instead of taking the page with it.
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
      setFailure('3D preview unavailable — this browser or device has no usable WebGL. Conversion still works.');
      return undefined;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const onLost = (e) => {
      e.preventDefault();
      setFailure('3D preview lost its graphics context. Reload the page to restore it — conversion is unaffected.');
    };
    renderer.domElement.addEventListener('webglcontextlost', onLost);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e14);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2030, 2.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.4, 1.2);
    scene.add(key);

    const grid = new THREE.GridHelper(100, 20, 0x39424f, 0x232b36);
    grid.rotation.x = Math.PI / 2; // model space is Z-up, like STL
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);

    const planeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
    );
    const planeEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 })
    );
    planeMesh.add(planeEdge);
    scene.add(planeMesh);

    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1, 0x22c55e);
    scene.add(arrow);

    const ctx = { renderer, scene, camera, controls, group, planeMesh, planeEdge, arrow, grid, current: null, radius: 50 };
    ctxRef.current = ctx;

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      ro.disconnect();
      controls.dispose();
      ctx.current?.geometry.dispose();
      ctx.current?.material.dispose();
      planeMesh.geometry.dispose();
      planeMesh.material.dispose();
      planeEdge.geometry.dispose();
      planeEdge.material.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  // Swap in the current mesh and frame it.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.current) {
      ctx.group.remove(ctx.current);
      ctx.current.geometry.dispose();
      ctx.current.material.dispose();
      ctx.current = null;
    }
    if (!mesh) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions.slice(), 3));
    geo.computeBoundingSphere();

    // Flat shading derives normals in the fragment shader, so no normal
    // attribute is needed. That halves GPU memory for the mesh and is also the
    // honest way to draw an STL, which is faceted by definition.
    const obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x9fb4d0, metalness: 0.05, roughness: 0.65, flatShading: true,
    }));
    ctx.group.add(obj);
    ctx.current = obj;

    const sphere = geo.boundingSphere;
    ctx.radius = Math.max(sphere.radius, 1e-3);
    ctx.center = sphere.center.clone();
    ctx.grid.scale.setScalar(Math.max(ctx.radius / 25, 0.02));
    frame(ctx);
  }, [mesh]);

  useEffect(() => {
    if (ctxRef.current) frame(ctxRef.current);
  }, [resetKey]);

  // Keep the plane widget in sync with the settings.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const color = mode === 'intersection' ? 0xef4444 : 0x22c55e;
    ctx.planeMesh.material.color.setHex(color);
    ctx.planeEdge.material.color.setHex(color);
    ctx.arrow.setColor(new THREE.Color(color));
    ctx.arrow.visible = mode === 'projection';

    const n = new THREE.Vector3(...basis.n).normalize();
    const size = ctx.radius * 2.4;
    ctx.planeMesh.scale.set(size, size, 1);
    // PlaneGeometry faces +Z, so rotate that onto the plane normal.
    ctx.planeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    ctx.planeMesh.position.copy(n).multiplyScalar(offset);

    // For projection the plane is a viewing surface: show which way we look.
    const start = n.clone().multiplyScalar(ctx.radius * 1.6);
    if (ctx.center) start.add(ctx.center.clone().projectOnPlane(n));
    ctx.arrow.position.copy(start);
    ctx.arrow.setDirection(n.clone().negate());
    ctx.arrow.setLength(ctx.radius * 1.1, ctx.radius * 0.22, ctx.radius * 0.12);
  }, [basis, offset, mode]);

  return (
    <div className="viewer-canvas" ref={hostRef}>
      {failure && <div className="viewer-empty">{failure}</div>}
      {!failure && !mesh && <div className="viewer-empty">Upload an STL file to see the 3D preview</div>}
    </div>
  );
}

function frame(ctx) {
  const r = ctx.radius || 50;
  const c = ctx.center || new THREE.Vector3();
  ctx.controls.target.copy(c);
  ctx.camera.position.set(c.x + r * 1.9, c.y - r * 2.2, c.z + r * 1.6);
  ctx.camera.up.set(0, 0, 1);
  ctx.camera.near = r / 100;
  ctx.camera.far = r * 100;
  ctx.camera.updateProjectionMatrix();
  ctx.controls.update();
}
