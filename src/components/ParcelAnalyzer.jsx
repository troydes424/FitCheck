import { useState, useEffect } from 'react';
import ProductDetail from './ProductDetail';
import MultiLayoutView from './MultiLayoutView';
import { lookupParcelByAddress, hasRegridToken } from '../utils/regrid';

const VOLUMOD_PRODUCTS = [
  {
    id: 'juniper',
    name: 'Juniper Duplex',
    type: 'Duplex',
    units: 2,
    stories: 1,
    footprintW: 28,
    footprintD: 44,
    footprintSqFt: 1232,
    bedBath: '2 bed / 1 bath per unit',
    description: 'Single-story duplex designed for narrow infill city lots.',
    image: 'https://static.wixstatic.com/media/9b04fd_3cb78230e6644c86ad161b812c465f3b~mv2.jpg',
    priceRange: '$250K – $350K',
    completionTime: '4 – 6 months',
  },
  {
    id: 'ivy',
    name: 'Ivy Duplex',
    type: 'Duplex',
    units: 2,
    stories: 1,
    footprintW: 48,
    footprintD: 44,
    footprintSqFt: 2112,
    bedBath: '2 bed / 2 bath per unit',
    description: 'Side-by-side senior living duplex with zero-entry doorways and front porch.',
    image: 'https://static.wixstatic.com/media/9b04fd_dbbe8d6f6dda484bb907eacc0767d483~mv2.jpg',
    priceRange: '$380K – $480K',
    completionTime: '4 – 6 months',
  },
  {
    id: 'cottonwood',
    name: 'Cottonwood Duplex',
    type: 'Duplex',
    units: 2,
    stories: 2,
    footprintW: 28,
    footprintD: 44,
    footprintSqFt: 1232,
    bedBath: '2 bed / 2 bath per unit',
    description: 'Two-story duplex with open-concept living.',
    image: 'https://static.wixstatic.com/media/9b04fd_bdfb01a5fd1a45d5b29250fd79acd5c4~mv2.jpg',
    priceRange: '$320K – $420K',
    completionTime: '5 – 7 months',
  },
  {
    id: 'jasmine',
    name: 'Jasmine Duplex',
    type: 'Duplex',
    units: 2,
    stories: 2,
    footprintW: 36,
    footprintD: 48,
    footprintSqFt: 1728,
    bedBath: '3 bed / 3 bath per unit',
    description: 'Spacious two-story duplex with generous floor plans.',
    image: 'https://static.wixstatic.com/media/9b04fd_6bbae63961df4607bd94595da2930666~mv2.jpg',
    priceRange: '$450K – $600K',
    completionTime: '5 – 7 months',
  },
  {
    id: 'alder',
    name: 'Alder Triplex',
    type: 'Triplex',
    units: 3,
    stories: 1,
    footprintW: 56,
    footprintD: 44,
    footprintSqFt: 2464,
    bedBath: '1 bed center + 2 bed × 2 end units',
    description: 'Single-story triplex — three units under one roof.',
    image: 'https://static.wixstatic.com/media/9b04fd_d3acad6f605e40cda1b89abd7446dd9e~mv2.png',
    priceRange: '$420K – $540K',
    completionTime: '4 – 6 months',
  },
  {
    id: 'sycamore',
    name: 'Sycamore Quadplex',
    type: 'Quadplex',
    units: 4,
    stories: 2,
    footprintW: 44,
    footprintD: 48,
    footprintSqFt: 2112,
    bedBath: '2 bed / 2 bath per unit',
    description: 'Two-story four-unit building, two units per floor.',
    image: 'https://static.wixstatic.com/media/9b04fd_912356589917495289f6fb1f0a90304b~mv2.jpg',
    priceRange: '$620K – $800K',
    completionTime: '5 – 7 months',
  },
  {
    id: 'maple',
    name: 'Maple Townhome',
    type: 'Townhome',
    units: 4,
    stories: 3,
    footprintW: 96,
    footprintD: 36,
    footprintSqFt: 3456,
    bedBath: '3 bed / 2–3 bath per unit',
    description: 'Three-story row townhomes, configurable 2–10 units. Footprint shown for a 4-unit row.',
    image: 'https://static.wixstatic.com/media/9b04fd_d580cfec549e437f8a5ade0f1c5766b2~mv2.jpg',
    priceRange: '$900K – $1.2M',
    completionTime: '6 – 9 months',
  },
  {
    id: 'cypress',
    name: 'Cypress Apartments',
    type: 'Apartment',
    units: 12,
    stories: 3,
    footprintW: 80,
    footprintD: 60,
    footprintSqFt: 4800,
    bedBath: 'Customizable',
    description: 'Three-story multi-unit walk-up focused on energy efficiency and density.',
    image: 'https://static.wixstatic.com/media/9b04fd_6e5c482ad2d94afd80caac273fd32ed0~mv2.jpg',
    priceRange: '$1.8M – $2.5M',
    completionTime: '8 – 11 months',
  },
  {
    id: 'willow',
    name: 'Willow Apartments',
    type: 'Apartment',
    units: 8,
    stories: 3,
    footprintW: 72,
    footprintD: 56,
    footprintSqFt: 4032,
    bedBath: '1–2 bed / 1–2 bath (mixed)',
    description: 'Mixed-unit apartment structure with varied unit types.',
    image: 'https://static.wixstatic.com/media/9b04fd_4ea00f86e0b443c38d59a39f65adf8ed~mv2.jpg',
    priceRange: '$1.4M – $1.9M',
    completionTime: '7 – 10 months',
  },
  {
    id: 'rosewood',
    name: 'Rosewood Apartments',
    type: 'Apartment',
    units: 52,
    stories: 4,
    footprintW: 120,
    footprintD: 80,
    footprintSqFt: 9600,
    bedBath: 'Studio to 2 bed',
    description: '52-unit four-story senior living community.',
    image: 'https://static.wixstatic.com/media/9b04fd_473979b756ba461ba692ee6e481d309c~mv2.jpg',
    priceRange: '$6.5M – $9M',
    completionTime: '12 – 18 months',
  },
  {
    id: 'mulberry',
    name: 'Mulberry Studio Apartments',
    type: 'Microunit',
    units: 1,
    stories: 1,
    footprintW: 12,
    footprintD: 28,
    footprintSqFt: 336,
    bedBath: '1 bed / 1 bath (331 sq ft)',
    description: '331 sq ft modular microunits for student and community housing.',
    image: 'https://static.wixstatic.com/media/9b04fd_62e111500eef4ac9a1c0ad0bced21193~mv2.jpg',
    priceRange: '$75K – $110K',
    completionTime: '3 – 5 months',
  },
];

const DEFAULT_SETBACKS  = { front: 20, rear: 15, side: 5 };
const MAX_LOT_COVERAGE  = 0.5;
const API_KEY_STORAGE     = 'vol-claude-api-key';
const MAPBOX_KEY_STORAGE  = 'vol-mapbox-token';

// ── Geometry helpers ──────────────────────────────────────────────────────────

const FEET_PER_DEG_LAT = 364173;

function feetPerDegLon(midLat) {
  return FEET_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
}

// Convert a lon/lat ring to SVG-ready {x,y} points in feet, Y-flipped for SVG
function ringToFeetPoints(ring) {
  const lons = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  const midLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const fpLon = feetPerDegLon(midLat);
  const xs = ring.map((c) => c[0] * fpLon);
  const ys = ring.map((c) => c[1] * FEET_PER_DEG_LAT);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return ring.map((_, i) => ({ x: xs[i] - minX, y: maxY - ys[i] }));
}

function formatMoney(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000)     return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(0)}`;
}


function parcelDimensions(ring) {
  const lons   = ring.map((c) => c[0]);
  const lats   = ring.map((c) => c[1]);
  const midLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const fpLon  = feetPerDegLon(midLat);

  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * fpLon,     y1 = ring[i][1] * FEET_PER_DEG_LAT;
    const x2 = ring[i + 1][0] * fpLon, y2 = ring[i + 1][1] * FEET_PER_DEG_LAT;
    area += x1 * y2 - x2 * y1;
  }

  return {
    sqft:     Math.abs(area / 2),
    frontage: (Math.max(...lons) - Math.min(...lons)) * fpLon,
    depth:    (Math.max(...lats) - Math.min(...lats)) * FEET_PER_DEG_LAT,
  };
}

// ── Fit analysis ──────────────────────────────────────────────────────────────

function analyzeFit(parcel, setbacks, products) {
  if (!parcel.sqft) return [];
  const buildableW     = Math.max(0, parcel.frontage - setbacks.side * 2);
  const buildableD     = Math.max(0, parcel.depth - setbacks.front - setbacks.rear);
  const maxCoveredSqFt = parcel.sqft * MAX_LOT_COVERAGE;

  return products.map((p) => {
    const fits         = buildableW >= p.footprintW && buildableD >= p.footprintD;
    const countW       = fits ? Math.floor(buildableW / p.footprintW) : 0;
    const countD       = fits ? Math.floor(buildableD / p.footprintD) : 0;
    const maxByDim     = countW * countD;
    const maxByCov     = Math.floor(maxCoveredSqFt / p.footprintSqFt);
    const count        = Math.min(maxByDim, maxByCov);
    return {
      ...p,
      fits:       fits && count > 0,
      count,
      totalUnits: count * p.units,
      buildableW: Math.round(buildableW),
      buildableD: Math.round(buildableD),
    };
  });
}

// ── Loading step labels ───────────────────────────────────────────────────────

const LOADING_LABELS = {
  parcel: 'Fetching parcel from Regrid…',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ParcelAnalyzer({ products = VOLUMOD_PRODUCTS, wizardStep, setWizardStep, onDataUpdate, onEmailOverview }) {
  const [address,      setAddress]      = useState('');
  const [loadingStep,  setLoadingStep]  = useState(null);
  const [error,        setError]        = useState('');
  const [parcel,       setParcel]       = useState(null);
  const [results,      setResults]      = useState([]);
  const [setbacks,     setSetbacks]     = useState(DEFAULT_SETBACKS);
  const [showSetbacks, setShowSetbacks] = useState(false);

  // Sub-view within wizard steps 2 and 3
  const [view,          setView]          = useState('results');
  const [detailProduct, setDetailProduct] = useState(null);
  const [selectedIds,   setSelectedIds]   = useState(new Set());

  // Multi-layout config
  const [multiQuantities, setMultiQuantities] = useState({});
  const [multiSpacing,    setMultiSpacing]    = useState({}); // { id: { front, back, left, right } }
  const [spacingOpenId,   setSpacingOpenId]   = useState(null);
  const [multiProducts,   setMultiProducts]   = useState([]);

  // AI / map settings
  const [apiKey,      setApiKey]      = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '');
  const [mapboxToken, setMapboxToken] = useState(() => localStorage.getItem(MAPBOX_KEY_STORAGE) ?? '');
  const [aiOpen,      setAiOpen]      = useState(false);

  function saveApiKey(val) {
    setApiKey(val);
    if (val.trim()) localStorage.setItem(API_KEY_STORAGE, val.trim());
    else            localStorage.removeItem(API_KEY_STORAGE);
  }

  function saveMapboxToken(val) {
    setMapboxToken(val);
    if (val.trim()) localStorage.setItem(MAPBOX_KEY_STORAGE, val.trim());
    else            localStorage.removeItem(MAPBOX_KEY_STORAGE);
  }

  async function handleLookup(e) {
    e.preventDefault();
    if (!address.trim()) { setError('Enter a parcel address.'); return; }

    setError('');
    setParcel(null);
    setResults([]);
    setView('results');
    setSelectedIds(new Set());

    if (address.trim().toLowerCase() === 'demo') {
      const mockParcel = {
        displayAddress: '3450 N WASHINGTON BLVD, INDIANAPOLIS, IN 46205',
        matchedAddress: '3450 N WASHINGTON BLVD, INDIANAPOLIS, IN 46205',
        parcelId: '49-06-11-131-004.000-101',
        county: 'MARION COUNTY',
        state: 'Indiana',
        sqft: 18750,
        frontage: 125,
        depth: 150,
        acres: 18750 / 43560,
        centerLon: -86.1465,
        centerLat: 39.8234,
      };
      setParcel(mockParcel);
      setResults(analyzeFit(mockParcel, setbacks, products));
      setWizardStep(2);
      return;
    }

    if (address.trim().toLowerCase() === 'demo2') {
      // L-shaped irregular parcel: 180ft wide × 220ft deep with top-right corner removed
      // Bottom section: 180ft × 100ft, upper section: 100ft × 120ft (left side)
      const ring = [
        [-86.1495,    39.8224  ],
        [-86.148857,  39.8224  ],
        [-86.148857,  39.822675],
        [-86.149143,  39.822675],
        [-86.149143,  39.823004],
        [-86.1495,    39.823004],
        [-86.1495,    39.8224  ],
      ];
      const dims = parcelDimensions(ring);
      const mockParcel = {
        displayAddress: '1820 E 38TH ST, INDIANAPOLIS, IN 46218',
        matchedAddress: '1820 E 38TH ST, INDIANAPOLIS, IN 46218',
        parcelId: '49-06-11-102-012.000-101',
        county: 'MARION COUNTY',
        state: 'Indiana',
        sqft:     Math.round(dims.sqft),
        frontage: Math.round(dims.frontage),
        depth:    Math.round(dims.depth),
        acres:    dims.sqft / 43560,
        centerLon: -86.14918,
        centerLat:  39.82262,
        ring,
      };
      setParcel(mockParcel);
      setResults(analyzeFit(mockParcel, setbacks, products));
      setWizardStep(2);
      return;
    }

    if (!hasRegridToken()) {
      setError('Regrid API token missing. Add VITE_REGRID_TOKEN to your .env and restart the dev server.');
      return;
    }

    try {
      setLoadingStep('parcel');
      const parcelData = await lookupParcelByAddress(address.trim());

      setParcel(parcelData);
      setResults(analyzeFit(parcelData, setbacks, products));
      setWizardStep(2);
    } catch (err) {
      setError(err.message || 'Parcel lookup failed.');
    } finally {
      setLoadingStep(null);
    }
  }

  function handleSetbackChange(key, val) {
    const updated = { ...setbacks, [key]: Number(val) };
    setSetbacks(updated);
    if (parcel) setResults(analyzeFit(parcel, updated, products));
  }

  function toggleSelect(id, e) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function openDetail(product) {
    setDetailProduct(product);
    setView('detail');
    setWizardStep(4);
  }

  function goBackToStep1() {
    setWizardStep(1);
    setView('results');
    setParcel(null);
    setResults([]);
    setSelectedIds(new Set());
  }

  function handleReset() {
    setWizardStep(1);
    setView('results');
    setParcel(null);
    setResults([]);
    setSelectedIds(new Set());
    setMultiQuantities({});
    setMultiProducts([]);
    setDetailProduct(null);
    setAddress('');
    setError('');
  }

  function goBackToStep2() {
    setWizardStep(2);
    setView('results');
    setDetailProduct(null);
  }

  function goBackToStep3() {
    setWizardStep(3);
  }

  function advanceToConfig() {
    const initQty = {};
    fittingProducts.filter((p) => selectedIds.has(p.id)).forEach((p) => {
      initQty[p.id] = multiQuantities[p.id] ?? 1;
    });
    setMultiQuantities(initQty);
    setWizardStep(3);
  }

  function generateLayout() {
    const prods = fittingProducts
      .filter((p) => selectedIds.has(p.id))
      .map((p) => {
        const requested = Math.max(1, Number(multiQuantities[p.id]) || 1);
        const spacing = multiSpacing[p.id] ?? { front: 10, back: 10, left: 10, right: 10 };
        return { ...p, count: requested, requestedCount: requested, spacing };
      });
    if (prods.length === 1) {
      openDetail(prods[0]);
    } else {
      setMultiProducts(prods);
      setView('multi');
      setWizardStep(4);
    }
  }

  useEffect(() => {
    if (onDataUpdate) onDataUpdate(parcel, results);
  }, [parcel, results]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading         = loadingStep !== null;
  const fittingProducts = results.filter((r) => r.fits);
  const nonFitting      = results.filter((r) => !r.fits);

  return (
    <div className="parcel-analyzer">

      {/* ── Step 1: Parcel Search ─────────────────────────────────────────── */}
      {wizardStep === 1 && (
        <div className="wizard-step wizard-step-centered">
          <img
            src="https://static.wixstatic.com/media/9b04fd_ae70a7f5c08146979133b913a3fb7acd~mv2.png"
            alt="Volumod"
            className="step1-logo"
          />
          <form className="parcel-form" onSubmit={handleLookup}>
            <div className="parcel-form-row">
              <div className="form-group grow">
                <input
                  id="pa-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Parcel Address...."
                  disabled={loading}
                />
              </div>
              <button type="submit" className="lookup-btn" disabled={loading}>
                {loading ? '…' : "Let's Visualize"}
              </button>
            </div>

            {loading && (
              <div className="step-indicator">
                <span className="step-spinner" />
                {LOADING_LABELS[loadingStep]}
              </div>
            )}

            <div className="form-toggles">
              <button
                type="button"
                className="setback-toggle"
                onClick={() => setAiOpen((s) => !s)}
              >
                {aiOpen ? '▲' : '▼'} AI settings
              </button>
            </div>

            {aiOpen && (
              <div className="setback-inputs ai-settings">
                <div className="form-group" style={{ flex: 1, minWidth: '280px' }}>
                  <label>Claude API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    placeholder="sk-ant-…"
                    onChange={(e) => saveApiKey(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '280px' }}>
                  <label>Mapbox Token (satellite imagery)</label>
                  <input
                    type="password"
                    value={mapboxToken}
                    placeholder="pk.eyJ1…"
                    onChange={(e) => saveMapboxToken(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <p className="setback-note ai-key-note">
                  Keys are stored in your browser only. Claude key enables AI placement. Mapbox token enables satellite imagery on the site layout.
                </p>
              </div>
            )}

            {error && <p className="parcel-error">{error}</p>}

          </form>
        </div>
      )}

      {/* ── Step 2: Building Selection ────────────────────────────────────── */}
      {wizardStep === 2 && parcel && (
        <div className="wizard-step">
          <button className="wizard-back-btn" onClick={goBackToStep1}>
            ← Change Parcel
          </button>

          <div className="parcel-card">
            <h2 className="section-heading">Parcel Info</h2>
            <div className="parcel-card-body">
              <div className="parcel-shape-wrap">
                <ParcelShape parcel={parcel} setbacks={setbacks} />
              </div>
              <div className="parcel-stats">
                <div className="stat-item">
                  <span className="stat-label">Address</span>
                  <strong className="stat-value">{parcel.matchedAddress || parcel.displayAddress}</strong>
                </div>
                {parcel.parcelId && (
                  <div className="stat-item">
                    <span className="stat-label">Parcel ID</span>
                    <strong className="stat-value">{parcel.parcelId}</strong>
                  </div>
                )}
                <div className="stat-item">
                  <span className="stat-label">Area</span>
                  <strong className="stat-value">
                    {parcel.sqft.toLocaleString()} sq ft &nbsp;·&nbsp; {parcel.acres.toFixed(3)} ac
                  </strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Dimensions</span>
                  <strong className="stat-value">
                    {parcel.frontage} ft wide × {parcel.depth} ft deep
                  </strong>
                </div>
                {parcel.county && (
                  <div className="stat-item">
                    <span className="stat-label">County</span>
                    <strong className="stat-value">{parcel.county}{parcel.state ? `, ${parcel.state}` : ''}</strong>
                  </div>
                )}
                {parcel.owner && (
                  <div className="stat-item">
                    <span className="stat-label">Owner</span>
                    <strong className="stat-value">
                      {parcel.owner}
                      {parcel.owner2 ? ` · ${parcel.owner2}` : ''}
                      {parcel.ownerOccupied ? ' (owner-occupied)' : ''}
                    </strong>
                  </div>
                )}
                {parcel.ownerAddress && (
                  <div className="stat-item">
                    <span className="stat-label">Owner mailing</span>
                    <strong className="stat-value">{parcel.ownerAddress}</strong>
                  </div>
                )}
                {(parcel.zoning || parcel.zoningDesc) && (
                  <div className="stat-item">
                    <span className="stat-label">Zoning</span>
                    <strong className="stat-value">
                      {parcel.zoning || ''}
                      {parcel.zoning && parcel.zoningDesc ? ' — ' : ''}
                      {parcel.zoningDesc || ''}
                    </strong>
                  </div>
                )}
                {(parcel.usedesc || parcel.lbcsFunction) && (
                  <div className="stat-item">
                    <span className="stat-label">Land use</span>
                    <strong className="stat-value">{parcel.usedesc || parcel.lbcsFunction}</strong>
                  </div>
                )}
                {parcel.yearBuilt && (
                  <div className="stat-item">
                    <span className="stat-label">Year built</span>
                    <strong className="stat-value">
                      {parcel.yearBuilt}
                      {parcel.struct ? ` · ${parcel.struct}` : ''}
                      {parcel.stories ? ` · ${parcel.stories}-story` : ''}
                    </strong>
                  </div>
                )}
                {parcel.buildingSqft && (
                  <div className="stat-item">
                    <span className="stat-label">Existing building</span>
                    <strong className="stat-value">
                      {parcel.buildingSqft.toLocaleString()} sq ft
                      {parcel.numUnits ? ` · ${parcel.numUnits} unit${parcel.numUnits > 1 ? 's' : ''}` : ''}
                    </strong>
                  </div>
                )}
                {parcel.totalValue != null && (
                  <div className="stat-item">
                    <span className="stat-label">
                      Assessed value{parcel.taxYear ? ` (${parcel.taxYear})` : ''}
                    </span>
                    <strong className="stat-value">
                      {formatMoney(parcel.totalValue)}
                      {parcel.landValue != null && parcel.improvValue != null && (
                        <span className="stat-sub">
                          {' '}· land {formatMoney(parcel.landValue)} + improvements {formatMoney(parcel.improvValue)}
                        </span>
                      )}
                    </strong>
                  </div>
                )}
                {parcel.taxAmount != null && (
                  <div className="stat-item">
                    <span className="stat-label">Property tax{parcel.taxYear ? ` (${parcel.taxYear})` : ''}</span>
                    <strong className="stat-value">{formatMoney(parcel.taxAmount)}/yr</strong>
                  </div>
                )}
                {parcel.saleDate && (
                  <div className="stat-item">
                    <span className="stat-label">Last sale</span>
                    <strong className="stat-value">
                      {parcel.saleDate}
                      {parcel.salePrice != null ? ` · ${formatMoney(parcel.salePrice)}` : ''}
                    </strong>
                  </div>
                )}
                {parcel.schoolDistrict && (
                  <div className="stat-item">
                    <span className="stat-label">School district</span>
                    <strong className="stat-value">{parcel.schoolDistrict}</strong>
                  </div>
                )}
                {parcel.subdivision && (
                  <div className="stat-item">
                    <span className="stat-label">Subdivision</span>
                    <strong className="stat-value">{parcel.subdivision}</strong>
                  </div>
                )}
                {parcel.femaFloodZone && (
                  <div className="stat-item">
                    <span className="stat-label">FEMA flood zone</span>
                    <strong className="stat-value">{parcel.femaFloodZone}</strong>
                  </div>
                )}
                {parcel.legalDesc && (
                  <details className="stat-item stat-item-full">
                    <summary className="stat-label">Legal description</summary>
                    <strong className="stat-value stat-value-long">{parcel.legalDesc}</strong>
                  </details>
                )}
                <p className="stat-note">
                  Parcel data from Regrid. Zoning & land-use codes reflect current records; verify with local municipality before building.
                </p>
              </div>
            </div>
          </div>

          {/* Product grid */}
          {view === 'results' && (
            <div className="results-section">
              <div className="results-header">
                <h2 className="section-heading">Volumod Fit Analysis</h2>
                <span className="results-count">
                  {fittingProducts.length} of {results.length} products fit
                </span>
              </div>

              {fittingProducts.length > 0 ? (
                <div className="product-grid">
                  {fittingProducts.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      fit
                      selected={selectedIds.has(p.id)}
                      onSelect={(e) => toggleSelect(p.id, e)}
                      onClick={(e) => toggleSelect(p.id, e)}
                    />
                  ))}
                </div>
              ) : (
                <div className="no-fit-msg">
                  <span className="no-fit-icon">⊘</span>
                  <p>No Volumod products fit this parcel with the current setback assumptions.</p>
                  <p>Try reducing setbacks or searching a larger parcel.</p>
                </div>
              )}

              {nonFitting.length > 0 && (
                <details className="no-fit-section">
                  <summary>Products that don't fit ({nonFitting.length})</summary>
                  <div className="product-grid">
                    {nonFitting.map((p) => (
                      <ProductCard key={p.id} product={p} fit={false} />
                    ))}
                  </div>
                </details>
              )}

              {selectedIds.size > 0 && (
                <div className="combined-bar">
                  <span className="combined-count">{selectedIds.size} selected</span>
                  <button className="combined-btn" onClick={advanceToConfig}>
                    Configure Layout →
                  </button>
                  <button className="combined-clear" onClick={() => setSelectedIds(new Set())}>
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Configure Layout ─────────────────────────────────────── */}
      {wizardStep === 3 && (
        <div className="wizard-step">
          <button className="wizard-back-btn" onClick={goBackToStep2}>
            ← Back to Selection
          </button>

          <div className="multi-config-panel">
            <h3 className="multi-config-title">Configure Layout</h3>
            <div className="multi-config-products">
              {fittingProducts.filter((p) => selectedIds.has(p.id)).map((p) => (
                <div key={p.id} className="multi-config-row">
                  {p.image && (
                    <img src={p.image} alt={p.name} className="admin-thumb"
                      onError={(e) => { e.target.style.display = 'none'; }} />
                  )}
                  <div className="multi-config-info">
                    <strong>{p.name}</strong>
                    <span className="admin-type-tag">{p.type} · {p.footprintW}′×{p.footprintD}′</span>
                  </div>
                  <button
                    type="button"
                    className="spacing-toggle"
                    onClick={() => setSpacingOpenId((prev) => (prev === p.id ? null : p.id))}
                  >
                    {spacingOpenId === p.id ? '▲' : '▼'} Spacing
                  </button>
                  <div className="multi-config-qty">
                    <label>Quantity</label>
                    <QtyInput
                      value={multiQuantities[p.id] ?? 1}
                      min={0}
                      onChange={(v) => {
                        if (v === 0) {
                          const next = new Set(selectedIds);
                          next.delete(p.id);
                          setSelectedIds(next);
                          if (next.size === 0) goBackToStep2();
                        } else {
                          setMultiQuantities((prev) => ({ ...prev, [p.id]: v }));
                        }
                      }}
                    />
                  </div>
                  {spacingOpenId === p.id && (
                    <div className="spacing-panel">
                      {['front', 'back', 'left', 'right'].map((side) => {
                        const spacing = multiSpacing[p.id] ?? { front: 10, back: 10, left: 10, right: 10 };
                        return (
                          <div key={side} className="spacing-side">
                            <label>{side.charAt(0).toUpperCase() + side.slice(1)} (ft)</label>
                            <input
                              type="number"
                              min={0}
                              value={spacing[side]}
                              onChange={(e) =>
                                setMultiSpacing((prev) => ({
                                  ...prev,
                                  [p.id]: { ...spacing, [side]: Number(e.target.value) },
                                }))
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="config-setbacks">
              <button
                type="button"
                className="setback-toggle"
                onClick={() => setShowSetbacks((s) => !s)}
              >
                {showSetbacks ? '▲' : '▼'} Setback assumptions
              </button>
              {showSetbacks && (
                <div className="setback-inputs">
                  {['front', 'rear', 'side'].map((k) => (
                    <div className="form-group" key={k}>
                      <label>{k.charAt(0).toUpperCase() + k.slice(1)} setback (ft)</label>
                      <input
                        type="number"
                        min={0}
                        value={setbacks[k]}
                        onChange={(e) => handleSetbackChange(k, e.target.value)}
                      />
                    </div>
                  ))}
                  <p className="setback-note">
                    Max lot coverage: {(MAX_LOT_COVERAGE * 100).toFixed(0)}% · Adjust to match local zoning.
                  </p>
                </div>
              )}
            </div>

            <div className="multi-config-actions">
              <button className="combined-clear" onClick={goBackToStep2}>← Back</button>
              <button className="combined-btn" onClick={generateLayout}>
                Generate Layout →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 4: Site Layout ───────────────────────────────────────────── */}
      {wizardStep === 4 && (
        <div className="wizard-step">
          {view === 'detail' && detailProduct && (
            <ProductDetail
              product={detailProduct}
              parcel={parcel}
              setbacks={setbacks}
              apiKey={apiKey}
              mapboxToken={mapboxToken}
              onBack={goBackToStep3}
              onEmailOverview={onEmailOverview}
              onReset={handleReset}
            />
          )}
          {view === 'multi' && (
            <MultiLayoutView
              products={multiProducts}
              parcel={parcel}
              setbacks={setbacks}
              apiKey={apiKey}
              mapboxToken={mapboxToken}
              notes=""
              onBack={goBackToStep3}
              onEmailOverview={onEmailOverview}
              onReset={handleReset}
            />
          )}
        </div>
      )}

    </div>
  );
}

// ── ParcelShape ───────────────────────────────────────────────────────────────

function ParcelShape({ parcel, setbacks }) {
  const VW = 120, VH = 120, PAD = 14;

  if (parcel.ring) {
    const pts  = ringToFeetPoints(parcel.ring);
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));
    const scale = Math.min((VW - PAD * 2) / maxX, (VH - PAD * 2) / maxY);
    const pw = maxX * scale, ph = maxY * scale;
    const ox = (VW - pw) / 2,  oy = (VH - ph) / 2;
    const svgPts = pts.map((p) => `${(ox + p.x * scale).toFixed(1)},${(oy + p.y * scale).toFixed(1)}`).join(' ');
    return (
      <svg viewBox={`0 0 ${VW} ${VH}`} className="parcel-shape-svg" aria-label="Parcel outline">
        <polygon points={svgPts} fill="#3a7d44" stroke="#1a3a20" strokeWidth="1.2" />
        <text x={VW / 2} y={oy - 3} textAnchor="middle" fill="#64748b" fontSize="7">{parcel.frontage}′</text>
        <text x={ox - 4} y={oy + ph / 2} textAnchor="middle" fill="#64748b" fontSize="7"
          transform={`rotate(-90,${ox - 4},${oy + ph / 2})`}>{parcel.depth}′</text>
        <circle cx={ox + pw - 8} cy={oy + 8} r="6" fill="rgba(0,0,0,0.35)" />
        <text x={ox + pw - 8} y={oy + 11} textAnchor="middle" fill="#f1f5f9" fontSize="6" fontWeight="700">N</text>
      </svg>
    );
  }

  const scale = Math.min((VW - PAD * 2) / parcel.frontage, (VH - PAD * 2) / parcel.depth);
  const pw = parcel.frontage * scale;
  const ph = parcel.depth    * scale;
  const ox = (VW - pw) / 2;
  const oy = (VH - ph) / 2;
  const sbF = setbacks.front * scale;
  const sbR = setbacks.rear  * scale;
  const sbS = setbacks.side  * scale;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="parcel-shape-svg" aria-label="Parcel outline">
      <rect x={ox} y={oy} width={pw} height={ph} fill="#3a7d44" rx="1" />
      <rect x={ox + sbS} y={oy + sbR} width={pw - sbS * 2} height={ph - sbF - sbR}
        fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.7" strokeDasharray="3 2" rx="1" />
      <rect x={ox} y={oy} width={pw} height={ph} fill="none" stroke="#1a3a20" strokeWidth="1.2" rx="1" />
      <text x={VW / 2} y={oy - 3} textAnchor="middle" fill="#64748b" fontSize="7">{parcel.frontage}′</text>
      <text x={ox - 4} y={oy + ph / 2} textAnchor="middle" fill="#64748b" fontSize="7"
        transform={`rotate(-90,${ox - 4},${oy + ph / 2})`}>{parcel.depth}′</text>
      <circle cx={ox + pw - 8} cy={oy + 8} r="6" fill="rgba(0,0,0,0.35)" />
      <text x={ox + pw - 8} y={oy + 11} textAnchor="middle" fill="#f1f5f9" fontSize="6" fontWeight="700">N</text>
    </svg>
  );
}

// ── QtyInput ──────────────────────────────────────────────────────────────────

function QtyInput({ value, onChange, min = 1 }) {
  return (
    <div className="qty-stepper">
      <button
        type="button"
        className="qty-btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Decrease"
      >−</button>
      <span className="qty-value">{value}</span>
      <button
        type="button"
        className="qty-btn"
        onClick={() => onChange(value + 1)}
        aria-label="Increase"
      >+</button>
    </div>
  );
}

// ── ProductCard ───────────────────────────────────────────────────────────────

function ProductCard({ product: p, fit, selected, onSelect, onClick }) {
  return (
    <div
      className={`product-card ${fit ? 'product-fit' : 'product-no-fit'} ${onClick ? 'product-clickable' : ''} ${selected ? 'product-selected' : ''}`}
      onClick={onClick}
    >
      {fit && onSelect && (
        <label className="card-checkbox" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={!!selected} onChange={onSelect} />
          <span className="card-checkbox-mark">{selected ? '✓' : ''}</span>
        </label>
      )}

      {p.image && (
        <img className="product-img" src={p.image} alt={p.name} loading="lazy" />
      )}
      <div className="product-card-header">
        <span className={`fit-badge ${fit ? '' : 'badge-no'}`}>
          {fit ? 'Fits' : 'Too large'}
        </span>
        <span className="product-type-tag">{p.type}</span>
      </div>
      <h3 className="product-name">{p.name}</h3>
      <p className="product-desc">{p.description}</p>
      <div className="product-stats-grid">
        <div className="pstat"><span>Footprint</span><strong>{p.footprintW}′ × {p.footprintD}′</strong></div>
        <div className="pstat"><span>Stories</span><strong>{p.stories}</strong></div>
        <div className="pstat"><span>Beds / Baths</span><strong>{p.bedBath}</strong></div>
        <div className="pstat"><span>Est. price</span><strong>{p.priceRange}</strong></div>
        <div className="pstat"><span>Est. completion</span><strong>{p.completionTime}</strong></div>
        {fit ? (
          <>
            <div className="pstat"><span>Buildings on lot</span><strong>{p.count}</strong></div>
            <div className="pstat highlight-stat"><span>Total units</span><strong className="total-units">{p.totalUnits}</strong></div>
          </>
        ) : (
          <>
            <div className="pstat"><span>Needs</span><strong>{p.footprintW}′ × {p.footprintD}′</strong></div>
            <div className="pstat"><span>Buildable</span><strong>{p.buildableW}′ × {p.buildableD}′</strong></div>
          </>
        )}
      </div>
      <p className="price-disclaimer">Pricing and timelines are estimates — contact Volumod for a formal quote.</p>
    </div>
  );
}
