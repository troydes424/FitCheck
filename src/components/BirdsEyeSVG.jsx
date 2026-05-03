import { useState, useRef, useEffect } from 'react';
import CesiumView from './CesiumView';
import Offset from 'polygon-offset';

const SVG_W = 720;
const SVG_H = 420;
const LABEL_PAD = 48;

const DEG = Math.PI / 180;
const MIN_PITCH = 10;   // approaching horizon
const MAX_PITCH = 90;   // true top-down
const DEFAULT_YAW   = 45;
const DEFAULT_PITCH = 35;

// Floor-to-floor height for a story + foundation (feet)
const STORY_HEIGHT_FT = 9.5;
const FOUNDATION_FT = 1;
// Gable pitch as a fraction of the building's shorter side (only pitched roofs)
const ROOF_PITCH_RATIO = 0.22;
const TREE_HEIGHT_FT = 10;

// Neutral "vinyl siding" palette — keeps attention on roofs for product identification
const WALLS = {
  light: '#eee5d0',
  mid:   '#d6cab0',
  dark:  '#a79a7c',
};

// Per-product identifying colors — used mainly on the roof
const COLORS = [
  { roof: '#3730a3', stroke: '#1e1b4b', accent: '#4f46e5' },
  { roof: '#065f46', stroke: '#064e3b', accent: '#059669' },
  { roof: '#9a6212', stroke: '#713f12', accent: '#d97706' },
  { roof: '#991b1b', stroke: '#7f1d1d', accent: '#dc2626' },
  { roof: '#5b21b6', stroke: '#3b0764', accent: '#7c3aed' },
  { roof: '#9a3412', stroke: '#7c2d12', accent: '#ea580c' },
];

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

// Generalized orthographic projection with yaw (θ) around z-axis, pitch (φ) tilt from horizon
// v holds { cosA, sinA, cosP, sinP, ox, oy }
function proj(px, py, pz, v) {
  const xr = px * v.cosA - py * v.sinA;
  const yr = px * v.sinA + py * v.cosA;
  return {
    x: v.ox + xr,
    y: v.oy + yr * v.sinP - pz * v.cosP,
  };
}

// Inverse of proj for z=0 (ground-plane picking)
function invProj(sx, sy, v) {
  const xr = sx - v.ox;
  const yr = (sy - v.oy) / Math.max(v.sinP, 0.02);
  return {
    x:  xr * v.cosA + yr * v.sinA,
    y: -xr * v.sinA + yr * v.cosA,
  };
}

// Depth-from-camera for sorting (higher = closer to viewer)
function depthOf(px, py, v) {
  return px * v.sinA + py * v.cosA;
}

function rotatePt(x, y, cx, cy, angleDeg) {
  const r = angleDeg * DEG;
  const c = Math.cos(r), s = Math.sin(r);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

function rotatedBBox(cx, cy, sw, sh, angleDeg) {
  const rad = angleDeg * DEG;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  return { x: cx - (sw * c + sh * s) / 2, y: cy - (sw * s + sh * c) / 2,
           w:  sw * c + sh * s,           h:  sw * s + sh * c };
}

function footprintCorners(xPx, yPx, w, h, angleDeg) {
  const cx = xPx + w / 2, cy = yPx + h / 2;
  return [
    rotatePt(xPx,     yPx,     cx, cy, angleDeg),
    rotatePt(xPx + w, yPx,     cx, cy, angleDeg),
    rotatePt(xPx + w, yPx + h, cx, cy, angleDeg),
    rotatePt(xPx,     yPx + h, cx, cy, angleDeg),
  ];
}

function pts(arr) {
  return arr.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

// Convert a Regrid-style outer ring ([[lon, lat], …]) to plan-pixel coords
// anchored to (0, 0) at the parcel bbox's NW corner. y grows south (same as
// SVG plan convention used elsewhere in this component).
const FEET_PER_DEG_LAT = 364173;
function ringToPlanCoords(ring, scale) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const lats = ring.map(c => c[1]);
  const midLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const fpLon  = FEET_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const xs = ring.map(c => c[0] * fpLon);
  const ys = ring.map(c => c[1] * FEET_PER_DEG_LAT);
  const minX = Math.min(...xs);
  const maxY = Math.max(...ys);
  return ring.map((_, i) => [(xs[i] - minX) * scale, (maxY - ys[i]) * scale]);
}

// Ray-casting point-in-polygon test. `poly` is an array of {x, y}.
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersects = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

// True iff all four corners of a (possibly rotated) rectangle centred around
// the top-left (xPx, yPx) are inside `poly`. Cheap proxy for "the whole
// footprint is inside" — works for convex polygons; for mildly concave
// polygons the edge midpoints may still poke out slightly, which we accept.
function rectangleInsidePolygon(xPx, yPx, w, h, angleDeg, poly) {
  if (!poly || poly.length < 3) return true;
  const corners = footprintCorners(xPx, yPx, w, h, angleDeg);
  for (const c of corners) {
    if (!pointInPolygon(c.x, c.y, poly)) return false;
  }
  return true;
}

// Cast a ray from (startX, startY) in unit direction (dirX, dirY) and return
// the parametric distance to the nearest polygon edge it hits, or Infinity
// if none. `poly` is an array of {x, y}.
function rayToPolygonDistance(startX, startY, dirX, dirY, poly) {
  let tMin = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = dirX * ey - dirY * ex;
    if (Math.abs(denom) < 1e-9) continue; // ray parallel to this edge
    const qx = a.x - startX, qy = a.y - startY;
    const t = (qx * ey - qy * ex) / denom;            // ray parameter
    const s = (qx * dirY - qy * dirX) / denom;        // segment parameter
    if (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6 && t < tMin) {
      tMin = t;
    }
  }
  return tMin;
}

// Signed area of a polygon (plan/screen y-down).
// Positive = clockwise on screen, negative = counter-clockwise.
function polygonSignedArea(ring) {
  let s = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// Inset a polygon (concave or convex) by a uniform `distance` (plan pixels).
// Uses the `polygon-offset` library, which handles reflex corners correctly
// — naive miter offsetting produces "spike" artifacts at concave corners
// because the offset lines of the two adjacent edges intersect outside the
// polygon. This routine truncates miters and removes self-intersections.
//
// `setbacks` is `{ front, rear, side }`; we collapse them to a single
// uniform distance using the largest value (most conservative). True
// per-side setbacks on an arbitrary polygon are ill-defined without an
// address-side annotation, and per-edge directional weighting produced
// inconsistent results on irregular lots.
function polygonInset(ring, { front, rear, side }) {
  const n = ring.length;
  if (n < 3) return null;
  const distance = Math.max(front, rear, side);
  if (!(distance > 0)) return ring.map((p) => ({ x: p.x, y: p.y }));

  const origArea = polygonSignedArea(ring);
  if (Math.abs(origArea) < 1e-6) return null;

  // polygon-offset expects a closed ring with CCW exterior winding. Our
  // y-down screen polygon has positive shoelace = CW visually, so we
  // reverse to CCW before handing it over.
  const path = (origArea > 0 ? [...ring].reverse() : ring).map((p) => [p.x, p.y]);
  const first = path[0], last = path[path.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) path.push([first[0], first[1]]);

  let result;
  try {
    const o = new Offset();
    // .padding(d) shrinks the polygon inward by d (correct for setback);
    // .margin(d) is the opposite (outward grow). The library returns
    // either a closed ring [[x,y],...] or an array of them when the
    // inset disconnects into multiple pieces.
    result = o.data(path).padding(distance);
  } catch {
    return null;
  }
  if (!result || !result.length) return null;

  // Pick the largest sub-polygon (by absolute area) when the inset splits.
  let bestRing = null, bestAbsA = 0;
  for (const candidate of result) {
    if (!Array.isArray(candidate) || candidate.length < 3) continue;
    const ringAsObjs = candidate.map(([x, y]) => ({ x, y }));
    const a = Math.abs(polygonSignedArea(ringAsObjs));
    if (a > bestAbsA) { bestAbsA = a; bestRing = ringAsObjs; }
  }
  if (!bestRing) return null;
  if (bestAbsA < Math.abs(origArea) * 0.02) return null; // setbacks ate the lot

  return bestRing;
}

// Build an SVG path with an outer ring and an optional inner hole, using the
// evenodd fill-rule to paint only the area between them (the setback band).
function outerMinusInnerPath(outer, inner) {
  if (!outer?.length) return '';
  const seg = (ring) => {
    let s = `M ${ring[0].x.toFixed(2)} ${ring[0].y.toFixed(2)}`;
    for (let i = 1; i < ring.length; i++) s += ` L ${ring[i].x.toFixed(2)} ${ring[i].y.toFixed(2)}`;
    return s + ' Z';
  };
  let d = seg(outer);
  if (inner?.length >= 3) d += ' ' + seg(inner);
  return d;
}

function Tree({ xPx, yPx, r, v, scale, realistic }) {
  const treeHPx = TREE_HEIGHT_FT * scale;
  const base = proj(xPx, yPx, 0, v);
  const top  = proj(xPx, yPx, treeHPx, v);
  const shPt = proj(xPx + 3, yPx + 3, 0, v);
  if (realistic) {
    return (
      <g>
        <ellipse cx={shPt.x + r * 0.4} cy={shPt.y} rx={r * 1.55} ry={r * 0.7}
          fill="rgba(0,0,0,0.3)" filter="url(#soft-shadow)" />
        <line x1={base.x} y1={base.y} x2={top.x} y2={top.y}
          stroke="#4a2f1a" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx={top.x + r * 0.2} cy={top.y + r * 0.15} r={r * 1.05} fill="#1f5433" />
        <circle cx={top.x}            cy={top.y}            r={r}         fill="#2d6a4f" />
        <circle cx={top.x - r * 0.35} cy={top.y - r * 0.25} r={r * 0.7}  fill="#52b788" />
        <circle cx={top.x - r * 0.55} cy={top.y - r * 0.45} r={r * 0.35} fill="#8fd1a8" />
      </g>
    );
  }
  return (
    <g>
      <ellipse cx={shPt.x} cy={shPt.y} rx={r * 1.2} ry={r * 0.55} fill="rgba(0,0,0,0.22)" />
      <line x1={base.x} y1={base.y} x2={top.x} y2={top.y}
        stroke="#5a3a22" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx={top.x} cy={top.y} r={r} fill="#2d6a4f" />
      <circle cx={top.x - r * 0.25} cy={top.y - r * 0.25} r={r * 0.55} fill="#52b788" />
    </g>
  );
}

function Building({ pl, stories, units, color, colorIdx, realistic, scale, xPx, yPx, rotation, v, isDragging, isRotating, isViolating, onMouseDown, onRotateStart, productName }) {
  const bw = pl.widthFt * scale;
  const bh = pl.depthFt * scale;
  const eaveFt   = stories * STORY_HEIGHT_FT + FOUNDATION_FT;
  const eavePx   = eaveFt * scale;
  const usePitched = stories <= 2;
  const ridgeExtraFt = usePitched ? Math.min(pl.widthFt, pl.depthFt) * ROOF_PITCH_RATIO : 0;
  const ridgePx  = eavePx + ridgeExtraFt * scale;

  const cornersBot  = footprintCorners(xPx, yPx, bw, bh, rotation);
  const screenBot   = cornersBot.map(p => proj(p.x, p.y, 0,      v));
  const screenEave  = cornersBot.map(p => proj(p.x, p.y, eavePx, v));

  const cx = xPx + bw / 2, cy = yPx + bh / 2;

  // Ridge endpoints in plan (if pitched) — at midpoints of the short-side walls
  const ridgeAlongX = pl.widthFt >= pl.depthFt;
  const ridgeLocalA = ridgeAlongX ? { x: xPx,      y: yPx + bh / 2 } : { x: xPx + bw / 2, y: yPx      };
  const ridgeLocalB = ridgeAlongX ? { x: xPx + bw, y: yPx + bh / 2 } : { x: xPx + bw / 2, y: yPx + bh };
  const ridgePlanA  = rotatePt(ridgeLocalA.x, ridgeLocalA.y, cx, cy, rotation);
  const ridgePlanB  = rotatePt(ridgeLocalB.x, ridgeLocalB.y, cx, cy, rotation);
  const ridgeScreenA = proj(ridgePlanA.x, ridgePlanA.y, ridgePx, v);
  const ridgeScreenB = proj(ridgePlanB.x, ridgePlanB.y, ridgePx, v);

  const centerTop = proj(cx, cy, usePitched ? ridgePx : eavePx, v);
  const handleY   = centerTop.y - 20;
  const isActive  = isDragging || isRotating;

  // Ground shadow — proportional to eave height and current pitch (nearly disappears top-down)
  const shadowOff = Math.max(2, eavePx * 0.10);
  const shadowCorners = cornersBot.map(p => proj(p.x + shadowOff, p.y + shadowOff, 0, v));

  function wallPoint(ci, cj, frac, z) {
    return proj(ci.x + (cj.x - ci.x) * frac, ci.y + (cj.y - ci.y) * frac, z, v);
  }
  function wallRect(ci, cj, f1, f2, z1, z2) {
    return [wallPoint(ci, cj, f1, z1), wallPoint(ci, cj, f2, z1),
            wallPoint(ci, cj, f2, z2), wallPoint(ci, cj, f1, z2)];
  }

  // Build 4 walls with gable pentagon where applicable (pre-rotation indices: 0=N, 1=E, 2=S-front, 3=W)
  const walls = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ci = cornersBot[i];
    const cj = cornersBot[j];
    const midDepth = depthOf((ci.x + cj.x) / 2, (ci.y + cj.y) / 2, v);
    const wallWidthFt = Math.hypot(cj.x - ci.x, cj.y - ci.y) / scale;
    const isFront = i === 2;
    const isGable = usePitched && (ridgeAlongX ? (i === 1 || i === 3) : (i === 0 || i === 2));
    const ridgeApex = isGable
      ? ((ridgeAlongX ? (i === 3) : (i === 0)) ? ridgeScreenA : ridgeScreenB)
      : null;
    const polyBase = isGable
      ? [screenBot[i], screenBot[j], screenEave[j], ridgeApex, screenEave[i]]
      : [screenBot[i], screenBot[j], screenEave[j], screenEave[i]];
    walls.push({ i, j, ci, cj, midDepth, wallWidthFt, isFront, isGable, polyBase });
  }
  walls.sort((a, b) => a.midDepth - b.midDepth);
  const wallFills = [WALLS.dark, WALLS.dark, WALLS.mid, WALLS.light];

  // Roof pieces
  const roofPieces = [];
  const midOf = (...pts) => {
    const sx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const sy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return depthOf(sx, sy, v);
  };
  if (usePitched) {
    if (ridgeAlongX) {
      roofPieces.push({ poly: [screenEave[0], screenEave[1], ridgeScreenB, ridgeScreenA],
        depth: midOf(cornersBot[0], cornersBot[1], ridgePlanA, ridgePlanB), shade: 'dark'  });
      roofPieces.push({ poly: [screenEave[3], screenEave[2], ridgeScreenB, ridgeScreenA],
        depth: midOf(cornersBot[3], cornersBot[2], ridgePlanA, ridgePlanB), shade: 'light' });
    } else {
      roofPieces.push({ poly: [screenEave[0], screenEave[3], ridgeScreenB, ridgeScreenA],
        depth: midOf(cornersBot[0], cornersBot[3], ridgePlanA, ridgePlanB), shade: 'dark'  });
      roofPieces.push({ poly: [screenEave[1], screenEave[2], ridgeScreenB, ridgeScreenA],
        depth: midOf(cornersBot[1], cornersBot[2], ridgePlanA, ridgePlanB), shade: 'light' });
    }
  } else {
    roofPieces.push({ poly: screenEave, depth: Number.POSITIVE_INFINITY, shade: 'flat' });
  }
  roofPieces.sort((a, b) => a.depth - b.depth);

  function decorateWall(wall, fillIdx, key) {
    const { ci, cj, wallWidthFt, isFront, polyBase } = wall;
    const nodes = [];
    const wallFill = isViolating ? 'rgba(220,38,38,0.6)' : wallFills[fillIdx];

    nodes.push(
      <polygon key={`${key}-p`} points={pts(polyBase)}
        fill={wallFill} stroke="rgba(40,30,20,0.45)" strokeWidth="0.7" strokeLinejoin="miter" />
    );

    if (wallWidthFt > 12) {
      for (let s = 1; s < stories; s++) {
        const z = s * (eavePx / stories);
        const l1 = wallPoint(ci, cj, 0, z);
        const l2 = wallPoint(ci, cj, 1, z);
        nodes.push(
          <line key={`${key}-s${s}`} x1={l1.x} y1={l1.y} x2={l2.x} y2={l2.y}
            stroke="rgba(40,30,20,0.22)" strokeWidth="0.7" />
        );
      }
    }

    if (wallWidthFt > 10) {
      const cols = Math.max(2, Math.min(8, Math.floor(wallWidthFt / 9)));
      const winWFt = 2.4, winHFt = 3.8;
      const halfWFrac = (winWFt / 2) / wallWidthFt;
      const storyHPx  = eavePx / stories;
      for (let row = 0; row < stories; row++) {
        const zCenter = row * storyHPx + storyHPx * 0.58;
        const zBot = zCenter - (winHFt / 2) * scale;
        const zTop = zCenter + (winHFt / 2) * scale;
        if (zBot < 0.4 * scale) continue;
        for (let c = 0; c < cols; c++) {
          const fracCenter = (c + 0.5) / cols;
          if (isFront && row === 0) {
            const doorCount = Math.min(Math.max(1, units), 4);
            let clashesDoor = false;
            for (let d = 0; d < doorCount; d++) {
              const doorCenter = (d + 0.5) / doorCount;
              if (Math.abs(doorCenter - fracCenter) < (1.6 / wallWidthFt + halfWFrac)) {
                clashesDoor = true; break;
              }
            }
            if (clashesDoor) continue;
          }
          const poly = wallRect(ci, cj, fracCenter - halfWFrac, fracCenter + halfWFrac, zBot, zTop);
          nodes.push(
            <polygon key={`${key}-w${row}-${c}`} points={pts(poly)}
              fill={realistic ? 'url(#window-grad)' : '#bfd8ec'}
              stroke="rgba(40,30,20,0.5)" strokeWidth="0.45" />
          );
          const mp1 = wallPoint(ci, cj, fracCenter, zBot);
          const mp2 = wallPoint(ci, cj, fracCenter, zTop);
          nodes.push(
            <line key={`${key}-m${row}-${c}`} x1={mp1.x} y1={mp1.y} x2={mp2.x} y2={mp2.y}
              stroke="rgba(40,30,20,0.4)" strokeWidth="0.35" />
          );
        }
      }
    }

    if (isFront && wallWidthFt > 12) {
      const doorCount = Math.min(Math.max(1, units), 4);
      const doorWFt = 3, doorHFt = 7;
      const halfWFrac = (doorWFt / 2) / wallWidthFt;
      for (let d = 0; d < doorCount; d++) {
        const fracCenter = (d + 0.5) / doorCount;
        const poly = wallRect(ci, cj, fracCenter - halfWFrac, fracCenter + halfWFrac, 0, doorHFt * scale);
        nodes.push(
          <polygon key={`${key}-d${d}`} points={pts(poly)}
            fill={realistic ? 'url(#door-grad)' : '#3a2817'}
            stroke="rgba(20,10,0,0.6)" strokeWidth="0.5" />
        );
        const knob = wallPoint(ci, cj, fracCenter + halfWFrac * 0.55, doorHFt * scale * 0.5);
        nodes.push(<circle key={`${key}-k${d}`} cx={knob.x} cy={knob.y} r="0.55" fill="#d4af37" />);
      }
    }

    return nodes;
  }

  const roofStroke = isViolating ? '#dc2626' : color.stroke;

  const shadowOffLong = realistic ? Math.max(4, eavePx * 0.18) : shadowOff;
  const shadowCornersRealistic = realistic
    ? cornersBot.map(p => proj(p.x + shadowOffLong, p.y + shadowOffLong, 0, v))
    : shadowCorners;

  return (
    <g>
      {realistic ? (
        <polygon points={pts(shadowCornersRealistic)} fill="rgba(0,0,0,0.4)" filter="url(#soft-shadow)" />
      ) : (
        <polygon points={pts(shadowCorners)} fill="rgba(0,0,0,0.3)" />
      )}

      <g onPointerDown={onMouseDown}
        style={{ cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none' }}>
        {walls.map((wall, idx) => (
          <g key={`wall-${wall.i}`}>
            {decorateWall(wall, idx, `wall-${wall.i}`)}
          </g>
        ))}

        {roofPieces.map((piece, i) => {
          const base = isViolating ? 'rgba(220,38,38,0.75)' : color.roof;
          let fill;
          if (realistic && !isViolating) {
            fill = `url(#roof-grad-${colorIdx})`;
          } else {
            fill = piece.shade === 'light' ? base
                 : piece.shade === 'dark'  ? color.stroke
                 : base;
          }
          return (
            <polygon key={`rp-${i}`} points={pts(piece.poly)}
              fill={fill} stroke={roofStroke}
              strokeWidth={isActive ? 2 : 1.2} strokeLinejoin="miter" />
          );
        })}
        {usePitched && (
          <line x1={ridgeScreenA.x} y1={ridgeScreenA.y} x2={ridgeScreenB.x} y2={ridgeScreenB.y}
            stroke={roofStroke} strokeWidth={isActive ? 2 : 1.3} strokeLinecap="round" />
        )}

        {!usePitched && bw > 40 && bh > 30 && (
          (() => {
            const hvW = bw * 0.25, hvD = bh * 0.18;
            const hvCX = xPx + bw * 0.72, hvCY = yPx + bh * 0.28;
            const hvCorners = footprintCorners(hvCX - hvW/2, hvCY - hvD/2, hvW, hvD, rotation);
            const hvTop = hvCorners.map(p => proj(p.x, p.y, eavePx + 1.5 * scale, v));
            return (
              <polygon points={pts(hvTop)} fill={color.accent} opacity="0.5"
                stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" />
            );
          })()
        )}

        {isActive && (
          <polygon points={pts(screenBot)} fill="none"
            stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeDasharray="5 3" />
        )}
        {isViolating && (
          <polygon points={pts(screenBot)} fill="none"
            stroke="#dc2626" strokeWidth="1.8" strokeDasharray="4 3" />
        )}

        {bw > 40 && bh > 22 && productName ? (
          <g style={{ pointerEvents: 'none' }}>
            <text x={centerTop.x} y={centerTop.y + 3} textAnchor="middle"
              fill="#ffffff" fontSize="7.5" fontWeight="700"
              style={{ textShadow: '0 0 3px rgba(0,0,0,0.95)' }}>
              {productName}
            </text>
            <text x={centerTop.x} y={centerTop.y + 11} textAnchor="middle"
              fill="#ffffff" fontSize="5.5" fontWeight="500"
              style={{ textShadow: '0 0 3px rgba(0,0,0,0.95)' }}>
              {pl.widthFt}′×{pl.depthFt}′ · {stories}-story
            </text>
          </g>
        ) : bw > 24 && bh > 14 ? (
          <text x={centerTop.x} y={centerTop.y + 3} textAnchor="middle"
            fill="#ffffff" fontSize="6.5" fontWeight="600"
            style={{ textShadow: '0 0 3px rgba(0,0,0,0.95)', pointerEvents: 'none' }}>
            {pl.widthFt}′×{pl.depthFt}′
          </text>
        ) : null}
      </g>

      <g onPointerDown={onRotateStart}
        style={{ cursor: 'grab', userSelect: 'none', touchAction: 'none' }}>
        {/* Invisible larger hit area for touch */}
        <circle cx={centerTop.x} cy={handleY} r="18" fill="transparent" />
        <line x1={centerTop.x} y1={centerTop.y} x2={centerTop.x} y2={handleY}
          stroke={isRotating ? '#1d2cf3' : 'rgba(15,23,42,0.45)'}
          strokeWidth="1.4" strokeLinecap="round"
          strokeDasharray={isRotating ? 'none' : '2 3'} />
        <circle cx={centerTop.x} cy={handleY} r={isRotating ? 11 : 9}
          fill={isRotating ? 'rgba(29,44,243,0.18)' : 'rgba(15,23,42,0.08)'} />
        <circle cx={centerTop.x} cy={handleY} r="7.5"
          fill={isRotating ? '#1d2cf3' : '#ffffff'}
          stroke={isRotating ? '#1d2cf3' : '#374151'} strokeWidth="1.5" />
        <g transform={`translate(${centerTop.x}, ${handleY})`} style={{ pointerEvents: 'none' }}>
          <path d="M -3.2 -0.5 A 3.2 3.2 0 1 1 0.8 3.1" fill="none"
            stroke={isRotating ? '#ffffff' : '#374151'} strokeWidth="1.3" strokeLinecap="round" />
          <polygon points="0.8,3.1 -0.6,3.7 1.4,4.6"
            fill={isRotating ? '#ffffff' : '#374151'} />
        </g>
      </g>

      {isRotating && (
        <g style={{ pointerEvents: 'none' }}>
          <rect x={centerTop.x - 22} y={handleY - 28} width="44" height="20" rx="10" fill="#1d2cf3" />
          <text x={centerTop.x} y={handleY - 14} textAnchor="middle"
            fill="#ffffff" fontSize="10" fontWeight="700" letterSpacing="0.5">
            {Math.round(((rotation % 360) + 360) % 360)}°
          </text>
        </g>
      )}
    </g>
  );
}

function getSvgPoint(e, svgEl) {
  const rect = svgEl.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (SVG_W / rect.width),
    y: (e.clientY - rect.top)  * (SVG_H / rect.height),
  };
}

export default function BirdsEyeSVG({ parcel, setbacks, placements = [], products = [], isLoading, aiNotes, aiSource }) {
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

  // ─── View mode + camera (yaw + pitch) ────────────────────────────
  const [viewMode, setViewMode] = useState('realistic'); // '2d' | 'realistic' (3D v1) | 'satellite' | 'cesium'
  const [yaw,   setYaw]   = useState(DEFAULT_YAW);
  const [pitch, setPitch] = useState(DEFAULT_PITCH);

  // ─── Satellite (real lot) state ──────────────────────────────────
  // Declared before it's used by effectiveYaw / sceneOx below.
  const [address, setAddress]       = useState('');
  const [geo, setGeo]               = useState(null); // { lat, lng, displayName }
  const [satLoading, setSatLoading] = useState(false);
  const [satError, setSatError]     = useState('');
  const [satShift, setSatShift]     = useState({ x: 0, y: 0 }); // screen pixels
  const [satYaw,   setSatYaw]       = useState(0);               // degrees
  // OSM building footprints near the geocoded point — each is an array of {lat, lon}
  const [osmBuildings, setOsmBuildings] = useState([]);

  function resetAlignment() {
    setSatShift({ x: 0, y: 0 });
    setSatYaw(0);
  }

  const realistic  = viewMode === 'realistic';
  const isFlatView = viewMode === '2d' || viewMode === 'satellite';

  // In 2D / Satellite mode, force a straight-down plan view. Satellite allows
  // user-controlled yaw so the lot can be rotated to match the actual parcel.
  const effectiveYaw   = viewMode === 'satellite' ? satYaw
                       : viewMode === '2d'        ? 0
                       : yaw;
  const effectivePitch = isFlatView ? 90 : pitch;

  async function fetchOsmBuildings(lat, lng) {
    // Overpass: all building=* ways within 80 m of the pin
    const query = `[out:json][timeout:15];(way(around:80,${lat},${lng})["building"];);out geom;`;
    const r = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
    const d = await r.json();
    return (d.elements || [])
      .filter(e => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 3)
      .map(e => e.geometry);
  }

  async function loadSatellite() {
    const q = address.trim();
    if (!q) return;
    setSatLoading(true);
    setSatError('');
    setOsmBuildings([]);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=0`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const d = await r.json();
      if (!Array.isArray(d) || !d.length) throw new Error('Address not found');
      const latF = parseFloat(d[0].lat);
      const lonF = parseFloat(d[0].lon);
      setGeo({ lat: latF, lng: lonF, displayName: d[0].display_name });
      resetAlignment();

      // Fetch OSM building footprints; if any found, auto-center the lot on
      // the one nearest the address pin so the user doesn't have to pan.
      try {
        const buildings = await fetchOsmBuildings(latF, lonF);
        setOsmBuildings(buildings);
        if (buildings.length) {
          const ftPerDegLat = 364000;
          const ftPerDegLng = 364000 * Math.cos(latF * Math.PI / 180);
          let best = null, bestD = Infinity;
          for (const poly of buildings) {
            const cLat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
            const cLon = poly.reduce((s, p) => s + p.lon, 0) / poly.length;
            const d2 = (cLat - latF) ** 2 + (cLon - lonF) ** 2;
            if (d2 < bestD) { bestD = d2; best = { cLat, cLon }; }
          }
          if (best) {
            const shiftX = (best.cLon - lonF) * ftPerDegLng * scale;
            const shiftY = -(best.cLat - latF) * ftPerDegLat * scale;
            setSatShift({ x: shiftX, y: shiftY });
          }
        }
      } catch (osmErr) {
        // Non-fatal: keep satellite without outlines
        console.warn('OSM buildings unavailable', osmErr);
      }
    } catch (err) {
      setGeo(null);
      setSatError(err?.message || 'Lookup failed');
    } finally {
      setSatLoading(false);
    }
  }

  const cosA = Math.cos(effectiveYaw   * DEG);
  const sinA = Math.sin(effectiveYaw   * DEG);
  const cosP = Math.cos(effectivePitch * DEG);
  const sinP = Math.sin(effectivePitch * DEG);

  // Reserve vertical space for the tallest building
  const maxStories = placements.reduce((m, pl) => Math.max(m, productMap[pl.productId]?.stories ?? 1), 1);
  const reservedHeightFt = maxStories * STORY_HEIGHT_FT + FOUNDATION_FT + 6;

  // Fit scale using worst-case rotated bounding box (diagonal) so the scene stays stable as yaw changes
  const availW = SVG_W - LABEL_PAD * 2;
  const availH = SVG_H - LABEL_PAD * 2;
  const diagFt = Math.sqrt(parcel.frontage ** 2 + parcel.depth ** 2);
  const scaleW = availW / diagFt;
  const scaleH = availH / (diagFt * sinP + reservedHeightFt * cosP);
  const scale  = Math.min(scaleW, scaleH);

  const pW = parcel.frontage * scale;
  const pH = parcel.depth    * scale;
  const reservedHeightPx = reservedHeightFt * scale;

  // Centre the parcel's rotated-bbox in the viewBox, leaving room for building extrusion above
  const parcelCornersPlan = [[0, 0], [pW, 0], [pW, pH], [0, pH]];
  const yrVals = parcelCornersPlan.map(([x, y]) => x * sinA + y * cosA);
  const xrVals = parcelCornersPlan.map(([x, y]) => x * cosA - y * sinA);
  const xrMin = Math.min(...xrVals), xrMax = Math.max(...xrVals);
  const yrMin = Math.min(...yrVals), yrMax = Math.max(...yrVals);
  const baseSceneOx = SVG_W / 2 - (xrMin + xrMax) / 2;
  const baseSceneOy = SVG_H / 2 + reservedHeightPx * cosP / 2 - (yrMin + yrMax) / 2 * sinP;
  const sceneOx = baseSceneOx + (viewMode === 'satellite' ? satShift.x : 0);
  const sceneOy = baseSceneOy + (viewMode === 'satellite' ? satShift.y : 0);

  const v = { cosA, sinA, cosP, sinP, ox: sceneOx, oy: sceneOy };

  const sbFront = setbacks.front * scale;
  const sbRear  = setbacks.rear  * scale;
  const sbSide  = setbacks.side  * scale;

  // Parcel polygon + setback inset.
  //   _ringPlanForClamp  → used for drag-clamping and distance-to-edge math
  //                        (buildings may move freely anywhere inside this)
  //   _insetPlanForClamp → retained only for rendering the setback band
  const _ringPlanForClamp = ringToPlanCoords(parcel.ring, scale);
  const _insetPlanForClamp = _ringPlanForClamp
    ? polygonInset(_ringPlanForClamp.map(([x, y]) => ({ x, y })),
                   { front: sbFront, rear: sbRear, side: sbSide })
    : null;

  // Buildable envelope: the parcel polygon's bbox. Buildings are free to
  // move anywhere inside the parcel — the setback inset is informational
  // only and no longer limits drag.
  let buildX, buildY, buildW, buildH;
  if (_ringPlanForClamp && _ringPlanForClamp.length >= 3) {
    const rxs = _ringPlanForClamp.map(([x]) => x);
    const rys = _ringPlanForClamp.map(([, y]) => y);
    buildX = Math.min(...rxs);
    buildY = Math.min(...rys);
    buildW = Math.max(...rxs) - buildX;
    buildH = Math.max(...rys) - buildY;
  } else {
    buildX = 0;
    buildY = 0;
    buildW = pW;
    buildH = pH;
  }

  const uniqueIds    = [...new Set(placements.map((p) => p.productId))];
  const colorMap     = Object.fromEntries(uniqueIds.map((id, i) => [id, COLORS[i % COLORS.length]]));
  const colorIdxMap  = Object.fromEntries(uniqueIds.map((id, i) => [id, i % COLORS.length]));
  const legendItems  = uniqueIds.map((id) => ({ id, color: colorMap[id], name: productMap[id]?.name ?? id }));

  const [posFt,     setPosFt]     = useState(() => placements.map((pl) => ({ xFt: pl.xFt ?? 0, yFt: pl.yFt ?? 0 })));
  const [rotations, setRotations] = useState(() => placements.map(() => 0));
  const [activeIdx, setActiveIdx] = useState(null);
  const [activeMode, setActiveMode] = useState(null);

  const dragRef = useRef(null);
  const svgRef  = useRef(null);

  useEffect(() => {
    setPosFt(placements.map((pl) => ({ xFt: pl.xFt ?? 0, yFt: pl.yFt ?? 0 })));
    setRotations(placements.map(() => 0));
  }, [placements]);

  // Auto-load satellite imagery from the Regrid-supplied parcel centroid
  // when the user switches to the Real-lot tab, skipping the manual address
  // search and the OSM auto-center (the real polygon is already accurate).
  useEffect(() => {
    if (viewMode !== 'satellite') return;
    if (geo) return;
    const pLat = parcel?.centerLat;
    const pLng = parcel?.centerLon;
    if (pLat == null || pLng == null) return;

    setGeo({ lat: pLat, lng: pLng, displayName: parcel.displayAddress || '' });
    setAddress(parcel.displayAddress || '');
    setSatShift({ x: 0, y: 0 });
    setSatYaw(0);
    setSatError('');
    // Fetch building footprints in the background for visual context
    fetchOsmBuildings(pLat, pLng).then(setOsmBuildings).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, parcel?.centerLat, parcel?.centerLon]);

  function capturePointer(e) {
    try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  }

  function handleDragStart(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    capturePointer(e);
    const pt   = getSvgPoint(e, svgRef.current);
    const plan = invProj(pt.x, pt.y, v);
    const pos  = posFt[idx];
    dragRef.current = {
      mode: 'drag', idx,
      offsetX: plan.x - (buildX + pos.xFt * scale),
      offsetY: plan.y - (buildY + pos.yFt * scale),
    };
    setActiveIdx(idx);
    setActiveMode('drag');
  }

  function handleRotateStart(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    capturePointer(e);
    const pos = posFt[idx];
    const pl  = placements[idx];
    const sw  = pl.widthFt * scale;
    const sh  = pl.depthFt * scale;
    dragRef.current = {
      mode: 'rotate', idx,
      cx: buildX + pos.xFt * scale + sw / 2,
      cy: buildY + pos.yFt * scale + sh / 2,
    };
    setActiveIdx(idx);
    setActiveMode('rotate');
  }

  // Empty-ground pointer-down:
  //  · satellite (lot loaded) → pan the lot over the imagery
  //  · 3D / Realistic → camera orbit
  //  · 2D / satellite-no-lot → no-op
  function handleCameraStart(e) {
    if (e.defaultPrevented) return;
    const pt = getSvgPoint(e, svgRef.current);

    if (viewMode === 'satellite') {
      if (!geo) return;
      capturePointer(e);
      dragRef.current = {
        mode: 'pan-parcel',
        startSX: pt.x, startSY: pt.y,
        startShift: { ...satShift },
      };
      setActiveMode('pan-parcel');
      return;
    }

    if (isFlatView) return;
    capturePointer(e);
    dragRef.current = {
      mode: 'camera',
      startSX: pt.x, startSY: pt.y,
      startYaw: yaw, startPitch: pitch,
    };
    setActiveMode('camera');
  }

  // Drag the yellow rotate handle around the parcel → rotate the lot
  function handleParcelRotateStart(e) {
    e.preventDefault();
    e.stopPropagation();
    capturePointer(e);
    const pt = getSvgPoint(e, svgRef.current);
    const parcelCx = SVG_W / 2 + satShift.x;
    const parcelCy = SVG_H / 2 + satShift.y;
    dragRef.current = {
      mode: 'rotate-parcel',
      cx: parcelCx, cy: parcelCy,
      startPointerAngle: Math.atan2(pt.y - parcelCy, pt.x - parcelCx) * 180 / Math.PI,
      startYaw: satYaw,
    };
    setActiveMode('rotate-parcel');
  }

  function clampRotated(xPx, yPx, sw, sh, angleDeg) {
    const rad = angleDeg * DEG;
    const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    const hw = (sw * c + sh * s) / 2;
    const hh = (sw * s + sh * c) / 2;
    return {
      xPx: Math.max(hw - sw / 2, Math.min(buildW - sw / 2 - hw, xPx)),
      yPx: Math.max(hh - sh / 2, Math.min(buildH - sh / 2 - hh, yPx)),
    };
  }

  function handleMouseMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const pt = getSvgPoint(e, svgRef.current);

    if (d.mode === 'camera') {
      const dx = pt.x - d.startSX;
      const dy = pt.y - d.startSY;
      setYaw(d.startYaw + dx * 0.6);
      setPitch(Math.max(MIN_PITCH, Math.min(MAX_PITCH, d.startPitch + dy * 0.4)));
      return;
    }

    if (d.mode === 'pan-parcel') {
      setSatShift({ x: d.startShift.x + (pt.x - d.startSX),
                    y: d.startShift.y + (pt.y - d.startSY) });
      return;
    }

    if (d.mode === 'rotate-parcel') {
      const currentAngle = Math.atan2(pt.y - d.cy, pt.x - d.cx) * 180 / Math.PI;
      setSatYaw(d.startYaw + (currentAngle - d.startPointerAngle));
      return;
    }

    const plan = invProj(pt.x, pt.y, v);

    // Polygon-containment check: reject any move whose rotated footprint
    // would put a corner outside the setback inset (or the parcel itself
    // when no inset is available — e.g. zero setbacks or degenerate input).
    const constraintPolygon = _insetPlanForClamp?.length
      ? _insetPlanForClamp
      : _ringPlanForClamp
        ? _ringPlanForClamp.map(([x, y]) => ({ x, y }))
        : null;

    if (d.mode === 'drag') {
      const pl  = placements[d.idx];
      const sw  = pl.widthFt * scale;
      const sh  = pl.depthFt * scale;
      const rot = rotations[d.idx] ?? 0;
      const { xPx: nx, yPx: ny } = clampRotated(
        plan.x - buildX - d.offsetX, plan.y - buildY - d.offsetY,
        sw, sh, rot
      );
      // Polygon containment — corners must all be inside the buildable polygon
      if (constraintPolygon &&
          !rectangleInsidePolygon(buildX + nx, buildY + ny, sw, sh, rot, constraintPolygon)) {
        return;
      }
      setPosFt((prev) => {
        const next = [...prev];
        next[d.idx] = { xFt: nx / scale, yFt: ny / scale };
        return next;
      });
    } else if (d.mode === 'rotate') {
      const angle = Math.atan2(plan.y - d.cy, plan.x - d.cx) * (180 / Math.PI) + 90;
      const pl  = placements[d.idx];
      const sw  = pl.widthFt * scale;
      const sh  = pl.depthFt * scale;
      const pos = posFt[d.idx];
      if (!pos) return;
      const { xPx: nx, yPx: ny } = clampRotated(
        pos.xFt * scale, pos.yFt * scale, sw, sh, angle
      );
      if (constraintPolygon &&
          !rectangleInsidePolygon(buildX + nx, buildY + ny, sw, sh, angle, constraintPolygon)) {
        return;
      }
      setRotations((prev) => {
        const next = [...prev];
        next[d.idx] = angle;
        return next;
      });
      if (Math.abs(nx - pos.xFt * scale) > 0.01 || Math.abs(ny - pos.yFt * scale) > 0.01) {
        setPosFt((prev) => {
          const next = [...prev];
          next[d.idx] = { xFt: nx / scale, yFt: ny / scale };
          return next;
        });
      }
    }
  }

  function handleMouseUp() {
    dragRef.current = null;
    setActiveMode(null);
  }

  function resetView() {
    setYaw(DEFAULT_YAW);
    setPitch(DEFAULT_PITCH);
  }
  function topDownView() {
    setPitch(MAX_PITCH);
  }

  const DEFAULT_SPACING = { front: 0, back: 0, left: 0, right: 0 };
  const spacingMap = Object.fromEntries(products.map((p) => [p.id, p.spacing ?? DEFAULT_SPACING]));
  const getSpacing = (id) => spacingMap[id] ?? DEFAULT_SPACING;

  function bboxesConflict(a, b, sa, sb) {
    const aRight = sa.right * scale, aLeft = sa.left * scale;
    const aFront = sa.front * scale, aBack = sa.back * scale;
    const bRight = sb.right * scale, bLeft = sb.left * scale;
    const bFront = sb.front * scale, bBack = sb.back * scale;
    if (a.x + a.w + Math.max(aRight, bLeft) <= b.x) return false;
    if (b.x + b.w + Math.max(bRight, aLeft) <= a.x) return false;
    if (a.y + a.h + Math.max(aFront, bBack) <= b.y) return false;
    if (b.y + b.h + Math.max(bFront, aBack) <= a.y) return false;
    return true;
  }

  const nonCompliant = new Set();
  for (let i = 0; i < placements.length; i++) {
    const pi = posFt[i] ?? { xFt: 0, yFt: 0 };
    const swi = placements[i].widthFt * scale;
    const shi = placements[i].depthFt * scale;
    const bbi = rotatedBBox(buildX + pi.xFt * scale + swi / 2, buildY + pi.yFt * scale + shi / 2, swi, shi, rotations[i] ?? 0);
    const si  = getSpacing(placements[i].productId);
    for (let j = i + 1; j < placements.length; j++) {
      const pj = posFt[j] ?? { xFt: 0, yFt: 0 };
      const swj = placements[j].widthFt * scale;
      const shj = placements[j].depthFt * scale;
      const bbj = rotatedBBox(buildX + pj.xFt * scale + swj / 2, buildY + pj.yFt * scale + shj / 2, swj, shj, rotations[j] ?? 0);
      const sj  = getSpacing(placements[j].productId);
      if (bboxesConflict(bbi, bbj, si, sj)) {
        nonCompliant.add(i);
        nonCompliant.add(j);
      }
    }
  }
  const hasViolation = nonCompliant.size > 0;

  const covered     = placements.reduce((s, pl) => s + pl.widthFt * pl.depthFt, 0);
  const coveragePct = ((covered / parcel.sqft) * 100).toFixed(1);
  const totalUnits  = placements.reduce((s, p) => s + (productMap[p.productId]?.units ?? 1), 0);

  // Real-lot (satellite) mode shows actual trees from the imagery, so skip
  // the decorative stand-in trees used in the stylized views.
  const trees = viewMode === 'satellite' ? [] : (() => {
    const rng = seededRng(42);
    const list = [];
    const margin = 6;
    for (let i = 0; i < 56 && list.length < 14; i++) {
      const r = rng();
      const zone = Math.floor(r * 4);
      let x, y;
      if (zone === 0) { x = rng() * pW; y = rng() * sbRear; }
      else if (zone === 1) { x = rng() * pW; y = pH - rng() * sbFront; }
      else if (zone === 2) { x = rng() * sbSide; y = sbRear + rng() * (pH - sbFront - sbRear); }
      else { x = pW - rng() * sbSide; y = sbRear + rng() * (pH - sbFront - sbRear); }
      if (x > margin && x < pW - margin && y > margin && y < pH - margin) {
        list.push({ x, y, r: 4 + rng() * 4 });
      }
    }
    return list;
  })();

  // Depth-sorted scene items (use actual view depth formula)
  const sceneItems = [];
  placements.forEach((pl, i) => {
    const pos = posFt[i] ?? { xFt: 0, yFt: 0 };
    const bcx = buildX + pos.xFt * scale + pl.widthFt * scale / 2;
    const bcy = buildY + pos.yFt * scale + pl.depthFt * scale / 2;
    sceneItems.push({ type: 'building', idx: i, depth: depthOf(bcx, bcy, v) });
  });
  trees.forEach((t, i) => {
    sceneItems.push({ type: 'tree', idx: i, tree: t, depth: depthOf(t.x, t.y, v) });
  });
  sceneItems.sort((a, b) => a.depth - b.depth);

  if (activeIdx !== null) {
    const at = sceneItems.findIndex(x => x.type === 'building' && x.idx === activeIdx);
    if (at !== -1) {
      const [active] = sceneItems.splice(at, 1);
      sceneItems.push(active);
    }
  }

  // Real parcel polygon (if Regrid supplied one), otherwise the bbox rectangle.
  // The ring + inset were already computed above for drag-clamping; reuse them.
  const ringPlan       = _ringPlanForClamp;
  const insetPlan      = _insetPlanForClamp;
  const hasRealPolygon = Array.isArray(ringPlan) && ringPlan.length >= 3;
  const parcelShapePlan   = hasRealPolygon ? ringPlan : parcelCornersPlan;
  const parcelShapeScreen = parcelShapePlan.map(([x, y]) => proj(x, y, 0, v));
  const parcelScreen      = parcelShapeScreen; // kept for backward-compat naming

  // Setback zones
  //   Rectangle parcel → the existing N/S/E/W pattern-filled strips
  //   Polygon parcel   → true polygon inset; band = polygon minus inset
  let setbackRects = [];
  let polygonInsetScreen = null;
  let polygonSetbackBandPath = null;
  if (hasRealPolygon && insetPlan) {
    polygonInsetScreen = insetPlan.map(p => proj(p.x, p.y, 0, v));
    polygonSetbackBandPath = outerMinusInnerPath(parcelShapeScreen, polygonInsetScreen);
  } else if (!hasRealPolygon) {
    setbackRects = [
      [[0, 0], [pW, 0], [pW, sbRear], [0, sbRear]],
      [[0, pH - sbFront], [pW, pH - sbFront], [pW, pH], [0, pH]],
      [[0, sbRear], [sbSide, sbRear], [sbSide, pH - sbFront], [0, pH - sbFront]],
      [[pW - sbSide, sbRear], [pW, sbRear], [pW, pH - sbFront], [pW - sbSide, pH - sbFront]],
    ].map(poly => poly.map(([x, y]) => proj(x, y, 0, v)));
  }

  const buildCornersScreen = [
    [buildX, buildY], [buildX + buildW, buildY],
    [buildX + buildW, buildY + buildH], [buildX, buildY + buildH],
  ].map(([x, y]) => proj(x, y, 0, v));

  // Ground texture matrix: maps (plan x, y) to screen — for SVG patternTransform
  const groundMatrix = `matrix(${cosA}, ${sinA * sinP}, ${-sinA}, ${cosA * sinP}, 0, 0)`;

  // ─── Satellite image URL (Esri World Imagery, free/no-key) ───────
  // Build a bbox in lat/lng whose on-ground extent matches the SVG viewBox
  // at the current plan-pixel scale, centred on the geocoded point.
  const satelliteUrl = viewMode === 'satellite' && geo ? (() => {
    const ftPerDegLat = 364000;
    const ftPerDegLng = 364000 * Math.cos(geo.lat * Math.PI / 180);
    const bboxWFt = SVG_W / scale;
    const bboxHFt = SVG_H / scale;
    const halfW = bboxWFt / 2 / ftPerDegLng;
    const halfH = bboxHFt / 2 / ftPerDegLat;
    const minLng = geo.lng - halfW;
    const maxLng = geo.lng + halfW;
    const minLat = geo.lat - halfH;
    const maxLat = geo.lat + halfH;
    return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${minLng},${minLat},${maxLng},${maxLat}&bboxSR=4326&size=${SVG_W},${SVG_H}&format=png&f=image`;
  })() : null;

  // Compass: point arrow toward world +y = -cosA*sinP on screen (flipped to show screen north as "up")
  // "North" = plan -y direction → screen (sinA, -cosA*sinP). Angle (clockwise from +x):
  const northAngleDeg = Math.atan2(-cosA * sinP, sinA) * 180 / Math.PI;
  const compassX = SVG_W - LABEL_PAD + 12;
  const compassY = LABEL_PAD - 10;

  const midX = SVG_W / 2;

  return (
    <div className="birds-eye-wrap">
      <div className="birds-eye-tabs" role="tablist" aria-label="View mode">
        <button type="button" role="tab" aria-selected={viewMode === '2d'}
          className={viewMode === '2d' ? 'active' : ''}
          onClick={() => setViewMode('2d')}>2D view</button>
        <button type="button" role="tab" aria-selected={viewMode === 'realistic'}
          className={viewMode === 'realistic' ? 'active' : ''}
          onClick={() => setViewMode('realistic')}>3D view v1</button>
        <button type="button" role="tab" aria-selected={viewMode === 'satellite'}
          className={viewMode === 'satellite' ? 'active' : ''}
          onClick={() => setViewMode('satellite')}>Real lot</button>
        <button type="button" role="tab" aria-selected={viewMode === 'cesium'}
          className={viewMode === 'cesium' ? 'active' : ''}
          onClick={() => setViewMode('cesium')}>3D Globe</button>
      </div>

      {viewMode === 'cesium' && (
        <CesiumView parcel={parcel} placements={placements} products={products} setbacks={setbacks} />
      )}

      {viewMode === 'satellite' && (
        <div className="birds-eye-address-bar">
          <input type="text" placeholder="Enter address (e.g. 1600 Pennsylvania Ave NW, Washington DC)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadSatellite(); }} />
          <button type="button" onClick={loadSatellite}
            disabled={satLoading || !address.trim()}>
            {satLoading ? 'Loading…' : 'Find lot'}
          </button>
          {satError && <span className="bev-address-error">{satError}</span>}
          {geo && !satError && (
            <>
              <span className="bev-address-pin">📍 {geo.displayName}</span>
              {(satShift.x !== 0 || satShift.y !== 0 || satYaw !== 0) && (
                <button type="button" onClick={resetAlignment}
                  className="bev-reset-align">Reset alignment</button>
              )}
            </>
          )}
        </div>
      )}
      {viewMode === 'satellite' && geo && (
        <div className="bev-align-hint">
          {osmBuildings.length > 0
            ? <>Cyan outlines are OSM building footprints · lot auto-centered on the nearest one.{' '}</>
            : <>Drag the lot to pan · drag the yellow handle to rotate.{' '}</>
          }
          {satYaw !== 0 && <strong>({Math.round(((satYaw % 360) + 360) % 360)}°)</strong>}
        </div>
      )}
      {viewMode !== 'cesium' && <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="birds-eye-svg"
        aria-label="Birds-eye parcel layout"
        style={{ cursor: activeMode === 'drag' ? 'grabbing'
                       : activeMode === 'rotate' ? 'crosshair'
                       : activeMode === 'camera' ? 'grabbing'
                       : activeMode === 'pan-parcel' ? 'grabbing'
                       : activeMode === 'rotate-parcel' ? 'crosshair'
                       : (viewMode === 'satellite' && geo) ? 'grab'
                       : !isFlatView ? 'grab'
                       : 'default', touchAction: 'none' }}
        onPointerDown={handleCameraStart}
        onPointerMove={handleMouseMove}
        onPointerUp={handleMouseUp}
        onPointerCancel={handleMouseUp}
      >
        <defs>
          <pattern id="grass-pat" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform={groundMatrix}>
            <rect width="10" height="10" fill="#3a7d44" />
            <circle cx="2" cy="3" r="0.8" fill="#2d6a38" opacity="0.5" />
            <circle cx="7" cy="7" r="0.8" fill="#2d6a38" opacity="0.5" />
            <circle cx="5" cy="1" r="0.5" fill="#4a9458" opacity="0.4" />
          </pattern>
          <pattern id="setback-pat" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform={groundMatrix}>
            <rect width="10" height="10" fill="#4a9a55" />
            <circle cx="3" cy="4" r="0.7" fill="#3a8045" opacity="0.4" />
            <circle cx="8" cy="8" r="0.7" fill="#3a8045" opacity="0.4" />
          </pattern>
          <pattern id="pave-pat" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <rect width="20" height="20" fill="#c8bfae" />
            <rect x="0" y="0" width="10" height="10" fill="rgba(0,0,0,0.03)" />
            <rect x="10" y="10" width="10" height="10" fill="rgba(0,0,0,0.03)" />
          </pattern>

          {/* Realistic-mode assets */}
          <linearGradient id="sky-bg-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#b4d2e2" />
            <stop offset="55%" stopColor="#e5dcc4" />
            <stop offset="100%" stopColor="#b8ab8e" />
          </linearGradient>
          <linearGradient id="window-grad" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
            <stop offset="0%"   stopColor="#2c4560" />
            <stop offset="55%"  stopColor="#a4c2d8" />
            <stop offset="100%" stopColor="#e3ebf0" />
          </linearGradient>
          <linearGradient id="door-grad" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
            <stop offset="0%"   stopColor="#1a0f07" />
            <stop offset="100%" stopColor="#4a3322" />
          </linearGradient>
          {COLORS.map((c, i) => (
            <linearGradient key={`rg-${i}`} id={`roof-grad-${i}`}
              x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
              <stop offset="0%"   stopColor={c.accent} />
              <stop offset="100%" stopColor={c.stroke} />
            </linearGradient>
          ))}
          <filter id="soft-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {viewMode === 'satellite' && satelliteUrl ? (
          <image href={satelliteUrl} x={0} y={0} width={SVG_W} height={SVG_H} preserveAspectRatio="none" />
        ) : viewMode === 'satellite' ? (
          <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#1f2937" />
        ) : (
          <rect x={0} y={0} width={SVG_W} height={SVG_H}
            fill={realistic ? 'url(#sky-bg-grad)' : 'url(#pave-pat)'} />
        )}

        {/* OSM building footprints overlaid on the satellite — anchored to the
            image's lat/lng bbox (independent of the user's lot alignment). */}
        {viewMode === 'satellite' && geo && osmBuildings.length > 0 && (() => {
          const ftPerDegLat = 364000;
          const ftPerDegLng = 364000 * Math.cos(geo.lat * Math.PI / 180);
          return (
            <g style={{ pointerEvents: 'none' }}>
              {osmBuildings.map((poly, i) => {
                const pointsStr = poly.map(p => {
                  const sx = SVG_W / 2 + (p.lon - geo.lng) * ftPerDegLng * scale;
                  const sy = SVG_H / 2 - (p.lat - geo.lat) * ftPerDegLat * scale;
                  return `${sx.toFixed(2)},${sy.toFixed(2)}`;
                }).join(' ');
                return (
                  <polygon key={i} points={pointsStr}
                    fill="rgba(34, 211, 238, 0.18)"
                    stroke="#22d3ee" strokeWidth="1.5"
                    strokeLinejoin="round" />
                );
              })}
            </g>
          );
        })()}
        <polygon points={pts(parcelScreen)}
          fill={viewMode === 'satellite' ? 'rgba(120, 200, 80, 0.12)' : 'url(#grass-pat)'}
          stroke={viewMode === 'satellite' ? '#ffde4d' : '#1a3a20'}
          strokeWidth={viewMode === 'satellite' ? 2 : 1.5} />

        {setbackRects.map((poly, i) => (
          <polygon key={i} points={pts(poly)}
            fill={viewMode === 'satellite' ? 'rgba(255, 255, 255, 0.08)' : 'url(#setback-pat)'}
            opacity={viewMode === 'satellite' ? 1 : 0.7} />
        ))}

        {polygonSetbackBandPath && (
          <path d={polygonSetbackBandPath} fillRule="evenodd"
            fill={viewMode === 'satellite' ? 'rgba(255, 255, 255, 0.08)' : 'url(#setback-pat)'}
            opacity={viewMode === 'satellite' ? 1 : 0.7} />
        )}

        {/* Auto setback line — dashed amber outline marking the buildable
            envelope (polygon inset for polygon parcels, bbox-minus-setbacks
            rectangle for non-polygon parcels). Distinct from the green
            setback band fill so the boundary reads even when the fill is
            obscured by buildings or trees. */}
        <polygon
          points={pts(polygonInsetScreen ?? buildCornersScreen)}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.6"
          strokeDasharray="6 4"
          style={{ pointerEvents: 'none' }}
        />
        <polygon
          points={pts(polygonInsetScreen ?? buildCornersScreen)}
          fill="none"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="0.7"
          strokeDasharray="6 4"
          strokeDashoffset="3"
          style={{ pointerEvents: 'none' }}
        />

        {sceneItems.map((item) => {
          if (item.type === 'tree') {
            return <Tree key={`t-${item.idx}`} xPx={item.tree.x} yPx={item.tree.y} r={item.tree.r}
              v={v} scale={scale} realistic={realistic} />;
          }
          const i = item.idx;
          const pl = placements[i];
          const prod = productMap[pl.productId];
          const pos = posFt[i] ?? { xFt: pl.xFt ?? 0, yFt: pl.yFt ?? 0 };
          return (
            <Building key={`b-${i}`} pl={pl}
              stories={prod?.stories ?? 1}
              units={prod?.units ?? 1}
              color={colorMap[pl.productId] ?? COLORS[0]}
              colorIdx={colorIdxMap[pl.productId] ?? 0}
              realistic={realistic}
              scale={scale}
              xPx={buildX + pos.xFt * scale}
              yPx={buildY + pos.yFt * scale}
              rotation={rotations[i] ?? 0}
              v={v}
              isDragging={activeIdx === i && activeMode === 'drag'}
              isRotating={activeIdx === i && activeMode === 'rotate'}
              isViolating={nonCompliant.has(i)}
              productName={prod?.name}
              onMouseDown={(e) => handleDragStart(e, i)}
              onRotateStart={(e) => handleRotateStart(e, i)} />
          );
        })}

        {(activeMode === 'drag' || activeMode === 'rotate') && activeIdx !== null && (() => {
          const pl  = placements[activeIdx];
          const pos = posFt[activeIdx];
          if (!pl || !pos) return null;

          const sw  = pl.widthFt * scale;
          const sh  = pl.depthFt * scale;
          const rot = rotations[activeIdx] ?? 0;
          const bcx = buildX + pos.xFt * scale + sw / 2;
          const bcy = buildY + pos.yFt * scale + sh / 2;
          const bb  = rotatedBBox(bcx, bcy, sw, sh, rot);

          const others = placements.map((plo, i) => {
            if (i === activeIdx) return null;
            const po  = posFt[i] ?? { xFt: 0, yFt: 0 };
            const swo = plo.widthFt * scale;
            const sho = plo.depthFt * scale;
            return rotatedBBox(
              buildX + po.xFt * scale + swo / 2,
              buildY + po.yFt * scale + sho / 2,
              swo, sho, rotations[i] ?? 0
            );
          }).filter(Boolean);

          // Cast a ray from the midpoint of each building-bbox side toward
          // the nearest parcel polygon edge. Falls back to the rectangular
          // buildable bbox when no polygon is available.
          const parcelPoly = _ringPlanForClamp
            ? _ringPlanForClamp.map(([x, y]) => ({ x, y }))
            : null;
          const midX = bb.x + bb.w / 2;
          const midY = bb.y + bb.h / 2;

          function nearest(side) {
            let edge;
            if (parcelPoly) {
              if (side === 'left') {
                const t = rayToPolygonDistance(bb.x, midY, -1, 0, parcelPoly);
                edge = Number.isFinite(t) ? bb.x - t : buildX;
              } else if (side === 'right') {
                const t = rayToPolygonDistance(bb.x + bb.w, midY, 1, 0, parcelPoly);
                edge = Number.isFinite(t) ? bb.x + bb.w + t : buildX + buildW;
              } else if (side === 'top') {
                const t = rayToPolygonDistance(midX, bb.y, 0, -1, parcelPoly);
                edge = Number.isFinite(t) ? bb.y - t : buildY;
              } else {
                const t = rayToPolygonDistance(midX, bb.y + bb.h, 0, 1, parcelPoly);
                edge = Number.isFinite(t) ? bb.y + bb.h + t : buildY + buildH;
              }
            } else {
              if (side === 'left')   edge = buildX;
              if (side === 'right')  edge = buildX + buildW;
              if (side === 'top')    edge = buildY;
              if (side === 'bottom') edge = buildY + buildH;
            }
            for (const o of others) {
              if (side === 'left' || side === 'right') {
                const vOverlap = Math.max(bb.y, o.y) < Math.min(bb.y + bb.h, o.y + o.h);
                if (!vOverlap) continue;
                if (side === 'left'  && o.x + o.w <= bb.x && o.x + o.w > edge) edge = o.x + o.w;
                if (side === 'right' && o.x >= bb.x + bb.w && o.x < edge)      edge = o.x;
              } else {
                const hOverlap = Math.max(bb.x, o.x) < Math.min(bb.x + bb.w, o.x + o.w);
                if (!hOverlap) continue;
                if (side === 'top'    && o.y + o.h <= bb.y && o.y + o.h > edge) edge = o.y + o.h;
                if (side === 'bottom' && o.y >= bb.y + bb.h && o.y < edge)      edge = o.y;
              }
            }
            return edge;
          }

          const obsLeft = nearest('left'),  obsRight  = nearest('right');
          const obsTop  = nearest('top'),   obsBottom = nearest('bottom');

          const gapLeft   = Math.max(0, Math.round((bb.x - obsLeft) / scale));
          const gapRight  = Math.max(0, Math.round((obsRight - bb.x - bb.w) / scale));
          const gapBack   = Math.max(0, Math.round((bb.y - obsTop) / scale));
          const gapFront  = Math.max(0, Math.round((obsBottom - bb.y - bb.h) / scale));

          const p = (px, py) => proj(px, py, 0, v);
          const topCenter   = { x: bb.x + bb.w / 2, y: bb.y };
          const botCenter   = { x: bb.x + bb.w / 2, y: bb.y + bb.h };
          const leftCenter  = { x: bb.x,            y: bb.y + bb.h / 2 };
          const rightCenter = { x: bb.x + bb.w,     y: bb.y + bb.h / 2 };
          const tTopEnd     = { x: bb.x + bb.w / 2, y: obsTop };
          const tBotEnd     = { x: bb.x + bb.w / 2, y: obsBottom };
          const tLeftEnd    = { x: obsLeft,         y: bb.y + bb.h / 2 };
          const tRightEnd   = { x: obsRight,        y: bb.y + bb.h / 2 };

          const Tick = ({ a, b }) => {
            const pa = p(a.x, a.y), pb = p(b.x, b.y);
            return <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              stroke="rgba(29,44,243,0.85)" strokeWidth="1" strokeDasharray="3 2" />;
          };
          const Pill = ({ planPt, text }) => {
            const pp = p(planPt.x, planPt.y);
            return (
              <g>
                <rect x={pp.x - 11} y={pp.y - 6} width="22" height="12" rx="3" fill="#1d2cf3" />
                <text x={pp.x} y={pp.y + 3} textAnchor="middle" fill="#ffffff" fontSize="7" fontWeight="700">
                  {text}
                </text>
              </g>
            );
          };

          const pillTop   = { x: (topCenter.x   + tTopEnd.x)   / 2, y: (topCenter.y   + tTopEnd.y)   / 2 };
          const pillBot   = { x: (botCenter.x   + tBotEnd.x)   / 2, y: (botCenter.y   + tBotEnd.y)   / 2 };
          const pillLeft  = { x: (leftCenter.x  + tLeftEnd.x)  / 2, y: (leftCenter.y  + tLeftEnd.y)  / 2 };
          const pillRight = { x: (rightCenter.x + tRightEnd.x) / 2, y: (rightCenter.y + tRightEnd.y) / 2 };

          return (
            <g style={{ pointerEvents: 'none' }}>
              <Tick a={topCenter}   b={tTopEnd} />
              <Tick a={botCenter}   b={tBotEnd} />
              <Tick a={leftCenter}  b={tLeftEnd} />
              <Tick a={rightCenter} b={tRightEnd} />
              {bb.y - obsTop > 6              && <Pill planPt={pillTop}   text={`${gapBack}'`}  />}
              {obsBottom - (bb.y + bb.h) > 6  && <Pill planPt={pillBot}   text={`${gapFront}'`} />}
              {bb.x - obsLeft > 6             && <Pill planPt={pillLeft}  text={`${gapLeft}'`}  />}
              {obsRight - (bb.x + bb.w) > 6   && <Pill planPt={pillRight} text={`${gapRight}'`} />}
            </g>
          );
        })()}

        {isLoading && (
          <>
            <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="rgba(15,23,42,0.72)" />
            <text x={midX} y={SVG_H / 2 - 8} textAnchor="middle" fill="#e2e8f0" fontSize="14">
              Generating layout…
            </text>
            <text x={midX} y={SVG_H / 2 + 12} textAnchor="middle" fill="#cbd5e1" fontSize="11">
              This may take a few seconds
            </text>
          </>
        )}

        {/* Compass: rotates to keep "N" pointing at world north */}
        <g transform={`translate(${compassX},${compassY})`}>
          <circle r="14" fill="rgba(15,23,42,0.72)" />
          <g transform={`rotate(${northAngleDeg + 90})`}>
            <line x1="0" y1="-10" x2="0" y2="8" stroke="#f1f5f9" strokeWidth="1.3" />
            <polygon points="0,-11 -3,-5 3,-5" fill="#ef4444" />
            <text x="0" y="-13" textAnchor="middle" fill="#f1f5f9" fontSize="8" fontWeight="700"
              transform={`rotate(${-(northAngleDeg + 90)})`}>N</text>
          </g>
        </g>

        {/* Orbit hint / view buttons (any 3D-projection mode) */}
        {!isFlatView && (
          <g transform={`translate(${LABEL_PAD - 4}, ${SVG_H - LABEL_PAD / 2 + 4})`} style={{ pointerEvents: 'all' }}>
            <g onClick={resetView} style={{ cursor: 'pointer' }}>
              <rect x="0" y="-11" width="58" height="18" rx="9" fill="rgba(15,23,42,0.8)" />
              <text x="29" y="2" textAnchor="middle" fill="#f1f5f9" fontSize="9" fontWeight="600">Reset view</text>
            </g>
            <g onClick={topDownView} transform="translate(66,0)" style={{ cursor: 'pointer' }}>
              <rect x="0" y="-11" width="62" height="18" rx="9" fill="rgba(15,23,42,0.8)" />
              <text x="31" y="2" textAnchor="middle" fill="#f1f5f9" fontSize="9" fontWeight="600">Top-down</text>
            </g>
            <text x="140" y="2" fill="rgba(15,23,42,0.55)" fontSize="9" fontStyle="italic">
              drag empty ground to orbit · yaw {Math.round(((yaw % 360) + 360) % 360)}° · pitch {Math.round(pitch)}°
            </text>
          </g>
        )}

        {viewMode === 'satellite' && satelliteUrl && (
          <text x={SVG_W - 6} y={SVG_H - 5} textAnchor="end" fontSize="7.5"
            fill="rgba(255,255,255,0.9)"
            style={{ pointerEvents: 'none', textShadow: '0 0 2px rgba(0,0,0,0.95)' }}>
            Imagery © Esri · Geocoding © OpenStreetMap
          </text>
        )}

        {/* Parcel rotate handle — satellite alignment */}
        {viewMode === 'satellite' && geo && (() => {
          const handleOffsetFt = Math.max(18, parcel.depth * 0.1);
          const handlePos   = proj(pW / 2, -handleOffsetFt * scale, 0, v);
          const parcelTopMid = proj(pW / 2, 0, 0, v);
          const active = activeMode === 'rotate-parcel';
          return (
            <g onPointerDown={handleParcelRotateStart}
              style={{ cursor: 'grab', touchAction: 'none' }}>
              {/* Enlarged hit target for touch */}
              <circle cx={handlePos.x} cy={handlePos.y} r="22" fill="transparent" />
              <line x1={parcelTopMid.x} y1={parcelTopMid.y} x2={handlePos.x} y2={handlePos.y}
                stroke="#ffde4d" strokeWidth="1.5" strokeDasharray="3 3" />
              <circle cx={handlePos.x} cy={handlePos.y} r="11"
                fill={active ? '#1d2cf3' : '#ffde4d'}
                stroke="#0f172a" strokeWidth="1.6" />
              <text x={handlePos.x} y={handlePos.y + 4} textAnchor="middle"
                fontSize="13" fontWeight="700"
                fill={active ? '#ffffff' : '#0f172a'}
                style={{ pointerEvents: 'none' }}>↻</text>
            </g>
          );
        })()}
      </svg>}

      {hasViolation && (
        <div className="birds-eye-warning">
          <span className="bev-warn-icon">⚠</span>
          <div>
            <strong>Layout not compliant</strong>
            <span>{nonCompliant.size} building{nonCompliant.size > 1 ? 's' : ''} violate the minimum spacing requirements set in Configure Layout.</span>
          </div>
        </div>
      )}

      <div className="birds-eye-legend">
        {legendItems.map(({ id, color, name }) => (
          <div key={id} className="bel-item">
            <span className="bel-swatch" style={{ background: color.roof, borderColor: color.stroke }} />
            {name}
          </div>
        ))}
        <div className="bel-item">
          <span className="bel-swatch" style={{ background: '#4a9a55', borderColor: '#2d6a38' }} />
          Setbacks
        </div>
      </div>

      <div className="birds-eye-stats">
        <div className="be-stat"><span>Buildings placed</span><strong>{placements.length}</strong></div>
        <div className="be-stat"><span>Total units</span><strong>{totalUnits}</strong></div>
        <div className="be-stat"><span>Lot coverage</span><strong>{coveragePct}%</strong></div>
        <div className="be-stat">
          <span>Layout</span>
          <strong className={`source-badge ${aiSource === 'ai' ? 'source-ai' : 'source-grid'}`}>
            {aiSource === 'ai' ? '✦ AI generated' : 'Grid estimate'}
          </strong>
        </div>
        {aiNotes && (
          <div className="be-notes"><span>Notes</span><span>{aiNotes}</span></div>
        )}
      </div>
    </div>
  );
}
