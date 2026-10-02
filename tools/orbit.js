/**
 * Turn a model round by hand, for looking at one properly.
 *
 * A preview that can only be seen from the three-quarter it was set up on is
 * good for a first look and useless for the second: a shape can look right from
 * the front and be wrong from the side, a seam can hide behind the piece, and
 * a thing that is standing at the wrong angle to the ground only shows once you
 * can get down to it. So both the single-model page and the comparison page
 * take a drag to turn it, a wheel to come closer, and a shift-drag to slide the
 * view sideways without turning it.
 *
 * The control holds a *delta*, not a camera: the page says where its own view
 * is looking from and the delta is applied on top, so a page with four views
 * turns all four the same way and keeps each one's own framing.
 */
export function orbitControl(camera, dom) {
  const st = { da: 0, de: 0, zoom: 1, panX: 0, panY: 0 };
  let drag = null;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  dom.style.cursor = 'grab';
  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    // capturing the pointer keeps a drag alive when it leaves the canvas, but
    // it can be refused, and a refusal must not stop the drag being tracked
    try { dom.setPointerCapture(e.pointerId); } catch (err) { /* no capture, still drags */ }
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 };
    dom.style.cursor = drag.pan ? 'move' : 'grabbing';
  });
  dom.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      // sliding moves the view across the model, at the scale of the drag
      const k = st.zoom * 0.0022;
      st.panX -= dx * k;
      st.panY += dy * k;
    } else {
      st.da -= dx * 0.008;
      st.de = clamp(st.de + dy * 0.006, -1.3, 1.35);
    }
    draw();
  });
  const end = (e) => {
    if (!drag) return;
    drag = null;
    dom.style.cursor = 'grab';
    if (e && e.pointerId !== undefined && dom.hasPointerCapture?.(e.pointerId)) {
      dom.releasePointerCapture(e.pointerId);
    }
  };
  dom.addEventListener('pointerup', end);
  dom.addEventListener('pointercancel', end);
  dom.addEventListener('dblclick', () => { st.da = st.de = 0; st.panX = st.panY = 0; st.zoom = 1; draw(); });
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    st.zoom = clamp(st.zoom * (e.deltaY > 0 ? 0.92 : 1.09), 0.15, 14);
    draw();
  }, { passive: false });
  // a hint, because a control nobody knows about is a control nobody uses
  const hint = document.createElement('div');
  hint.textContent = 'drag to turn · shift-drag to slide · wheel to zoom · double-click to reset';
  hint.style.cssText = 'position:absolute;left:10px;bottom:8px;font:11px ui-monospace,monospace;'
    + 'color:#e8eef2;background:rgba(20,24,28,.55);padding:3px 8px;border-radius:3px;pointer-events:none';
  dom.style.position = 'relative';
  dom.appendChild(hint);

  let draw = () => {};

  return {
    state: st,
    /**
     * Point the camera at one view. `base` is where the page's own view is:
     * `a` the bearing, `d` how far back, `y` how high, `ty` what it looks at,
     * and `tx`/`tz` where that is.
     */
    aim(base) {
      const e0 = Math.atan2(base.y - base.ty, base.d);
      const e = clamp(e0 + st.de, -0.35, 1.45);
      const d = base.d * st.zoom;
      camera.position.set(
        (base.tx || 0) + Math.cos(base.a + st.da) * Math.cos(e) * d,
        base.ty + st.panY + Math.sin(e) * d,
        (base.tz || 0) + Math.sin(base.a + st.da) * Math.cos(e) * d);
      camera.lookAt((base.tx || 0) + st.panX, base.ty + st.panY, (base.tz || 0));
    },
    /** Hand it a function to call whenever the view is moved. */
    onDraw(fn) { draw = fn; if (fn) fn(); },
  };
}
