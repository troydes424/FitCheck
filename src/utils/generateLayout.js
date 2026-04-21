const MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_SPACING = { front: 10, back: 10, left: 10, right: 10 };

// ── Geometry helpers ──────────────────────────────────────────────────────────

function getBuildable(parcel, setbacks) {
  return {
    w: Math.max(0, parcel.frontage - setbacks.side * 2),
    d: Math.max(0, parcel.depth - setbacks.front - setbacks.rear),
  };
}

// Build a (productId) → { front, back, left, right } lookup
function makeGetSpacing(products) {
  const map = Object.fromEntries(products.map((p) => [p.id, p.spacing ?? DEFAULT_SPACING]));
  return (id) => map[id] ?? DEFAULT_SPACING;
}

// Returns true if two placements overlap or are too close, using per-product
// per-side spacing. Required gap between two buildings = max of the two facing sides.
function conflicts(a, b, getSpacing) {
  const sa = getSpacing(a.productId);
  const sb = getSpacing(b.productId);
  // a left of b → gap = max(a.right, b.left)
  if (a.xFt + a.widthFt + Math.max(sa.right, sb.left) <= b.xFt) return false;
  // b left of a → gap = max(b.right, a.left)
  if (b.xFt + b.widthFt + Math.max(sb.right, sa.left) <= a.xFt) return false;
  // a behind b (lower y) → gap = max(a.front, b.back)
  if (a.yFt + a.depthFt + Math.max(sa.front, sb.back) <= b.yFt) return false;
  // b behind a → gap = max(b.front, a.back)
  if (b.yFt + b.depthFt + Math.max(sb.front, sa.back) <= a.yFt) return false;
  return true;
}

// ── Corner-point packer ───────────────────────────────────────────────────────
// Greedily fills all available space for one product type using the corner-point
// method: candidate positions are derived from existing building edges + GAP,
// which guarantees no valid placement is ever skipped.

function packProduct(existing, product, buildableW, buildableD, maxCount, maxCoveredSqFt, getSpacing) {
  const placed = [...existing];
  let count = placed.filter((p) => p.productId === product.id).length;
  const newSpacing = product.spacing ?? DEFAULT_SPACING;

  let improved = true;
  while (improved && count < maxCount) {
    improved = false;

    // Candidate x/y positions: origin + right/bottom edge of every placed building
    // (gap = max of placed-building's facing side and new product's facing side)
    const xs = new Set([0]);
    const ys = new Set([0]);
    for (const p of placed) {
      const ps = getSpacing(p.productId);
      const rx = p.xFt + p.widthFt + Math.max(ps.right, newSpacing.left);
      const ry = p.yFt + p.depthFt + Math.max(ps.front, newSpacing.back);
      if (rx + product.footprintW <= buildableW + 0.01) xs.add(rx);
      if (ry + product.footprintD <= buildableD + 0.01) ys.add(ry);
    }

    const sortedX = [...xs].sort((a, b) => a - b);
    const sortedY = [...ys].sort((a, b) => a - b);

    outer:
    for (const yFt of sortedY) {
      if (yFt + product.footprintD > buildableD + 0.01) continue;
      for (const xFt of sortedX) {
        if (xFt + product.footprintW > buildableW + 0.01) continue;

        const covered = placed.reduce((s, p) => s + p.widthFt * p.depthFt, 0);
        if (covered + product.footprintSqFt > maxCoveredSqFt) break outer;

        const candidate = {
          productId: product.id,
          instance: count,
          xFt,
          yFt,
          widthFt: product.footprintW,
          depthFt: product.footprintD,
        };

        if (!placed.some((p) => conflicts(p, candidate, getSpacing))) {
          placed.push(candidate);
          count++;
          improved = true;
          break outer; // restart: new building creates new candidate positions
        }
      }
    }
  }

  return placed;
}

// ── Summary builder ───────────────────────────────────────────────────────────

function buildSummary(placements, parcel, products, source, notes) {
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const covered    = placements.reduce((s, p) => s + p.widthFt * p.depthFt, 0);
  const totalUnits = placements.reduce((s, p) => s + (productMap[p.productId]?.units ?? 1), 0);
  return {
    placements,
    totalUnits,
    coveragePct: parseFloat(((covered / parcel.sqft) * 100).toFixed(1)),
    notes,
    source,
  };
}

// ── Grid layout (no AI) ───────────────────────────────────────────────────────

function gridLayout(parcel, products, setbacks) {
  const { w: buildableW, d: buildableD } = getBuildable(parcel, setbacks);
  const maxCoveredSqFt = parcel.sqft * 0.5;
  const getSpacing = makeGetSpacing(products);

  let placements = [];
  for (const product of products) {
    placements = packProduct(placements, product, buildableW, buildableD, product.count ?? 99, maxCoveredSqFt, getSpacing);
  }

  return buildSummary(placements, parcel, products, 'grid', 'Grid layout');
}

// ── Post-process AI placements ────────────────────────────────────────────────
// 1. Strip any placements that violate hard constraints (out-of-bounds, overlaps)
// 2. Run the corner-point packer on what remains to fill every available gap

function refineLayout(rawPlacements, parcel, products, setbacks) {
  const { w: buildableW, d: buildableD } = getBuildable(parcel, setbacks);
  const maxCoveredSqFt = parcel.sqft * 0.5;
  const productMap     = Object.fromEntries(products.map((p) => [p.id, p]));
  const getSpacing     = makeGetSpacing(products);

  // Step 1: keep only valid, non-overlapping placements
  const valid = [];
  for (const pl of rawPlacements) {
    const prod = productMap[pl.productId];
    if (!prod) continue;
    if (pl.xFt < -0.01 || pl.yFt < -0.01) continue;
    if (pl.xFt + pl.widthFt > buildableW + 0.1) continue;
    if (pl.yFt + pl.depthFt > buildableD + 0.1) continue;
    if (valid.some((p) => conflicts(p, pl, getSpacing))) continue;
    const covered = valid.reduce((s, p) => s + p.widthFt * p.depthFt, 0);
    if (covered + pl.widthFt * pl.depthFt > maxCoveredSqFt) continue;
    valid.push(pl);
  }

  // Step 2: fill remaining space for every product
  let placements = valid;
  for (const product of products) {
    placements = packProduct(placements, product, buildableW, buildableD, product.count ?? 99, maxCoveredSqFt, getSpacing);
  }

  return placements;
}

// ── Claude prompt ─────────────────────────────────────────────────────────────

function buildPrompt(parcel, products, setbacks, userNotes) {
  const buildableW     = Math.round(Math.max(0, parcel.frontage - setbacks.side * 2));
  const buildableD     = Math.round(Math.max(0, parcel.depth - setbacks.front - setbacks.rear));
  const maxCoveredSqFt = Math.round(parcel.sqft * 0.5);

  const productLines = products
    .map((p) => {
      const s = p.spacing ?? DEFAULT_SPACING;
      return `  - id:"${p.id}" name:"${p.name}" w:${p.footprintW}ft d:${p.footprintD}ft units:${p.units} requested:${p.count ?? 99} spacing:{front:${s.front},back:${s.back},left:${s.left},right:${s.right}}`;
    })
    .join('\n');

  const notesSection = userNotes?.trim()
    ? `\nLAYOUT INSTRUCTIONS FROM USER (follow these as closely as possible):\n"${userNotes.trim()}"\n`
    : '';

  return `Site plan layout task. Suggest initial building positions on a parcel. Return ONLY valid JSON.

Parcel: ${parcel.frontage}ft wide x ${parcel.depth}ft deep (${parcel.sqft.toLocaleString()} sqft)
Buildable area (after setbacks): ${buildableW}ft wide x ${buildableD}ft deep
  Origin: rear-left corner. x increases right, y increases toward street.
Max lot coverage: ${maxCoveredSqFt} sqft (50%)
${notesSection}
Products to place:
${productLines}

HARD RULES — all mandatory:
1. Every building must fit entirely within the buildable area:
   xFt >= 0, yFt >= 0, xFt + widthFt <= ${buildableW}, yFt + depthFt <= ${buildableD}
2. Each product has per-side spacing requirements (front/back/left/right in feet).
   Required gap between buildings A and B = max(A.facing-side, B.facing-side):
     • A left of B   → gap = max(A.right, B.left)
     • A above B (lower y) → gap = max(A.front, B.back)
   No overlaps allowed.
3. Total footprint area <= ${maxCoveredSqFt} sqft.
4. Place exactly the "requested" count for each product if space allows; otherwise as many as fit.
5. Pack as many buildings as possible — check every gap before stopping.

Return ONLY this JSON (no markdown, no explanation):
{"placements":[{"productId":"","instance":0,"xFt":0,"yFt":0,"widthFt":0,"depthFt":0}],"totalUnits":0,"coveragePct":0.0,"notes":""}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateLayout({ parcel, products, setbacks, apiKey, notes }) {
  if (!apiKey?.trim()) {
    return gridLayout(parcel, products, setbacks);
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: buildPrompt(parcel, products, setbacks, notes) }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Claude API ${res.status}${errText ? ': ' + errText.slice(0, 150) : ''}`);
    }

    const data  = await res.json();
    const text  = data?.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const aiLayout = JSON.parse(match[0]);
    if (!Array.isArray(aiLayout.placements)) throw new Error('Invalid layout shape');

    // Validate AI placements and fill every remaining gap with JS packer
    const refinedPlacements = refineLayout(aiLayout.placements, parcel, products, setbacks);
    return buildSummary(refinedPlacements, parcel, products, 'ai', aiLayout.notes ?? '');
  } catch (err) {
    console.warn('[generateLayout] Falling back to grid:', err.message);
    return { ...gridLayout(parcel, products, setbacks), source: 'grid', aiError: err.message };
  }
}
