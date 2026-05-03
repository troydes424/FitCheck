import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

// Raw-materials cost breakdown for a modular build. Each category is a
// share of the total project cost (sums to 1.00). `trendPct` is the
// month-over-month price change for that material (in %), used to render
// a green-up or red-down arrow next to the row. In a real app these would
// come from a market-data feed; for now they're realistic 2025 estimates.
const MATERIAL_BREAKDOWN = [
  { label: 'Lumber & framing',         percent: 0.18, trendPct: -2.1 },
  { label: 'Concrete & foundation',    percent: 0.08, trendPct:  1.5 },
  { label: 'Roofing & siding',         percent: 0.10, trendPct:  0.8 },
  { label: 'Insulation & drywall',     percent: 0.07, trendPct: -0.3 },
  { label: 'Windows & doors',          percent: 0.07, trendPct:  2.7 },
  { label: 'Plumbing fixtures',        percent: 0.05, trendPct:  1.1 },
  { label: 'Electrical & HVAC',        percent: 0.09, trendPct:  3.5 },
  { label: 'Flooring',                 percent: 0.05, trendPct: -0.5 },
  { label: 'Cabinets & countertops',   percent: 0.06, trendPct:  0.0 },
  { label: 'Paint, trim & hardware',   percent: 0.05, trendPct:  1.8 },
  { label: 'Labor & delivery',         percent: 0.15, trendPct:  4.2 },
  { label: 'Permits & contingency',    percent: 0.05, trendPct:  0.0 },
];

function fmtCompactMoney(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

function TrendArrow({ pct }) {
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.1) {
    return <span className="pbd-trend pbd-trend-flat" title="No notable change MoM">—</span>;
  }
  if (pct > 0) {
    return (
      <span className="pbd-trend pbd-trend-up" title={`+${pct.toFixed(1)}% month over month`}>
        ▲ {pct.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="pbd-trend pbd-trend-down" title={`${pct.toFixed(1)}% month over month`}>
      ▼ {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// Click-to-open popover. Renders via a portal into document.body so it
// can't be clipped by ancestor `overflow:hidden` or trapped behind a
// sibling stacking context. Position is computed from the trigger's
// bounding rect on every open + scroll + resize.
export default function PriceBreakdown({ totalMin, totalMax, suffix = '(total)' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState(null); // { top, right } in viewport pixels
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    updatePos();
    const onMouseDown = (e) => {
      const insideTrigger = triggerRef.current?.contains(e.target);
      const insidePopover = popoverRef.current?.contains(e.target);
      if (!insideTrigger && !insidePopover) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open]);

  if (!Number.isFinite(totalMin) || !Number.isFinite(totalMax)) {
    return <span className="mpt-cell mpt-total-val">—</span>;
  }

  const summary = totalMin === totalMax
    ? `${fmtCompactMoney(totalMin)} ${suffix}`
    : `${fmtCompactMoney(totalMin)} – ${fmtCompactMoney(totalMax)} ${suffix}`;
  const totalRange = totalMin === totalMax
    ? fmtCompactMoney(totalMin)
    : `${fmtCompactMoney(totalMin)} – ${fmtCompactMoney(totalMax)}`;

  const rows = MATERIAL_BREAKDOWN.map((row) => ({
    ...row,
    min: totalMin * row.percent,
    max: totalMax * row.percent,
  }));

  const popover = open && pos ? createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Cost breakdown"
      className="price-breakdown-popover"
      style={{ top: pos.top, right: pos.right }}
    >
      <div className="price-breakdown-header">
        <strong>Cost breakdown</strong>
        <button
          type="button"
          className="price-breakdown-close"
          onClick={() => setOpen(false)}
          aria-label="Close cost breakdown"
        >×</button>
      </div>
      <div className="price-breakdown-body">
        {rows.map((r) => (
          <div key={r.label} className="price-breakdown-row">
            <span className="pbd-label">{r.label}</span>
            <TrendArrow pct={r.trendPct} />
            <span className="pbd-percent">{Math.round(r.percent * 100)}%</span>
            <span className="pbd-amount">
              {fmtCompactMoney(r.min)}
              {r.min !== r.max ? ` – ${fmtCompactMoney(r.max)}` : ''}
            </span>
          </div>
        ))}
        <div className="price-breakdown-row pbd-total">
          <span className="pbd-label">Total</span>
          <span />
          <span className="pbd-percent">100%</span>
          <span className="pbd-amount">{totalRange}</span>
        </div>
        <p className="pbd-note">
          Arrows show month-over-month material-price change. Estimates only —
          actual costs vary by site, market, and finishes.
        </p>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <span className="price-breakdown-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="price-breakdown-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <strong>{summary}</strong>
        <span className="pbd-chev" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {popover}
    </span>
  );
}
