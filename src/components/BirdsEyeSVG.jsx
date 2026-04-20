import { useState, useRef, useEffect } from 'react';

const SVG_W = 720;
const SVG_H = 420;
const LABEL_PAD = 56;

const COLORS = [
  { fill: 'rgba(56,189,248,0.5)',  stroke: '#38bdf8', text: '#0ea5e9', roof: '#bfe8fa' },
  { fill: 'rgba(52,211,153,0.5)',  stroke: '#34d399', text: '#10b981', roof: '#bbf7d0' },
  { fill: 'rgba(251,191,36,0.5)',  stroke: '#fbbf24', text: '#d97706', roof: '#fef08a' },
  { fill: 'rgba(248,113,113,0.5)', stroke: '#f87171', text: '#ef4444', roof: '#fecaca' },
  { fill: 'rgba(167,139,250,0.5)', stroke: '#a78bfa', text: '#8b5cf6', roof: '#e9d5ff' },
  { fill: 'rgba(251,146,60,0.5)',  stroke: '#fb923c', text: '#ea580c', roof: '#fed7aa' },
];

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function Trees({ ox, oy, pW, pH, sbFront, sbRear, sbSide, scale, count = 14 }) {
  const rng = seededRng(42);
  const trees = [];
  const margin = 6;
  for (let i = 0; i < count * 4 && trees.length < count; i++) {
    const r = rng();
    const zone = Math.floor(r * 4);
    let x, y;
    if (zone === 0) { x = ox + rng() * pW; y = oy + rng() * sbRear; }
    else if (zone === 1) { x = ox + rng() * pW; y = oy + pH - rng() * sbFront; }
    else if (zone === 2) { x = ox + rng() * sbSide; y = oy + sbRear + rng() * (pH - sbFront - sbRear); }
    else { x = ox + pW - rng() * sbSide; y = oy + sbRear + rng() * (pH - sbFront - sbRear); }
    if (x > ox + margin && x < ox + pW - margin && y > oy + margin && y < oy + pH - margin) {
      trees.push({ x, y, r: 4 + rng() * 4 });
    }
  }
  return (
    <g>
      {trees.map((t, i) => (
        <g key={i}>
          <circle cx={t.x + 1.5} cy={t.y + 1.5} r={t.r} fill="rgba(0,0,0,0.18)" />
          <circle cx={t.x} cy={t.y} r={t.r} fill="#2d6a4f" />
          <circle cx={t.x - t.r * 0.25} cy={t.y - t.r * 0.25} r={t.r * 0.55} fill="#40916c" />
        </g>
      ))}
    </g>
  );
}

function Building({ pl, color, scale, buildX, buildY, xPx, yPx, rotation, isDragging, isRotating, onMouseDown, onRotateStart }) {
  const sx = buildX + xPx;
  const sy = buildY + yPx;
  const sw = pl.widthFt * scale;
  const sh = pl.depthFt * scale;
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;

  const eave = Math.min(sw, sh) * 0.22;
  const rx1 = sx + eave, rx2 = sx + sw - eave;
  const ry1 = sy + eave, ry2 = sy + sh - eave;
  const seamCount = Math.max(1, Math.floor((rx2 - rx1) / 9));
  const seamStep  = (rx2 - rx1) / (seamCount + 1);

  const isActive = isDragging || isRotating;

  return (
    <g transform={`rotate(${rotation}, ${cx}, ${cy})`}>
      {/* Building body — drag handle */}
      <g onMouseDown={onMouseDown} style={{ cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none' }}>
        {/* Drop shadow */}
        <rect x={sx + 5} y={sy + 5} width={sw} height={sh} fill="rgba(0,0,0,0.35)" rx="1" />

        {/* North slope */}
        <polygon points={`${sx},${sy} ${sx+sw},${sy} ${rx2},${ry1} ${rx1},${ry1}`} fill="#9ab0b8" />
        {/* South slope */}
        <polygon points={`${sx},${sy+sh} ${sx+sw},${sy+sh} ${rx2},${ry2} ${rx1},${ry2}`} fill="#4e6470" />
        {/* West slope */}
        <polygon points={`${sx},${sy} ${sx},${sy+sh} ${rx1},${ry2} ${rx1},${ry1}`} fill="#6a8088" />
        {/* East slope */}
        <polygon points={`${sx+sw},${sy} ${sx+sw},${sy+sh} ${rx2},${ry2} ${rx2},${ry1}`} fill="#6a8088" />

        {/* Flat ridge top */}
        <rect x={rx1} y={ry1} width={rx2-rx1} height={ry2-ry1} fill="#7d9aa3" />

        {/* Standing seams */}
        {Array.from({ length: seamCount }).map((_, i) => (
          <line key={i}
            x1={rx1 + seamStep * (i+1)} y1={ry1}
            x2={rx1 + seamStep * (i+1)} y2={ry2}
            stroke="rgba(0,0,0,0.18)" strokeWidth="0.7" />
        ))}

        {/* Ridge highlight */}
        <line x1={rx1} y1={ry1} x2={rx2} y2={ry1} stroke="rgba(255,255,255,0.4)" strokeWidth="1" />

        {/* Hip corner lines */}
        <line x1={sx}    y1={sy}    x2={rx1} y2={ry1} stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
        <line x1={sx+sw} y1={sy}    x2={rx2} y2={ry1} stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
        <line x1={sx}    y1={sy+sh} x2={rx1} y2={ry2} stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
        <line x1={sx+sw} y1={sy+sh} x2={rx2} y2={ry2} stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />

        {/* Colour border */}
        <rect x={sx} y={sy} width={sw} height={sh}
          fill="none" stroke={color.stroke} strokeWidth={isActive ? 2.5 : 1.8} rx="1" />

        {/* Active ring */}
        {isActive && (
          <rect x={sx-3} y={sy-3} width={sw+6} height={sh+6}
            fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeDasharray="5 3" rx="2" />
        )}

        {/* HVAC */}
        {sw > 44 && sh > 28 && (
          <rect x={rx1+(rx2-rx1)*0.6} y={ry1+(ry2-ry1)*0.15}
            width={Math.min(10,sw*0.12)} height={Math.min(7,sh*0.12)}
            fill="#3a4a50" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" rx="1" />
        )}

        {/* Label */}
        {sw > 30 && sh > 20 && (
          <text x={cx} y={cy + 4} textAnchor="middle"
            fill="#ffffff" fontSize="8" fontWeight="700"
            style={{ textShadow: '0 0 4px rgba(0,0,0,0.9)', pointerEvents: 'none' }}>
            {pl.widthFt}′×{pl.depthFt}′
          </text>
        )}
      </g>

      {/* Rotate handle — stem + circle above north edge */}
      <g onMouseDown={onRotateStart} style={{ cursor: 'crosshair', userSelect: 'none' }}>
        <line x1={cx} y1={sy} x2={cx} y2={sy - 16}
          stroke={isRotating ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.55)'} strokeWidth="1.2" />
        <circle cx={cx} cy={sy - 16} r={isRotating ? 6 : 5}
          fill={isRotating ? '#fbbf24' : 'rgba(255,255,255,0.85)'}
          stroke={isRotating ? '#d97706' : '#64748b'} strokeWidth="1" />
        {/* ↻ symbol */}
        <text x={cx} y={sy - 12} textAnchor="middle"
          fill={isRotating ? '#92400e' : '#334155'} fontSize="7" fontWeight="700"
          style={{ pointerEvents: 'none' }}>
          ↻
        </text>
      </g>

      {/* Rotation angle badge — shown while rotating */}
      {isRotating && (
        <g>
          <rect x={cx - 16} y={sy - 36} width={32} height={14} rx="3"
            fill="rgba(251,191,36,0.92)" />
          <text x={cx} y={sy - 25} textAnchor="middle"
            fill="#78350f" fontSize="8" fontWeight="700" style={{ pointerEvents: 'none' }}>
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

// Clamp top-left pixel offset so the rotated AABB stays within the buildable area
function clampRotated(xPx, yPx, sw, sh, angleDeg, areaW, areaH) {
  const rad = angleDeg * Math.PI / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const hw = (sw * c + sh * s) / 2; // half AABB width
  const hh = (sw * s + sh * c) / 2; // half AABB height
  return {
    xPx: Math.max(hw - sw / 2, Math.min(areaW - sw / 2 - hw, xPx)),
    yPx: Math.max(hh - sh / 2, Math.min(areaH - sh / 2 - hh, yPx)),
  };
}


export default function BirdsEyeSVG({ parcel, setbacks, placements = [], products = [], isLoading, aiNotes, aiSource }) {
  const availW = SVG_W - LABEL_PAD * 2;
  const availH = SVG_H - LABEL_PAD * 2;
  const scale  = Math.min(availW / parcel.frontage, availH / parcel.depth);

  const pW = parcel.frontage * scale;
  const pH = parcel.depth * scale;
  const ox = (SVG_W - pW) / 2;
  const oy = LABEL_PAD;

  const sbFront = setbacks.front * scale;
  const sbRear  = setbacks.rear  * scale;
  const sbSide  = setbacks.side  * scale;

  const buildX = ox + sbSide;
  const buildY = oy + sbRear;
  const buildW = pW - sbSide * 2;
  const buildH = pH - sbFront - sbRear;
  const midX   = SVG_W / 2;

  const productMap  = Object.fromEntries(products.map((p) => [p.id, p]));
  const uniqueIds   = [...new Set(placements.map((p) => p.productId))];
  const colorMap    = Object.fromEntries(uniqueIds.map((id, i) => [id, COLORS[i % COLORS.length]]));
  const legendItems = uniqueIds.map((id) => ({ id, color: colorMap[id], name: productMap[id]?.name ?? id }));

  // ── Position + rotation state ────────────────────────────────────
  const [posFt,     setPosFt]     = useState(() => placements.map((pl) => ({ xFt: pl.xFt ?? 0, yFt: pl.yFt ?? 0 })));
  const [rotations, setRotations] = useState(() => placements.map(() => 0));
  const [activeIdx, setActiveIdx] = useState(null);
  const [activeMode, setActiveMode] = useState(null); // 'drag' | 'rotate'

  const dragRef = useRef(null);
  const svgRef  = useRef(null);

  useEffect(() => {
    setPosFt(placements.map((pl) => ({ xFt: pl.xFt ?? 0, yFt: pl.yFt ?? 0 })));
    setRotations(placements.map(() => 0));
  }, [placements]);

  function handleDragStart(e, idx) {
    e.preventDefault();
    const pt  = getSvgPoint(e, svgRef.current);
    const pos = posFt[idx];
    dragRef.current = {
      mode: 'drag', idx,
      offsetX: pt.x - (buildX + pos.xFt * scale),
      offsetY: pt.y - (buildY + pos.yFt * scale),
    };
    setActiveIdx(idx);
    setActiveMode('drag');
  }

  function handleRotateStart(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    const pos = posFt[idx];
    const pl  = placements[idx];
    const sw  = pl.widthFt * scale;
    const sh  = pl.depthFt * scale;
    const cx  = buildX + pos.xFt * scale + sw / 2;
    const cy  = buildY + pos.yFt * scale + sh / 2;
    dragRef.current = { mode: 'rotate', idx, cx, cy };
    setActiveIdx(idx);
    setActiveMode('rotate');
  }

  function handleMouseMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const pt = getSvgPoint(e, svgRef.current);

    if (d.mode === 'drag') {
      const pl  = placements[d.idx];
      const sw  = pl.widthFt * scale;
      const sh  = pl.depthFt * scale;
      const rot = rotations[d.idx] ?? 0;
      const { xPx: nx, yPx: ny } = clampRotated(
        pt.x - buildX - d.offsetX, pt.y - buildY - d.offsetY,
        sw, sh, rot, buildW, buildH
      );
      setPosFt((prev) => {
        const next = [...prev];
        next[d.idx] = { xFt: nx / scale, yFt: ny / scale };
        return next;
      });
    } else if (d.mode === 'rotate') {
      const angle = Math.atan2(pt.y - d.cy, pt.x - d.cx) * (180 / Math.PI) + 90;
      const pl  = placements[d.idx];
      const sw  = pl.widthFt * scale;
      const sh  = pl.depthFt * scale;
      setRotations((prev) => {
        const next = [...prev];
        next[d.idx] = angle;
        return next;
      });
      // Re-clamp position with the new rotation so the building stays inside
      setPosFt((prev) => {
        const pos = prev[d.idx];
        if (!pos) return prev;
        const { xPx: nx, yPx: ny } = clampRotated(
          pos.xFt * scale, pos.yFt * scale, sw, sh, angle, buildW, buildH
        );
        if (Math.abs(nx - pos.xFt * scale) < 0.01 && Math.abs(ny - pos.yFt * scale) < 0.01) return prev;
        const next = [...prev];
        next[d.idx] = { xFt: nx / scale, yFt: ny / scale };
        return next;
      });
    }
  }

  function handleMouseUp() {
    dragRef.current = null;
    setActiveMode(null);
  }


  const covered     = placements.reduce((s, pl) => s + pl.widthFt * pl.depthFt, 0);
  const coveragePct = ((covered / parcel.sqft) * 100).toFixed(1);
  const totalUnits  = placements.reduce((s, p) => s + (productMap[p.productId]?.units ?? 1), 0);

  return (
    <div className="birds-eye-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="birds-eye-svg"
        aria-label="Birds-eye parcel layout"
        style={{ cursor: activeMode === 'drag' ? 'grabbing' : activeMode === 'rotate' ? 'crosshair' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <pattern id="grass-pat" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="#3a7d44" />
            <circle cx="2" cy="3" r="0.8" fill="#2d6a38" opacity="0.5" />
            <circle cx="7" cy="7" r="0.8" fill="#2d6a38" opacity="0.5" />
            <circle cx="5" cy="1" r="0.5" fill="#4a9458" opacity="0.4" />
          </pattern>
          <pattern id="setback-pat" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="#4a9a55" />
            <circle cx="3" cy="4" r="0.7" fill="#3a8045" opacity="0.4" />
            <circle cx="8" cy="8" r="0.7" fill="#3a8045" opacity="0.4" />
          </pattern>
          <pattern id="pave-pat" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <rect width="20" height="20" fill="#c8bfae" />
            <rect x="0" y="0" width="10" height="10" fill="rgba(0,0,0,0.03)" />
            <rect x="10" y="10" width="10" height="10" fill="rgba(0,0,0,0.03)" />
          </pattern>
        </defs>

        {/* ── Surroundings ── */}
        <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="url(#pave-pat)" />

        {/* ── Parcel ── */}
        <rect x={ox} y={oy} width={pW} height={pH} fill="url(#grass-pat)" />
        <rect x={ox} y={oy} width={pW} height={pH} fill="none" stroke="#1a3a20" strokeWidth="1.5" />

        {/* ── Setback zones ── */}
        <rect x={ox} y={oy} width={pW} height={sbRear} fill="url(#setback-pat)" opacity="0.7" />
        <rect x={ox} y={oy+pH-sbFront} width={pW} height={sbFront} fill="url(#setback-pat)" opacity="0.7" />
        <rect x={ox} y={oy+sbRear} width={sbSide} height={pH-sbFront-sbRear} fill="url(#setback-pat)" opacity="0.7" />
        <rect x={ox+pW-sbSide} y={oy+sbRear} width={sbSide} height={pH-sbFront-sbRear} fill="url(#setback-pat)" opacity="0.7" />
        <rect x={buildX} y={buildY} width={buildW} height={buildH}
          fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" strokeDasharray="5 3" />

        {/* ── Trees ── */}
        <Trees ox={ox} oy={oy} pW={pW} pH={pH}
          sbFront={sbFront} sbRear={sbRear} sbSide={sbSide} scale={scale} />

        {/* ── Buildings ── */}
        {placements.map((pl, i) => {
          const pos = posFt[i] ?? { xFt: pl.xFt ?? 0, yFt: pl.yFt ?? 0 };
          return (
            <Building key={i} pl={pl} color={colorMap[pl.productId] ?? COLORS[0]}
              scale={scale} buildX={buildX} buildY={buildY}
              xPx={pos.xFt * scale} yPx={pos.yFt * scale}
              rotation={rotations[i] ?? 0}
              isDragging={activeIdx === i && activeMode === 'drag'}
              isRotating={activeIdx === i && activeMode === 'rotate'}
              onMouseDown={(e) => handleDragStart(e, i)}
              onRotateStart={(e) => handleRotateStart(e, i)} />
          );
        })}

        {/* ── Loading overlay ── */}
        {isLoading && (
          <>
            <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="rgba(15,23,42,0.72)" />
            <text x={midX} y={SVG_H/2-8} textAnchor="middle" fill="#475569" fontSize="14">
              Generating layout…
            </text>
            <text x={midX} y={SVG_H/2+12} textAnchor="middle" fill="#334155" fontSize="11">
              This may take a few seconds
            </text>
          </>
        )}

        {/* ── Compass ── */}
        <g>
          <circle cx={ox+pW-16} cy={oy+16} r="12" fill="rgba(0,0,0,0.35)" />
          <text x={ox+pW-16} y={oy+20} textAnchor="middle" fill="#f1f5f9" fontSize="11" fontWeight="700">N</text>
          <line x1={ox+pW-16} y1={oy+8} x2={ox+pW-16} y2={oy+14} stroke="#f1f5f9" strokeWidth="1.5" />
        </g>

        {/* ── Frontage dimension ── */}
        <line x1={ox} y1={oy-18} x2={ox+pW} y2={oy-18} stroke="#334155" strokeWidth="1" />
        <line x1={ox} y1={oy-22} x2={ox} y2={oy-14} stroke="#334155" strokeWidth="1" />
        <line x1={ox+pW} y1={oy-22} x2={ox+pW} y2={oy-14} stroke="#334155" strokeWidth="1" />
        <text x={midX} y={oy-22} textAnchor="middle" fill="#475569" fontSize="11">{parcel.frontage} ft</text>

        {/* ── Depth dimension ── */}
        <line x1={ox-20} y1={oy} x2={ox-20} y2={oy+pH} stroke="#334155" strokeWidth="1" />
        <line x1={ox-24} y1={oy} x2={ox-16} y2={oy} stroke="#334155" strokeWidth="1" />
        <line x1={ox-24} y1={oy+pH} x2={ox-16} y2={oy+pH} stroke="#334155" strokeWidth="1" />
        <text x={ox-32} y={oy+pH/2} textAnchor="middle" fill="#475569" fontSize="11"
          transform={`rotate(-90, ${ox-32}, ${oy+pH/2})`}>
          {parcel.depth} ft
        </text>
      </svg>

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
