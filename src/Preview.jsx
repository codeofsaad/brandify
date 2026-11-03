import React, { useState } from 'react';
import { cssVars, selectedLogo } from './lib/render.js';
import { sampleColor } from './lib/screenshot.js';

// Series colors for secondary marks: categorical palette without the primary (which leads).
const series = (m) => m.palettes.categorical.filter((c) => c.toUpperCase() !== m.colors.primary.toUpperCase());

const BARS = [
  ['West', 82], ['East', 71], ['Central', 58], ['South', 44], ['Intl', 29],
];
const LINE_A = [38, 44, 41, 55, 62, 58, 71, 78];
const LINE_B = [30, 32, 38, 36, 44, 49, 47, 53];
const ROWS = [
  ['Enterprise', '$4.2M', '+12.4%', true],
  ['Mid-market', '$2.9M', '+3.1%', true],
  ['SMB', '$1.7M', '-4.8%', false],
];

function BarChart({ m }) {
  const w = 300, h = 150, pad = 24, bw = 34;
  const max = 100;
  const grid = m.shape.gridlines === 'minimal' ? [0] : [0, 25, 50, 75, 100];
  const step = (w - pad * 2) / BARS.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="pv-svg" role="img" aria-label="Sample bar chart">
      {grid.map((g) => {
        const y = h - pad - ((h - pad * 2) * g) / max;
        return <line key={g} x1={pad} x2={w - 8} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />;
      })}
      {BARS.map(([label, v], i) => {
        const bh = ((h - pad * 2) * v) / max;
        const x = pad + step * i + (step - bw) / 2;
        const fill = i === 0 ? 'var(--primary)' : series(m)[Math.min(i - 1, 5)];
        const r = m.shape.barRadius;
        return (
          <g key={label}>
            <path d={`M${x},${h - pad} V${h - pad - bh + r} Q${x},${h - pad - bh} ${x + r},${h - pad - bh} H${x + bw - r} Q${x + bw},${h - pad - bh} ${x + bw},${h - pad - bh + r} V${h - pad} Z`} fill={fill} opacity={i === 0 ? 1 : 0.9} />
            <text x={x + bw / 2} y={h - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ m }) {
  const w = 300, h = 150, pad = 24;
  const pts = (arr) => arr.map((v, i) => [pad + ((w - pad - 14) * i) / (arr.length - 1), h - pad - ((h - pad * 2) * v) / 100]);
  const path = (p) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const a = pts(LINE_A), b = pts(LINE_B);
  const grid = m.shape.gridlines === 'minimal' ? [0] : [0, 25, 50, 75, 100];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="pv-svg" role="img" aria-label="Sample line chart">
      {grid.map((g) => {
        const y = h - pad - ((h - pad * 2) * g) / 100;
        return <line key={g} x1={pad} x2={w - 8} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />;
      })}
      <path d={path(b)} fill="none" stroke={series(m)[0]} strokeWidth={m.shape.lineWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d={path(a)} fill="none" stroke="var(--primary)" strokeWidth={m.shape.lineWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={a.at(-1)[0]} cy={a.at(-1)[1]} r="3.5" fill="var(--primary)" />
      {['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => (
        <text key={q} x={pad + ((w - pad - 14) * (i * 2 + 1)) / 7} y={h - 8} fontSize="10" fill="var(--muted)" textAnchor="middle">{q}</text>
      ))}
    </svg>
  );
}

const ROLE_LABEL = { primary: 'Primary', accent: 'Accent', background: 'Background', surface: 'Surface', text: 'Text', textMuted: 'Muted text', border: 'Border', success: 'Success', warning: 'Warning', danger: 'Danger' };

export default function Preview({ m, shots = [], picking = null, onSample, onCancelPick }) {
  const [tab, setTab] = useState('app');
  // Picking a color jumps to the screenshot; if the screenshots go away, leave that tab.
  React.useEffect(() => { if (picking) setTab('shot'); }, [picking]);
  React.useEffect(() => { if (tab === 'shot' && !shots.length) setTab('app'); }, [shots.length, tab]);
  const logo = selectedLogo(m);
  return (
    <div className="preview-wrap">
      <div className="preview-head">
        <span className="eyebrow">Live preview</span>
        <div className="seg seg-sm">
          <button className={tab === 'app' ? 'on' : ''} onClick={() => setTab('app')}>Data app</button>
          {shots.length > 0 && <button className={tab === 'shot' ? 'on' : ''} onClick={() => setTab('shot')}>Your screenshot</button>}
        </div>
      </div>

      {tab === 'shot' && shots.length > 0 ? (
        <div className="site-shot">
          {picking && (
            <div className="pick-banner">
              Click the {ROLE_LABEL[picking] || picking} color in the screenshot. <button className="linkbtn" onClick={onCancelPick}>Cancel (Esc)</button>
            </div>
          )}
          {shots.map((s) => (
            <img
              key={s.id}
              src={s.dataUrl}
              alt={s.name}
              className={picking ? 'picking' : ''}
              onClick={async (e) => {
                if (!picking) return;
                const r = e.currentTarget.getBoundingClientRect();
                onSample(await sampleColor(s.dataUrl, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
              }}
            />
          ))}
        </div>
      ) : (
        <div className="pv" style={cssVars(m)}>
          <div className="pv-header">
            {logo ? <img src={logo.url} alt={m.company.name} className="pv-logo" /> : <strong className="pv-title">{m.company.name}</strong>}
            <span className="pv-nav">Overview</span>
            <span className="pv-nav muted">Regions</span>
            <span className="pv-nav muted">Accounts</span>
            <span className="pv-btn">Export</span>
          </div>
          <div className="pv-body">
            <div className="pv-h1">Revenue performance</div>
            <div className="pv-kpis">
              {[['Revenue', '$8.8M', '+8.2%', true], ['Orders', '12,480', '+3.4%', true], ['Churn', '2.1%', '-0.6%', false]].map(([l, v, d, up]) => (
                <div className="pv-card pv-kpi" key={l}>
                  <div className="pv-kpi-l">{l}</div>
                  <div className="pv-kpi-v">{v}</div>
                  <div className="pv-kpi-d" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>{up ? '▲' : '▼'} {d}</div>
                </div>
              ))}
            </div>
            <div className="pv-row">
              <div className="pv-card"><div className="pv-ct">Sales by region</div><BarChart m={m} /></div>
              <div className="pv-card"><div className="pv-ct">Quarterly trend</div><LineChart m={m} /></div>
            </div>
            <div className="pv-card">
              <div className="pv-ct">Segments</div>
              <table className="pv-table">
                <thead><tr><th>Segment</th><th>Revenue</th><th>vs. target</th></tr></thead>
                <tbody>
                  {ROWS.map(([s, r, d, up]) => (
                    <tr key={s}><td>{s}</td><td>{r}</td><td style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>{d}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pv-swatches">
              {m.palettes.categorical.map((c) => <span key={c} style={{ background: c }} title={c} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
