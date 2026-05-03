// Regrid v2 Parcel API wrapper.
// Token is read from VITE_REGRID_TOKEN at build time (Vite env). Keep the
// token out of source — set it in `.env` (see `.env.example`).

const REGRID_TOKEN = import.meta.env.VITE_REGRID_TOKEN;
const REGRID_BASE  = 'https://app.regrid.com/api/v2';

const FEET_PER_DEG_LAT = 364173;
function feetPerDegLon(midLat) {
  return FEET_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
}

export function hasRegridToken() {
  return Boolean(REGRID_TOKEN);
}

// Look up a parcel by free-form address string. Returns a parcel object
// in the shape the app already uses, plus a `ring` (outer polygon, lon/lat).
export async function lookupParcelByAddress(address) {
  if (!REGRID_TOKEN) {
    throw new Error('Missing VITE_REGRID_TOKEN — add it to .env and restart the dev server.');
  }
  const url = `${REGRID_BASE}/parcels/address?query=${encodeURIComponent(address)}&token=${REGRID_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Regrid lookup failed (${res.status}) ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const feature = pickFirstFeature(data);
  if (!feature) throw new Error('No parcel found for that address.');
  return normalizeFeature(feature, address);
}

// Look up a parcel by point (lat/lng). Handy if we already have a geocode.
export async function lookupParcelByPoint(lat, lng) {
  if (!REGRID_TOKEN) {
    throw new Error('Missing VITE_REGRID_TOKEN — add it to .env and restart the dev server.');
  }
  const url = `${REGRID_BASE}/parcels/point?lat=${lat}&lon=${lng}&token=${REGRID_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Regrid point lookup failed (${res.status}) ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const feature = pickFirstFeature(data);
  if (!feature) throw new Error('No parcel found at that point.');
  return normalizeFeature(feature);
}

function pickFirstFeature(data) {
  if (!data) return null;
  // Regrid v2 wraps responses in { parcels: { features: [...] } } but fall
  // back to a plain FeatureCollection shape just in case.
  if (data.parcels?.features?.length) return data.parcels.features[0];
  if (data.features?.length)          return data.features[0];
  return null;
}

function normalizeFeature(feature, originalQuery = '') {
  const fields = feature.properties?.fields ?? feature.properties ?? {};
  const ring   = extractOuterRing(feature.geometry);
  if (!ring) throw new Error('Parcel geometry could not be parsed.');

  const dims     = parcelDimensionsFromRing(ring);
  // Use the ring's bbox centre (not the vertex mean) so the parcel's plan-
  // coord rectangle and satellite imagery line up pixel-for-pixel.
  const centroid = ringBBoxCenter(ring);

  const ll_sqft  = numericOrNull(fields.ll_gissqft ?? fields.gissqft ?? fields.sqft);
  const ll_acre  = numericOrNull(fields.ll_gisacre ?? fields.gisacre);

  // Owner mailing address — assembled from individual parts Regrid exposes
  const ownerAddressParts = [
    fields.mailadd  || fields.mailaddress,
    [fields.mailcity, fields.mailstate2 || fields.mailstate, fields.mailzip]
      .filter(Boolean).join(', '),
  ].filter(Boolean);
  const ownerAddress = ownerAddressParts.length ? ownerAddressParts.join(' — ') : null;

  return {
    displayAddress: fields.address || fields.saddress || originalQuery,
    matchedAddress: fields.address || originalQuery,
    parcelId:       fields.parcelnumb || fields.parcelnumb_no_formatting || fields.alt_parcelnumb1 || null,
    county:         fields.county   || null,
    state:          fields.state2   || fields.state   || null,
    city:           fields.scity    || null,
    zip:            fields.szip     || null,
    sqft:           Math.round(ll_sqft ?? dims.sqft),
    frontage:       Math.round(dims.frontage),
    depth:          Math.round(dims.depth),
    acres:          ll_acre ?? (ll_sqft ?? dims.sqft) / 43560,
    centerLon:      centroid[0],
    centerLat:      centroid[1],
    ring,

    // Ownership
    owner:          fields.owner        || null,
    owner2:         fields.owner2       || null,
    ownerAddress,
    ownerOccupied:  fields.ownocc === 'Y' || fields.ownerocc === 'Y' || null,

    // Zoning & land use
    zoning:         fields.zoning       || null,
    zoningDesc:     fields.zoning_description || fields.zoning_desc || null,
    usedesc:        fields.usedesc      || fields.use_desc || null,
    lbcsActivity:   fields.lbcs_activity_desc || null,
    lbcsFunction:   fields.lbcs_function_desc || null,

    // Structure
    yearBuilt:      numericOrNull(fields.yearbuilt) ?? null,
    struct:         fields.struct       || fields.structurestyle || null,
    buildingSqft:   numericOrNull(fields.ll_bldg_footprint_sqft ?? fields.bldg_sqft ?? fields.buildingSqft),
    numUnits:       numericOrNull(fields.ll_bldg_count ?? fields.numunits),
    stories:        numericOrNull(fields.numstories ?? fields.stories),

    // Assessment / tax (most recent year Regrid has)
    taxYear:        numericOrNull(fields.taxyear) ?? null,
    landValue:      numericOrNull(fields.landval  ?? fields.land_value),
    improvValue:    numericOrNull(fields.improvval ?? fields.improvement_value),
    totalValue:     numericOrNull(fields.parval   ?? fields.total_value ?? fields.assessed_value),
    taxAmount:      numericOrNull(fields.taxamt   ?? fields.tax_amount),

    // Sale history
    saleDate:       fields.saledate || null,
    salePrice:      numericOrNull(fields.saleprice ?? fields.sale_price),

    // Neighborhood
    schoolDistrict: fields.school_district || fields.sch_district || null,
    subdivision:    fields.subdivision     || null,
    neighborhood:   fields.neighborhood    || null,
    census_tract:   fields.census_tract    || null,

    // Legal + misc
    legalDesc:      fields.legaldesc      || fields.legal_desc || null,
    femaFloodZone:  fields.fema_flood_zone || fields.floodzone  || null,
  };
}

function numericOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractOuterRing(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon')      return geom.coordinates?.[0] ?? null;
  if (geom.type === 'MultiPolygon') {
    // Use the ring with the largest absolute area — typically the "main" parcel
    let best = null, bestA = -Infinity;
    for (const poly of geom.coordinates ?? []) {
      const r = poly[0];
      if (!r) continue;
      const a = Math.abs(shoelace(r));
      if (a > bestA) { bestA = a; best = r; }
    }
    return best;
  }
  return null;
}

function shoelace(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

function parcelDimensionsFromRing(ring) {
  const lons   = ring.map((c) => c[0]);
  const lats   = ring.map((c) => c[1]);
  const midLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const fpLon  = feetPerDegLon(midLat);

  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0]     * fpLon, y1 = ring[i][1]     * FEET_PER_DEG_LAT;
    const x2 = ring[i + 1][0] * fpLon, y2 = ring[i + 1][1] * FEET_PER_DEG_LAT;
    area += x1 * y2 - x2 * y1;
  }

  return {
    sqft:     Math.abs(area / 2),
    frontage: (Math.max(...lons) - Math.min(...lons)) * fpLon,
    depth:    (Math.max(...lats) - Math.min(...lats)) * FEET_PER_DEG_LAT,
  };
}

function ringBBoxCenter(ring) {
  const lons = ring.map(c => c[0]);
  const lats = ring.map(c => c[1]);
  return [
    (Math.min(...lons) + Math.max(...lons)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}
