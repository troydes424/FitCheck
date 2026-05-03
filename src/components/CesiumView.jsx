import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import Offset from 'polygon-offset';

// Optional Ion token — unlocks Cesium World Terrain, OSM Buildings, and
// (if you flip SCENERY below) Google Photorealistic 3D Tiles. Without it
// the viewer falls back to free Esri World Imagery on a flat globe.
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
if (ION_TOKEN) Cesium.Ion.defaultAccessToken = ION_TOKEN;

// Building heights mirror the SVG view
const STORY_HEIGHT_M = 2.9;
const FOUNDATION_M   = 0.3;
const FT_TO_M = 0.3048;

// Neutral siding colour for walls — product-specific colour paints the roof.
const WALL_COLOR = Cesium.Color.fromCssColorString('#d6cab0');

// Pitched gable roof height factor (same as the SVG views)
const ROOF_PITCH_RATIO = 0.22;

// Build everything we need to draw a building — walls + pitched/flat roof
// + eave trim + per-story trim lines + window bands — given a centre
// (lon, lat), metre-sized dimensions, story count, and a local ground
// elevation (`terrainH`). Anything that uses absolute heights (roofs, trims)
// needs `terrainH` to be numeric; without it we still render walls + a
// flat roof cap via `RELATIVE_TO_GROUND` and skip the detail pieces.
function buildingSpec({ centerLon, centerLat, widthM, depthM, stories, heightM, terrainH }) {
  const M_PER_DEG_LAT = 111_320;
  const M_PER_DEG_LON = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const halfWDeg = (widthM / 2) / M_PER_DEG_LON;
  const halfDDeg = (depthM / 2) / M_PER_DEG_LAT;

  const nwLon = centerLon - halfWDeg, nwLat = centerLat + halfDDeg;
  const neLon = centerLon + halfWDeg, neLat = nwLat;
  const seLon = neLon,                 seLat = centerLat - halfDDeg;
  const swLon = nwLon,                 swLat = seLat;

  // Footprint as a flat [lon, lat, lon, lat, …] array for walls/flat-roof
  const footprint = [nwLon, nwLat, neLon, neLat, seLon, seLat, swLon, swLat];

  const shorterM       = Math.min(widthM, depthM);
  // Pitch every building when we have terrain — apartments use a lower
  // pitch ratio so they don't look like comedic giant houses.
  const usePitched     = Number.isFinite(terrainH);
  const effectiveRatio = stories <= 2 ? ROOF_PITCH_RATIO : ROOF_PITCH_RATIO * 0.45;
  const eaveHeightM    = heightM;
  const ridgeExtraM    = usePitched ? shorterM * effectiveRatio : 0;
  const ridgeHeightM   = eaveHeightM + ridgeExtraM;

  const spec = { footprint, eaveHeightM, ridgeHeightM, usePitched };

  if (Number.isFinite(terrainH)) {
    const eaveH  = terrainH + eaveHeightM;
    const ridgeH = terrainH + ridgeHeightM;

    if (usePitched) {
      const ridgeAlongWidth = widthM >= depthM;
      if (ridgeAlongWidth) {
        // Ridge line runs E–W at centerLat, so ridge endpoints are on the
        // east and west walls at mid-height.
        spec.roofPanels = [
          // North panel: NW_eave, NE_eave, ridge_east, ridge_west
          [ nwLon, nwLat, eaveH, neLon, neLat, eaveH,
            neLon, centerLat, ridgeH, nwLon, centerLat, ridgeH ],
          // South panel
          [ swLon, swLat, eaveH, seLon, seLat, eaveH,
            seLon, centerLat, ridgeH, swLon, centerLat, ridgeH ],
        ];
        // Gable end triangles at west and east walls
        spec.gables = [
          [ nwLon, nwLat, eaveH,  nwLon, centerLat, ridgeH,  swLon, swLat, eaveH ],
          [ neLon, neLat, eaveH,  neLon, centerLat, ridgeH,  seLon, seLat, eaveH ],
        ];
      } else {
        // Ridge N–S at centerLon
        spec.roofPanels = [
          // West panel
          [ nwLon, nwLat, eaveH, swLon, swLat, eaveH,
            centerLon, swLat, ridgeH, centerLon, nwLat, ridgeH ],
          // East panel
          [ neLon, neLat, eaveH, seLon, seLat, eaveH,
            centerLon, seLat, ridgeH, centerLon, neLat, ridgeH ],
        ];
        spec.gables = [
          // North gable (at nwLat)
          [ nwLon, nwLat, eaveH,  centerLon, nwLat, ridgeH,  neLon, neLat, eaveH ],
          // South gable
          [ swLon, swLat, eaveH,  centerLon, swLat, ridgeH,  seLon, seLat, eaveH ],
        ];
      }
    }

  }

  return spec;
}

function productColor(i) {
  const hexes = ['#4f46e5', '#059669', '#d97706', '#dc2626', '#7c3aed', '#ea580c'];
  return Cesium.Color.fromCssColorString(hexes[i % hexes.length]);
}

// Ray-casting point-in-ring test in lon/lat space. `ring` is an array of
// [lon, lat] pairs, as returned by Regrid.
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

// All four building footprint corners must sit inside the parcel polygon.
function cornersInsideRing(corners, ring) {
  for (const [lon, lat] of corners) {
    if (!pointInRing(lon, lat, ring)) return false;
  }
  return true;
}

// Create all the entities that make up one building (walls, roof panels /
// gable triangles / flat cap, eave trim, story lines, window bands).
// Returns an object with refs to every part so the drag handler can update
// them in lockstep.
function addBuildingParts(viewer, idx, name, spec, color) {
  const parts = { wall: null, roofPanels: [], gables: [], flatRoof: null };

  // Walls — extruded box, neutral cream siding
  parts.wall = viewer.entities.add({
    id: `building-${idx}`,
    name,
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(
        Cesium.Cartesian3.fromDegreesArray(spec.footprint)
      ),
      heightReference:         Cesium.HeightReference.RELATIVE_TO_GROUND,
      extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      height:                  0,
      extrudedHeight:          spec.eaveHeightM,
      material:                WALL_COLOR,
      closeTop:                true,
      closeBottom:             true,
      perPositionHeight:       false,
    },
  });

  if (spec.usePitched && spec.roofPanels && spec.gables) {
    // Two sloped roof panels in the product colour
    spec.roofPanels.forEach((panel, p) => {
      parts.roofPanels.push(viewer.entities.add({
        id: `building-${idx}-roofPanel-${p}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            Cesium.Cartesian3.fromDegreesArrayHeights(panel)
          ),
          perPositionHeight: true,
          material:          color,
        },
      }));
    });
    // Gable triangles fill the walls above the eave up to the ridge
    spec.gables.forEach((tri, g) => {
      parts.gables.push(viewer.entities.add({
        id: `building-${idx}-gable-${g}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            Cesium.Cartesian3.fromDegreesArrayHeights(tri)
          ),
          perPositionHeight: true,
          material:          WALL_COLOR,
        },
      }));
    });
  } else {
    // Flat roof cap (no terrain sample yet) — thin slab in the product colour
    parts.flatRoof = viewer.entities.add({
      id: `building-${idx}-roof`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(spec.footprint)
        ),
        heightReference:         Cesium.HeightReference.RELATIVE_TO_GROUND,
        extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        height:                  spec.eaveHeightM,
        extrudedHeight:          spec.eaveHeightM + 0.3,
        material:                color,
      },
    });
  }

  return parts;
}

// Push a freshly-computed spec into an already-existing building's parts.
// Used during drag-move so we don't destroy / recreate entities every frame.
function updateBuildingParts(parts, spec) {
  const ph  = (flat) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat));
  const phH = (flat) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights(flat));

  if (parts.wall?.polygon) parts.wall.polygon.hierarchy = ph(spec.footprint);
  spec.roofPanels?.forEach((panel, p) => {
    const e = parts.roofPanels[p];
    if (e?.polygon) e.polygon.hierarchy = phH(panel);
  });
  spec.gables?.forEach((tri, g) => {
    const e = parts.gables[g];
    if (e?.polygon) e.polygon.hierarchy = phH(tri);
  });
  if (parts.flatRoof?.polygon && spec.footprint) {
    parts.flatRoof.polygon.hierarchy = ph(spec.footprint);
  }
}

// GLB / GLTF path — a product has supplied its own 3D model so we swap
// out the procedural cream-box for the real asset. The model is authored
// at real-world scale (1 unit = 1 m) with origin at the ground centre, so
// `HeightReference.RELATIVE_TO_GROUND` drops it cleanly on the terrain.
function addBuildingModel(viewer, idx, name, { centerLon, centerLat, modelUrl }) {
  return viewer.entities.add({
    id: `building-${idx}`,
    name,
    position: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0),
    model: {
      uri:              modelUrl,
      heightReference:  Cesium.HeightReference.RELATIVE_TO_GROUND,
      minimumPixelSize: 24,
      maximumScale:     200,
      incrementallyLoadTextures: true,
      color:            Cesium.Color.WHITE,
    },
  });
}

function updateBuildingModel(parts, centerLon, centerLat) {
  if (!parts?.model) return;
  parts.model.position = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0);
}

// Inset a lat/lng ring by `distanceM` metres uniformly. Used to draw the
// setback line in Cesium space — projects the ring to a local tangent
// plane (metres east/north of the centroid), runs polygon-offset's
// padding, then projects back to lat/lng.
function insetLatLngRing(ring, distanceM) {
  if (!Array.isArray(ring) || ring.length < 3 || !(distanceM > 0)) return null;
  const lats = ring.map((c) => c[1]);
  const lons = ring.map((c) => c[0]);
  const midLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const midLon = lons.reduce((a, b) => a + b, 0) / lons.length;
  const M_PER_DEG_LAT = 111_320;
  const M_PER_DEG_LON = 111_320 * Math.cos((midLat * Math.PI) / 180);

  // Local metres east / north of centroid (math y-up)
  const local = ring.map(([lon, lat]) => [
    (lon - midLon) * M_PER_DEG_LON,
    (lat - midLat) * M_PER_DEG_LAT,
  ]);

  // polygon-offset wants CCW exterior; in math y-up, positive shoelace = CCW
  let area = 0;
  for (let i = 0; i < local.length; i++) {
    const a = local[i], b = local[(i + 1) % local.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const path = area < 0 ? [...local].reverse() : local;
  const first = path[0], last = path[path.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) path.push([first[0], first[1]]);

  let result;
  try {
    result = new Offset().data(path).padding(distanceM);
  } catch {
    return null;
  }
  if (!result || !result.length) return null;

  // Pick the largest sub-polygon when the inset disconnects
  let best = null, bestAbsArea = 0;
  for (const candidate of result) {
    if (!Array.isArray(candidate) || candidate.length < 3) continue;
    let a = 0;
    for (let i = 0; i < candidate.length; i++) {
      const p = candidate[i], q = candidate[(i + 1) % candidate.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    if (Math.abs(a) > bestAbsArea) { bestAbsArea = Math.abs(a); best = candidate; }
  }
  if (!best) return null;

  return best.map(([x, y]) => [
    midLon + x / M_PER_DEG_LON,
    midLat + y / M_PER_DEG_LAT,
  ]);
}

function addEsriLayer(viewer) {
  viewer.imageryLayers.add(new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      credit: new Cesium.Credit(
        'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      ),
      maximumLevel: 19,
    })
  ));
}

export default function CesiumView({ parcel, placements = [], products = [], setbacks }) {
  const containerRef = useRef(null);
  const viewerRef    = useRef(null);
  const [error, setError] = useState('');
  // Tracks when the viewer is created & ready for entity adds / fly-to. The
  // entity effect below depends on this so it runs AFTER the async viewer
  // setup completes (otherwise it fires once on mount, sees a null viewerRef,
  // and never runs again because parcel/placements don't change afterwards).
  const [viewerReady, setViewerReady] = useState(false);
  // Drag state — refs, not state, so mouse handlers don't cause re-renders
  const draggedIdxRef        = useRef(null);
  const buildingEntitiesRef  = useRef({});
  const buildingDimsRef      = useRef({});
  // Latest parcel ring — kept in a ref so the drag handler always sees
  // the current polygon without having to be torn down and rebuilt.
  const parcelRingRef        = useRef(null);
  // Cesium OSM Buildings tileset (surrounding neighborhood as extrusions)
  const tilesetRef           = useRef(null);
  // Terrain elevation sampled once per parcel — pitched roofs and trim
  // polylines need absolute heights (perPositionHeight can't combine with
  // HeightReference.RELATIVE_TO_GROUND) so we need a known ground level.
  const [terrainH, setTerrainH] = useState(null);
  const terrainHRef = useRef(null);
  useEffect(() => { terrainHRef.current = terrainH; }, [terrainH]);

  // Mount / unmount the Cesium viewer. Only once — we re-use the viewer
  // and swap entities when the parcel changes.
  useEffect(() => {
    if (!containerRef.current) return;
    let viewer;
    let cancelled = false;

    (async () => {
      try {
        // Boot the viewer with minimal options — we configure imagery and
        // terrain imperatively below so we're version-agnostic (the
        // `baseLayer` / `terrain` constructor options changed shape across
        // several Cesium releases and are finicky without an Ion default).
        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayerPicker:      false,
          geocoder:             false,
          homeButton:           false,
          timeline:             false,
          animation:            false,
          navigationHelpButton: false,
          sceneModePicker:      false,
          infoBox:              false,
          selectionIndicator:   false,
          fullscreenButton:     true,
        });
        if (cancelled) { viewer.destroy(); return; }
        // Publish the viewer ref IMMEDIATELY so the entity effect can use it
        // once React re-runs (via the viewerReady flip below).
        viewerRef.current = viewer;

        // Replace whatever default imagery Cesium loaded with our chosen layer
        viewer.imageryLayers.removeAll();
        if (ION_TOKEN) {
          try {
            const ionLayer = Cesium.ImageryLayer.fromProviderAsync(
              Cesium.createWorldImageryAsync()
            );
            viewer.imageryLayers.add(ionLayer);
          } catch (e) {
            // Fall through to Esri below
            addEsriLayer(viewer);
          }
        } else {
          addEsriLayer(viewer);
        }

        // Terrain — Cesium World Terrain when an Ion token is present so
        // entity heights resolve to real elevation. Flat ellipsoid otherwise.
        if (ION_TOKEN) {
          try {
            const terrainProvider = await Cesium.createWorldTerrainAsync({
              requestVertexNormals: true,
              requestWaterMask:     false,
            });
            if (!cancelled) viewer.scene.terrainProvider = terrainProvider;
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Cesium World Terrain unavailable:', e);
          }
        }

        // Surrounding neighborhood — Cesium OSM Buildings tileset: procedural
        // 3D extrusions of every OSM-mapped building worldwide. Much lighter
        // than Google's photogrammetry; renders as simple grey boxes but
        // avoids the "my lot floats in a flat desert" look.
        if (ION_TOKEN) {
          try {
            const tileset = await Cesium.createOsmBuildingsAsync();
            if (!cancelled) {
              viewer.scene.primitives.add(tileset);
              tilesetRef.current = tileset;
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Cesium OSM Buildings unavailable:', e);
          }
        }

        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.fog.enabled = false;
        viewer.scene.skyAtmosphere.show = true;
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 10;
        if (!cancelled) setViewerReady(true);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to initialize Cesium viewer.');
      }
    })();

    return () => {
      cancelled = true;
      try { viewer?.destroy?.(); } catch { /* ignore */ }
      viewerRef.current = null;
      tilesetRef.current = null;
      setViewerReady(false);
    };
  }, []);

  // Mouse-driven building drag — left-click a building, drag, release.
  // Position changes are local to the Cesium view (they don't persist back
  // to the SVG tabs' placements state).
  useEffect(() => {
    if (!viewerReady) return;
    const viewer = viewerRef.current;
    if (!viewer) return;

    const canvas = viewer.canvas;
    const scene  = viewer.scene;
    const handler = new Cesium.ScreenSpaceEventHandler(canvas);

    const pickBuildingIdx = (screenPos) => {
      const picked = scene.pick(screenPos);
      if (!Cesium.defined(picked)) return null;
      const id = picked.id?.id;
      if (typeof id !== 'string') return null;
      // Matches both "building-0" (wall) and "building-0-roof" (roof cap)
      const m = id.match(/^building-(\d+)/);
      if (!m) return null;
      const idx = parseInt(m[1], 10);
      return Number.isFinite(idx) ? idx : null;
    };

    const projectToSurface = (screenPos) => {
      // pickPosition uses the depth buffer — works on both terrain and 3D
      // tiles. Fall back to a ray/globe intersection if it misses.
      let pos = scene.pickPosition(screenPos);
      if (!Cesium.defined(pos)) {
        const ray = viewer.camera.getPickRay(screenPos);
        if (ray) pos = scene.globe.pick(ray, scene);
      }
      return pos;
    };

    handler.setInputAction((click) => {
      const idx = pickBuildingIdx(click.position);
      if (idx == null) return;
      draggedIdxRef.current = idx;
      scene.screenSpaceCameraController.enableInputs = false;
      canvas.style.cursor = 'grabbing';
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((movement) => {
      const idx = draggedIdxRef.current;
      if (idx == null) {
        // Idle hover — give the cursor a "grab" affordance over buildings
        const hover = pickBuildingIdx(movement.endPosition);
        canvas.style.cursor = hover != null ? 'grab' : '';
        return;
      }
      const pos = projectToSurface(movement.endPosition);
      if (!Cesium.defined(pos)) return;

      const carto = Cesium.Cartographic.fromCartesian(pos);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const dims = buildingDimsRef.current[idx];
      if (!dims) return;

      const M_PER_DEG_LAT = 111_320;
      const M_PER_DEG_LON = 111_320 * Math.cos((lat * Math.PI) / 180);
      const halfWDeg = (dims.widthM / 2) / M_PER_DEG_LON;
      const halfDDeg = (dims.depthM / 2) / M_PER_DEG_LAT;

      // Proposed corner positions as [lon, lat] pairs for containment test
      const cornersLL = [
        [lon - halfWDeg, lat + halfDDeg],
        [lon + halfWDeg, lat + halfDDeg],
        [lon + halfWDeg, lat - halfDDeg],
        [lon - halfWDeg, lat - halfDDeg],
      ];

      // Reject any move that would put a corner outside the parcel polygon
      const ring = parcelRingRef.current;
      if (ring && !cornersInsideRing(cornersLL, ring)) return;

      const parts = buildingEntitiesRef.current[idx];
      if (!parts) return;
      if (parts.model) {
        // GLB-based building — just move the model entity
        updateBuildingModel(parts, lon, lat);
      } else {
        // Polygon-based building — recompute spec and update each part
        const newSpec = buildingSpec({
          centerLon: lon,
          centerLat: lat,
          widthM:    dims.widthM,
          depthM:    dims.depthM,
          stories:   dims.stories ?? 1,
          heightM:   dims.heightM ?? ((dims.stories ?? 1) * STORY_HEIGHT_M + FOUNDATION_M),
          terrainH:  terrainHRef.current,
        });
        updateBuildingParts(parts, newSpec);
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    const endDrag = () => {
      if (draggedIdxRef.current == null) return;
      draggedIdxRef.current = null;
      scene.screenSpaceCameraController.enableInputs = true;
      canvas.style.cursor = '';
    };
    handler.setInputAction(endDrag, Cesium.ScreenSpaceEventType.LEFT_UP);

    return () => handler.destroy();
  }, [viewerReady]);

  // Keep the parcel ring fresh for the drag handler
  useEffect(() => {
    parcelRingRef.current = parcel?.ring ?? null;
  }, [parcel?.ring]);

  // Sample the terrain elevation under the parcel centroid once viewer &
  // parcel are ready. We rebuild the scene when the sample resolves so
  // pitched roofs / trim / window strips can use absolute heights.
  useEffect(() => {
    if (!viewerReady) return;
    if (parcel?.centerLat == null || parcel?.centerLon == null) return;
    const viewer = viewerRef.current;
    if (!viewer) return;

    let cancelled = false;
    (async () => {
      const tp = viewer.scene.terrainProvider;
      if (tp instanceof Cesium.EllipsoidTerrainProvider) {
        if (!cancelled) setTerrainH(0);
        return;
      }
      try {
        const samples = await Cesium.sampleTerrainMostDetailed(tp, [
          Cesium.Cartographic.fromDegrees(parcel.centerLon, parcel.centerLat),
        ]);
        const h = samples?.[0]?.height;
        if (!cancelled) setTerrainH(Number.isFinite(h) ? h : 0);
      } catch {
        if (!cancelled) setTerrainH(0);
      }
    })();
    return () => { cancelled = true; };
  }, [viewerReady, parcel?.centerLat, parcel?.centerLon]);

  // Rebuild parcel + building entities whenever the parcel changes (or the
  // viewer transitions into a ready state).
  useEffect(() => {
    if (!viewerReady) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!parcel?.ring || parcel.ring.length < 3) return;
    if (parcel.centerLat == null || parcel.centerLon == null) return;

    viewer.entities.removeAll();
    buildingEntitiesRef.current = {};
    buildingDimsRef.current     = {};

    // Parcel polygon — fill draped on the surface (terrain or ellipsoid) and
    // a matching polyline outline along the same vertices.
    const parcelPositions = Cesium.Cartesian3.fromDegreesArray(
      parcel.ring.flatMap(([lon, lat]) => [lon, lat])
    );
    const closedParcelPositions = [...parcelPositions, parcelPositions[0]];

    viewer.entities.add({
      id: 'parcel-fill',
      polygon: {
        hierarchy: parcelPositions,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        material: Cesium.Color.fromCssColorString('#ffde4d').withAlpha(0.2),
      },
    });
    viewer.entities.add({
      id: 'parcel-outline',
      polyline: {
        positions: closedParcelPositions,
        width: 4,
        clampToGround: true,
        material: Cesium.Color.fromCssColorString('#ffde4d'),
      },
    });

    // Setback line — same polygon-offset math as the SVG views so the line
    // matches across tabs. Uniform inset by max(front, rear, side) feet.
    if (setbacks) {
      const setbackFt = Math.max(
        setbacks.front ?? 0,
        setbacks.rear  ?? 0,
        setbacks.side  ?? 0
      );
      const setbackM = setbackFt * FT_TO_M;
      const insetRing = insetLatLngRing(parcel.ring, setbackM);
      if (insetRing && insetRing.length >= 3) {
        const closed = [...insetRing, insetRing[0]];
        viewer.entities.add({
          id: 'setback-outline',
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(
              closed.flatMap(([lon, lat]) => [lon, lat])
            ),
            width: 3,
            clampToGround: true,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#f59e0b'),
              dashLength: 16,
            }),
          },
        });
      }
    }

    // Proposed buildings — explicit base height = 0 + extrudedHeight = meters
    // above that. Works with or without terrain (no heightReference flags
    // that collapse the extrusion when terrain isn't loaded).
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const uniqueIds  = [...new Set(placements.map((p) => p.productId))];
    const colorIdx   = Object.fromEntries(uniqueIds.map((id, i) => [id, i % 6]));

    const lons = parcel.ring.map(([x]) => x);
    const lats = parcel.ring.map(([, y]) => y);
    const minLon = Math.min(...lons);
    const maxLat = Math.max(...lats);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const M_PER_DEG_LAT = 111_320;
    const M_PER_DEG_LON = 111_320 * Math.cos((midLat * Math.PI) / 180);

    placements.forEach((pl, i) => {
      const prod     = productMap[pl.productId];
      const stories  = prod?.stories ?? 1;
      const heightM  = stories * STORY_HEIGHT_M + FOUNDATION_M;
      const widthM   = pl.widthFt * FT_TO_M;
      const depthM   = pl.depthFt * FT_TO_M;
      const xOffsetM = (pl.xFt ?? 0) * FT_TO_M;
      const yOffsetM = (pl.yFt ?? 0) * FT_TO_M;

      const nwLon    = minLon + xOffsetM / M_PER_DEG_LON;
      const nwLat    = maxLat - yOffsetM / M_PER_DEG_LAT;
      const centerLon = nwLon + (widthM / 2) / M_PER_DEG_LON;
      const centerLat = nwLat - (depthM / 2) / M_PER_DEG_LAT;

      const color = productColor(colorIdx[pl.productId] ?? 0);
      const modelUrl = prod?.modelUrl?.trim();

      if (modelUrl) {
        // GLB path — replace the cream-box render with the product's 3D model
        const modelEntity = addBuildingModel(viewer, i, prod?.name || pl.productId, {
          centerLon, centerLat, modelUrl,
        });
        buildingEntitiesRef.current[i] = { model: modelEntity };
      } else {
        // Default polygon path (cream walls + pitched roof)
        const spec  = buildingSpec({
          centerLon, centerLat, widthM, depthM, stories, heightM, terrainH,
        });
        const parts = addBuildingParts(viewer, i, prod?.name || pl.productId, spec, color);
        buildingEntitiesRef.current[i] = parts;
      }
      buildingDimsRef.current[i] = { widthM, depthM, stories, heightM };
    });

    // Fly to the parcel — closer + shallower pitch makes 3D extrusions read.
    // Use the ground height under the centre so the camera frames the surface
    // rather than the ellipsoid hundreds of metres below. Sampling strategy:
    //   • Terrain provider loaded (OSM mode) → sampleTerrainMostDetailed
    //   • Google 3D tiles mode (no terrain)  → sampleHeightMostDetailed over
    //     the tileset. Needs a first pass to load tiles, so we fly twice:
    //     once to the lat/lng at an altitude guess, then re-fly with the
    //     sampled ground height once tiles have streamed in.
    const diagM = Math.sqrt((parcel.frontage ?? 100) ** 2 + (parcel.depth ?? 100) ** 2) * FT_TO_M;
    const range = Math.max(55, diagM * 1.6);

    const flyWithHeight = (baseHeight) => {
      const centre = Cesium.Cartesian3.fromDegrees(parcel.centerLon, parcel.centerLat, baseHeight);
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(centre, range / 2),
        {
          duration: 1.2,
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(30),
            Cesium.Math.toRadians(-25),
            range
          ),
        }
      );
    };

    (async () => {
      const terrainProvider = viewer.scene.terrainProvider;
      // Terrain-provider path (works for World Terrain)
      if (!(terrainProvider instanceof Cesium.EllipsoidTerrainProvider)) {
        try {
          const sampled = await Cesium.sampleTerrainMostDetailed(
            terrainProvider,
            [Cesium.Cartographic.fromDegrees(parcel.centerLon, parcel.centerLat)]
          );
          const h = sampled?.[0]?.height;
          flyWithHeight(Number.isFinite(h) ? h : 0);
        } catch { flyWithHeight(0); }
        return;
      }
      // 3D-tile path (Google). First fly with a guess so tiles start loading,
      // then ask the scene for the real height and re-fly.
      flyWithHeight(0);
      try {
        const carto = Cesium.Cartographic.fromDegrees(parcel.centerLon, parcel.centerLat);
        const sampled = await viewer.scene.sampleHeightMostDetailed([carto]);
        const h = sampled?.[0]?.height;
        if (Number.isFinite(h)) flyWithHeight(h);
      } catch { /* keep the initial fly */ }
    })();
  }, [viewerReady, parcel, placements, products, terrainH, setbacks]);

  if (!parcel?.centerLat || !parcel?.centerLon) {
    return (
      <div className="cesium-placeholder">
        <p>Load a parcel first — Regrid supplies the coordinates the globe needs.</p>
      </div>
    );
  }

  if (error) {
    return <div className="cesium-placeholder cesium-error">{error}</div>;
  }

  return (
    <div className="cesium-wrap">
      <div ref={containerRef} className="cesium-canvas" />
      {!ION_TOKEN && (
        <div className="cesium-hint">
          <strong>No 3D scenery:</strong> add <code>VITE_CESIUM_ION_TOKEN</code> to <code>.env</code> and reload to
          enable Cesium World Terrain + OSM Buildings (free at <a
            href="https://ion.cesium.com/tokens" target="_blank" rel="noreferrer"
            style={{ color: '#93c5fd' }}>ion.cesium.com/tokens</a>).
        </div>
      )}
    </div>
  );
}
