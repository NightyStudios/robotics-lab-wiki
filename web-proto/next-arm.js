const reach = { left: .20, right: .298, y: .105 };
const horizontalRange = offset => offset < 0 ? reach.left : reach.right;
const maxPan = 40;
const panCurve = (maxPan / reach.right - maxPan / reach.left) / (reach.left + reach.right);
const panSlope = maxPan / reach.left + reach.left * panCurve;

function signPose(x, y) {
  const azimuth = x * (panSlope + panCurve * x);
  const reachY = y / reach.y;
  return {
    azimuth,
    roll: -4 + azimuth / 8 - reachY * 2,
    yaw: -16 + azimuth * .48,
    pitch: 9 - reachY * 13,
  };
}

function reachableOffset(x, y) {
  const fitX = Math.abs(x / horizontalRange(x));
  const fitY = Math.abs(y / reach.y);
  // A flatter forward boundary retains reach when the sign also moves up or down.
  const limit = Math.max(1, x > 0 ? Math.cbrt(fitX ** 3 + fitY ** 3) : Math.hypot(fitX, fitY));
  return { x: x / limit, y: y / limit };
}

function aimSign(centerX, centerY, halfHeight, perspective) {
  let grip = reachableOffset(centerX, centerY + halfHeight);
  // Project the sign’s center about its mount using the CSS rotation order.
  for (let pass = 0; pass < 3; pass++) {
    const { roll, yaw, pitch } = signPose(grip.x, grip.y);
    const rotation = new DOMMatrix().rotateSelf(0, yaw, 0).rotateSelf(pitch, 0, 0).rotateSelf(0, 0, roll);
    const projectedDistance = halfHeight / (1 + rotation.m23 * halfHeight / perspective);
    grip = reachableOffset(centerX + rotation.m21 * projectedDistance, centerY + rotation.m22 * projectedDistance);
  }
  return grip;
}

function advance(axis, elapsed) {
  // A critically damped spring preserves velocity when the pointer changes direction.
  const frequency = 18;
  const distance = axis.position - axis.target;
  const impulse = axis.velocity + frequency * distance;
  const attenuation = Math.exp(-frequency * elapsed);
  axis.position = axis.target + (distance + impulse * elapsed) * attenuation;
  axis.velocity = (axis.velocity - frequency * impulse * elapsed) * attenuation;
  if (Math.abs(axis.position - axis.target) > .0004 || Math.abs(axis.velocity) > .006) return true;
  axis.position = axis.target;
  axis.velocity = 0;
  return false;
}

export function trackNextArm(footer) {
  const rig = footer.querySelector('.next-arm-rig');
  const canvas = rig.querySelector('canvas');
  const sign = rig.querySelector('a');
  const media = matchMedia('(min-width: 48rem) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  const events = new AbortController();
  const { signal } = events;
  const x = { position: 0, target: 0, velocity: 0 };
  const y = { position: 0, target: 0, velocity: 0 };
  let scene;
  let loading = false;
  let nearby = false;
  let pointer;
  let needsTarget = false;
  let frame = 0;
  let lastTime = 0;
  let width = 0;
  let height = 0;

  function animate(time) {
    frame = 0;
    if (needsTarget && pointer) {
      needsTarget = false;
      const bounds = rig.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      if (!width || !height) return;
      const rest = scene.restMount(width, height);
      const centerX = (pointer.clientX - bounds.left - rest.x) / width;
      const centerY = (pointer.clientY - bounds.top - rest.y) / width;
      const halfHeight = sign.offsetHeight / (2 * width);
      const perspective = 32 * parseFloat(getComputedStyle(document.documentElement).fontSize) / width;
      const target = aimSign(centerX, centerY, halfHeight, perspective);
      x.target = target.x;
      y.target = target.y;
    }
    if (!width || !height) return;

    const elapsed = Math.min(.05, lastTime ? (time - lastTime) / 1000 : 1 / 60);
    const movingX = advance(x, elapsed);
    const movingY = advance(y, elapsed);
    const moving = movingX || movingY;
    lastTime = moving ? time : 0;

    const { azimuth, roll, yaw, pitch } = signPose(x.position, y.position);
    const mount = scene.draw(x.position * width, y.position * width, width, height, azimuth);
    rig.style.setProperty('--sign-x', `${mount.x}px`);
    rig.style.setProperty('--sign-y', `${mount.y}px`);
    rig.style.setProperty('--sign-roll', `${roll}deg`);
    rig.style.setProperty('--sign-yaw', `${yaw}deg`);
    rig.style.setProperty('--sign-pitch', `${pitch}deg`);
    rig.toggleAttribute('data-live', true);
    if (moving) schedule();
  }

  function schedule() {
    if (!frame && scene && media.matches) frame = requestAnimationFrame(animate);
  }

  function reset() {
    cancelAnimationFrame(frame);
    frame = lastTime = width = height = 0;
    pointer = undefined;
    needsTarget = false;
    x.position = x.target = x.velocity = 0;
    y.position = y.target = y.velocity = 0;
    rig.removeAttribute('data-live');
    for (const property of ['--sign-x', '--sign-y', '--sign-roll', '--sign-yaw', '--sign-pitch']) {
      rig.style.removeProperty(property);
    }
  }

  async function load() {
    if (loading || !media.matches) return;
    loading = true;
    try {
      const { createArmScene } = await import('./arm-scene.js');
      if (signal.aborted) return;
      const ready = await createArmScene(canvas);
      if (signal.aborted) {
        ready?.dispose();
        return;
      }
      scene = ready;
      retarget();
    } catch {
      reset();
    }
  }

  function follow(event) {
    if (!media.matches || event.pointerType === 'touch' || sign.matches(':focus-visible')) return;
    const { clientX, clientY } = event;
    pointer = { clientX, clientY };
    if (scene) retarget();
    else void load();
  }

  function retarget() {
    if (!pointer) return;
    needsTarget = true;
    schedule();
  }

  const observer = new IntersectionObserver(([entry]) => {
    nearby = entry.isIntersecting;
    if (nearby) void load();
  }, { rootMargin: '320px' });
  observer.observe(footer);
  footer.addEventListener('pointerenter', follow, { passive: true, signal });
  footer.addEventListener('pointermove', follow, { passive: true, signal });
  footer.addEventListener('pointerleave', () => {
    pointer = undefined;
    needsTarget = false;
    x.target = y.target = 0;
    if (width) schedule();
  }, { passive: true, signal });
  sign.addEventListener('focus', () => {
    if (sign.matches(':focus-visible')) reset();
  }, { signal });
  canvas.addEventListener('webglcontextlost', () => {
    reset();
    scene = undefined;
  }, { signal });
  media.addEventListener('change', () => {
    reset();
    if (nearby) void load();
  }, { signal });
  window.addEventListener('scroll', retarget, { passive: true, signal });
  window.addEventListener('resize', () => {
    if (pointer) retarget();
    else reset();
  }, { signal });

  return () => {
    events.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
    scene?.dispose();
  };
}
