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

export default function ProductDetail({ product: p, parcel, setbacks, apiKey, mapboxToken, onBack, onEmailOverview, onReset }) {
  const [layout, setLayout]             = useState(null);
  const [layoutLoading, setLayoutLoading] = useState(true);

  useEffect(() => {
    setLayoutLoading(true);
    setLayout(null);
    generateLayout({ parcel, products: [p], setbacks, apiKey })
      .then(setLayout)
      .finally(() => setLayoutLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, parcel.sqft, setbacks.front, setbacks.rear, setbacks.side, apiKey]);

  const placedCount = layout?.placements?.length ?? 0;
  const unmet       = !layoutLoading && p.requestedCount && placedCount < p.requestedCount;
  const price       = parseMoney(p.priceRange);
  const totalMin    = price && !layoutLoading ? fmtMoney(price.min * placedCount) : null;
  const totalMax    = price && !layoutLoading ? fmtMoney(price.max * placedCount) : null;
  const totalPrice  = totalMin && totalMax
    ? (totalMin === totalMax ? totalMin : `${totalMin} – ${totalMax}`)
    : null;

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

      {/* ── Selected product table ── */}
      <div className="detail-specs">
        <h3 className="detail-section-label">Selected Product</h3>
        <div className="multi-product-table">
          <div className="mpt-header">
            <span />
            <span>Product</span>
            <span>Footprint</span>
            <span>Buildings</span>
            <span>Units</span>
            <span>Price</span>
          </div>
          <div className="mpt-row">
            {p.image
              ? <img src={p.image} alt={p.name} className="admin-thumb" onError={(e) => { e.target.style.display = 'none'; }} />
              : <span />
            }
            <div className="mpt-name">
              <strong>{p.name}</strong>
              <span className="admin-type-tag">{p.type}</span>
            </div>
            <span className="mpt-cell">{p.footprintW}′×{p.footprintD}′</span>
            <span className="mpt-cell">{layoutLoading ? '…' : placedCount}</span>
            <span className="mpt-cell mpt-accent">{layoutLoading ? '…' : placedCount * p.units}</span>
            <span className="mpt-cell">{p.priceRange ? `${p.priceRange} (each)` : '—'}</span>
          </div>
          <div className="mpt-total">
            <span />
            <span className="mpt-total-label">Total</span>
            <span />
            <span className="mpt-cell mpt-total-val">{layoutLoading ? '…' : placedCount}</span>
            <span className="mpt-cell mpt-accent mpt-total-val">{layoutLoading ? '…' : placedCount * p.units}</span>
            <span className="mpt-cell mpt-total-val">{layoutLoading ? '…' : (totalPrice ? `${totalPrice} (total)` : '—')}</span>
          </div>
        </div>
      </div>

      {/* ── Satellite view ── */}
      <SatelliteView parcel={parcel} mapboxToken={mapboxToken} />

      {/* ── Birds-eye view ── */}
      <div className="detail-bev">
        <h3 className="detail-section-label">Site Layout</h3>
        <p className="detail-bev-note">
          Illustrative layout based on parcel bounding box and estimated footprints.
          Actual placement subject to site conditions and local zoning.
          {!apiKey && ' Add a Claude API key in AI Settings for AI-optimised placement.'}
        </p>
        <BirdsEyeSVG
          parcel={parcel}
          setbacks={setbacks}
          placements={layout?.placements ?? []}
          products={[p]}
          isLoading={layoutLoading}
          aiNotes={layout?.notes}
          aiSource={layout?.source}
        />
        {layout?.aiError && (
          <p className="layout-error">AI layout unavailable — showing grid estimate. ({layout.aiError})</p>
        )}
        {unmet && (
          <div className="unmet-warning">
            <strong>Quantity couldn't be met:</strong>
            <ul>
              <li>
                {p.name} — requested {p.requestedCount},{' '}
                only {placedCount} fit on this parcel with current setbacks.
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
