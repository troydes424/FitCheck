import { useState, useEffect } from 'react';
import BirdsEyeSVG from './BirdsEyeSVG';
import { generateLayout } from '../utils/generateLayout';

function parseMoney(str) {
  if (!str) return null;
  const hits = [...str.matchAll(/\$?([\d.]+)\s*(K|M)?/gi)];
  const toNum = (m) => parseFloat(m[1]) * (m[2]?.toUpperCase() === 'M' ? 1e6 : m[2]?.toUpperCase() === 'K' ? 1e3 : 1);
  const vals = hits.map(toNum).filter((n) => !isNaN(n));
  return vals.length >= 2 ? { min: vals[0], max: vals[1] } : vals.length === 1 ? { min: vals[0], max: vals[0] } : null;
}

function fmtMoney(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n.toLocaleString()}`;
}

function SatelliteView({ parcel, mapboxToken }) {
  if (!mapboxToken?.trim() || !parcel.centerLat || !parcel.centerLon) return null;
  const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${parcel.centerLon},${parcel.centerLat},18/720x380?access_token=${mapboxToken}`;
  return (
    <div className="detail-bev">
      <h3 className="detail-section-label">Satellite View</h3>
      <img
        src={url}
        alt="Satellite view of parcel"
        className="satellite-img"
        onError={(e) => { e.target.parentElement.style.display = 'none'; }}
      />
    </div>
  );
}

export default function MultiLayoutView({ products, parcel, setbacks, apiKey, mapboxToken, notes, onBack, onEmailOverview, onReset }) {
  const [layout, setLayout]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    generateLayout({ parcel, products, setbacks, apiKey, notes })
      .then(setLayout)
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placements = layout?.placements ?? [];
  const countById  = placements.reduce((acc, pl) => {
    acc[pl.productId] = (acc[pl.productId] ?? 0) + 1;
    return acc;
  }, {});

  const unmet = !loading
    ? products.filter((p) => p.requestedCount && (countById[p.id] ?? 0) < p.requestedCount)
    : [];

  return (
    <div className="product-detail">
      {/* ── Nav row ── */}
      <div className="detail-nav">
        <button className="detail-back" onClick={onBack}>← Back to results</button>
        <div className="detail-nav-right">
          {onReset && (
            <button className="reset-btn" onClick={onReset}>↺ Clear &amp; Restart</button>
          )}
          {onEmailOverview && (
            <button className="email-overview-btn email-overview-lg" onClick={onEmailOverview}>
              ✉ Email Overview
            </button>
          )}
        </div>
      </div>

      {/* ── Selected products table ── */}
      <div className="detail-specs">
        <h3 className="detail-section-label">Selected Products</h3>
        <div className="multi-product-table">
          <div className="mpt-header">
            <span />
            <span>Product</span>
            <span>Footprint</span>
            <span>Buildings</span>
            <span>Units</span>
            <span>Price</span>
          </div>
          {products.map((p) => {
            const count = countById[p.id] ?? 0;
            return (
              <div key={p.id} className="mpt-row">
                {p.image
                  ? <img src={p.image} alt={p.name} className="admin-thumb" onError={(e) => { e.target.style.display = 'none'; }} />
                  : <span />
                }
                <div className="mpt-name">
                  <strong>{p.name}</strong>
                  <span className="admin-type-tag">{p.type}</span>
                </div>
                <span className="mpt-cell">{p.footprintW}′×{p.footprintD}′</span>
                <span className="mpt-cell">{loading ? '…' : count}</span>
                <span className="mpt-cell mpt-accent">{loading ? '…' : count * p.units}</span>
                <span className="mpt-cell">{p.priceRange ? `${p.priceRange} (each)` : '—'}</span>
              </div>
            );
          })}
          <div className="mpt-total">
            <span />
            <span className="mpt-total-label">Total</span>
            <span />
            <span className="mpt-cell mpt-total-val">
              {loading ? '…' : Object.values(countById).reduce((s, n) => s + n, 0)}
            </span>
            <span className="mpt-cell mpt-accent mpt-total-val">
              {loading ? '…' : products.reduce((s, p) => s + (countById[p.id] ?? 0) * p.units, 0)}
            </span>
            <span className="mpt-cell mpt-total-val">
              {loading ? '…' : (() => {
                let totalMin = 0, totalMax = 0, hasPrice = false;
                products.forEach((p) => {
                  const count = countById[p.id] ?? 0;
                  const price = parseMoney(p.priceRange);
                  if (price && count > 0) { totalMin += price.min * count; totalMax += price.max * count; hasPrice = true; }
                });
                if (!hasPrice) return '—';
                const val = totalMin === totalMax ? fmtMoney(totalMin) : `${fmtMoney(totalMin)} – ${fmtMoney(totalMax)}`;
                return `${val} (total)`;
              })()}
            </span>
          </div>
        </div>
      </div>

      {/* ── Satellite view ── */}
      <SatelliteView parcel={parcel} mapboxToken={mapboxToken} />

      {/* ── Birds-eye view ── */}
      <div className="detail-bev">
        <h3 className="detail-section-label">Site Layout</h3>
        <BirdsEyeSVG
          parcel={parcel}
          setbacks={setbacks}
          placements={placements}
          products={products}
          isLoading={loading}
          aiNotes={layout?.notes}
          aiSource={layout?.source}
        />
        {layout?.aiError && (
          <p className="layout-error">AI layout unavailable — showing grid estimate. ({layout.aiError})</p>
        )}
        {unmet.length > 0 && (
          <div className="unmet-warning">
            <strong>Some quantities couldn't fit:</strong>
            <ul>
              {unmet.map((p) => (
                <li key={p.id}>
                  {p.name} — requested {p.requestedCount}, only{' '}
                  {countById[p.id] ?? 0} fit on this parcel with current setbacks.
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
