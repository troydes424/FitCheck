import { useState } from 'react';

const PRODUCT_TYPES = ['Duplex', 'Triplex', 'Quadplex', 'Townhome', 'Apartment', 'Microunit'];

const FIELDS = [
  { key: 'name',           label: 'Name',                  type: 'text'     },
  { key: 'type',           label: 'Type',                  type: 'select'   },
  { key: 'units',          label: 'Units per building',    type: 'number'   },
  { key: 'stories',        label: 'Stories',               type: 'number'   },
  { key: 'footprintW',     label: 'Footprint width (ft)',  type: 'number'   },
  { key: 'footprintD',     label: 'Footprint depth (ft)',  type: 'number'   },
  { key: 'footprintSqFt',  label: 'Footprint sq ft',       type: 'number'   },
  { key: 'bedBath',        label: 'Beds / Baths',          type: 'text'     },
  { key: 'priceRange',     label: 'Est. price range',      type: 'text'     },
  { key: 'completionTime', label: 'Est. completion',       type: 'text'     },
  { key: 'description',    label: 'Description',           type: 'textarea' },
  { key: 'image',          label: 'Image URL',             type: 'text'     },
];

const NUM_KEYS = new Set(['units', 'stories', 'footprintW', 'footprintD', 'footprintSqFt']);

function blankProduct() {
  return {
    id: `product-${Date.now()}`,
    name: 'New Product',
    type: 'Duplex',
    units: 2,
    stories: 1,
    footprintW: 28,
    footprintD: 44,
    footprintSqFt: 1232,
    bedBath: '',
    description: '',
    image: '',
    priceRange: '',
    completionTime: '',
  };
}

export default function AdminPanel({ products, setProducts }) {
  const [expandedId, setExpandedId] = useState(null);

  function toggle(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function updateField(id, key, raw) {
    const value = NUM_KEYS.has(key) ? Number(raw) : raw;
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [key]: value } : p))
    );
  }

  function addProduct() {
    const p = blankProduct();
    setProducts((prev) => [...prev, p]);
    setExpandedId(p.id);
  }

  function removeProduct(id) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <button className="admin-add-btn" onClick={addProduct}>+ Add Product</button>
      </div>

      <div className="admin-list">
        {[...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
          <div key={p.id} className={`admin-card ${expandedId === p.id ? 'admin-card-open' : ''}`}>

            {/* ── Row header ── */}
            <div className="admin-card-header" onClick={() => toggle(p.id)}>
              <div className="admin-card-title">
                {p.image
                  ? <img src={p.image} alt="" className="admin-thumb" onError={(e) => { e.target.style.display = 'none'; }} />
                  : <div className="admin-thumb-placeholder" />
                }
                <div className="admin-card-meta">
                  <strong>{p.name || 'Unnamed'}</strong>
                  <span className="admin-type-tag">{p.type}</span>
                </div>
              </div>
              <div className="admin-card-actions">
                <button
                  className="admin-remove-btn"
                  onClick={(e) => { e.stopPropagation(); removeProduct(p.id); }}
                >
                  Remove
                </button>
                <span className="admin-chevron">{expandedId === p.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* ── Edit form ── */}
            {expandedId === p.id && (
              <div className="admin-form">
                <div className="admin-fields">
                  {FIELDS.map((f) => (
                    <div
                      className={`admin-field ${f.type === 'textarea' || f.key === 'image' ? 'admin-field-full' : ''}`}
                      key={f.key}
                    >
                      <label>{f.label}</label>

                      {f.type === 'textarea' && (
                        <textarea
                          value={p[f.key] ?? ''}
                          rows={2}
                          onChange={(e) => updateField(p.id, f.key, e.target.value)}
                        />
                      )}

                      {f.type === 'select' && (
                        <select
                          value={p[f.key] ?? ''}
                          onChange={(e) => updateField(p.id, f.key, e.target.value)}
                        >
                          {PRODUCT_TYPES.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}

                      {(f.type === 'text' || f.type === 'number') && (
                        <input
                          type={f.type}
                          value={p[f.key] ?? ''}
                          min={f.type === 'number' ? 0 : undefined}
                          onChange={(e) => updateField(p.id, f.key, e.target.value)}
                        />
                      )}
                    </div>
                  ))}
                </div>

                {p.image && (
                  <div className="admin-img-preview">
                    <img
                      src={p.image}
                      alt={p.name}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
