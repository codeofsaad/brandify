import React, { useEffect, useRef, useState } from 'react';
import { cssStack, loadFont, fontGroups, matchFonts } from './lib/fonts.js';
import { contrast } from './lib/color.js';
import { derivePalettes } from './lib/synthesize.js';
import { selectedLogo } from './lib/render.js';

const PROV_LABEL = { brandfetch: 'Brandfetch', measured: 'Measured on site', derived: 'Derived', default: 'Default', edited: 'Edited' };
export const Badge = ({ kind }) => (kind ? <span className={`badge badge-${kind}`}>{PROV_LABEL[kind] || kind}</span> : null);

function StepHead({ n, title, children }) {
  return (
    <div className="step-head">
      <div className="step-n">{n}</div>
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, unit = 'px', onChange }) {
  return (
    <label className="slider">
      <span className="slider-l">{label}<b>{value}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/* ---------- 1. Company ---------- */

// Reads an uploaded logo into a data URL (kept in the browser; never sent to a server).
export function readLogoFile(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) return reject(new Error('Use a PNG, JPG, SVG or WebP image.'));
    if (file.size > 2 * 1024 * 1024) return reject(new Error('Logo must be under 2 MB.'));
    const fr = new FileReader();
    fr.onload = () => resolve({ dataUrl: fr.result, format: file.type.includes('svg') ? 'svg' : file.type.split('/')[1].replace('jpeg', 'jpg'), name: file.name });
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.readAsDataURL(file);
  });
}

function ManualForm({ onManual, loading }) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [primary, setPrimary] = useState('');
  const [logo, setLogo] = useState(null);
  const [err, setErr] = useState('');
  const validColor = !primary || /^#[0-9a-fA-F]{6}$/.test(primary);

  async function pick(e) {
    setErr('');
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setLogo(await readLogoFile(f));
    } catch (x) {
      setErr(x.message);
    }
  }

  return (
    <div className="manual">
      <div className="manual-grid">
        <label className="field">
          <span className="lbl">Company name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
        </label>
        <label className="field">
          <span className="lbl">Website <em>(we’ll analyze its look and feel)</em></span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" />
        </label>
        <label className="field">
          <span className="lbl">Main brand color <em>(optional)</em></span>
          <span className="color-in">
            <input type="color" value={validColor && primary ? primary : '#0176D3'} onChange={(e) => setPrimary(e.target.value.toUpperCase())} />
            <input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="#0176D3" spellCheck={false} />
          </span>
        </label>
        <div className="field">
          <span className="lbl">Logo <em>(optional)</em></span>
          <label className="upload">
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={pick} />
            {logo ? <><img src={logo.dataUrl} alt="" /><span>{logo.name}</span></> : <span>Upload PNG, SVG or JPG</span>}
          </label>
        </div>
      </div>
      {err && <div className="alert">{err}</div>}
      <button className="btn btn-primary" disabled={loading || name.trim().length < 2 || !validColor} onClick={() => onManual({ name, website, primary: primary || null, logo })}>
        {loading ? 'Working…' : 'Continue with these details'}
      </button>
    </div>
  );
}

// Shows which stage the pull is in, how long it has taken, and (when the website is slow) lets the user skip it.
function LoadingCard({ status, progress, onSkip }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const siteSecs = progress?.phase === 'site' ? Math.floor((now - progress.startedAt) / 1000) : 0;
  let line = 'Fetching brand data…';
  if (progress?.phase === 'site') {
    line =
      progress.status === 'queued' && progress.ahead > 0
        ? `Waiting for ${progress.ahead} other website ${progress.ahead === 1 ? 'analysis' : 'analyses'} to finish…`
        : 'Opening the website and measuring its buttons, cards and type…';
  }
  return (
    <div className="loading-card">
      <div className="spinner" />
      <div className="loading-body">
        <b>Studying {status}…</b>
        <p>{line}{progress?.phase === 'site' ? ` ${siteSecs}s` : ''}</p>
        {progress?.phase === 'site' && siteSecs >= 20 && (
          <p className="slow-hint">
            This site is taking longer than usual.{' '}
            <button className="linkbtn" onClick={onSkip}>Skip the website analysis and continue</button>
            {' '}(you'll still get the logo, colors and fonts from Brandfetch).
          </p>
        )}
      </div>
    </div>
  );
}

export function CompanyStep({ onLoad, onManual, loading, error, status, current, onContinue, progress, onSkip }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [manual, setManual] = useState(false);
  const timer = useRef();

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) return setResults([]);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        setResults(await r.json());
      } catch {
        setResults([]);
      }
    }, 220);
    return () => clearTimeout(timer.current);
  }, [q]);

  const submit = (v) => {
    const t = v.trim();
    if (t) onLoad(t);
  };

  return (
    <section className="panel">
      <StepHead n="1" title="Which company are we branding for?">
        We’ll pull their logo, colors and fonts, then study their website.
      </StepHead>

      {current && !loading && (
        <div className="current-co">
          <div>
            <span className="lbl">Currently loaded</span>
            <b>{current.company.name}</b>
            <small>Pull a different company below to replace it, or keep editing this one.</small>
          </div>
          <button className="btn btn-secondary" onClick={onContinue}>Continue editing</button>
        </div>
      )}

      <div className="search">
        <input
          autoFocus
          value={q}
          placeholder="Enter the company name"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit(results[0]?.domain || q)}
          disabled={loading}
        />
        <button className="btn btn-primary" disabled={loading || q.trim().length < 2} onClick={() => submit(results[0]?.domain || q)}>
          {loading && !manual ? 'Analyzing…' : 'Pull branding'}
        </button>
      </div>

      {results.length > 0 && !loading && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.domain}>
              <button onClick={() => submit(r.domain)}>
                {r.icon ? <img src={r.icon} alt="" /> : <span className="ph" />}
                <span><b>{r.name}</b><small>{r.domain}{r.demo ? ' · demo data' : ''}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {loading && <LoadingCard status={status} progress={progress} onSkip={onSkip} />}

      {error && (
        <div className="alert">
          {error}
          {!manual && <button className="linkbtn" onClick={() => setManual(true)}>Enter the details manually</button>}
        </div>
      )}

      <div className="manual-toggle">
        <button className="linkbtn" onClick={() => setManual(!manual)} aria-expanded={manual}>
          {manual ? 'Hide manual entry' : 'Can’t find the company? Enter a website, logo and color manually'}
        </button>
      </div>
      {manual && <ManualForm onManual={onManual} loading={loading} />}
    </section>
  );
}

/* ---------- 2. Colors ---------- */

const ROLES = [
  ['primary', 'Primary', 'Buttons, selected state, lead series'],
  ['accent', 'Accent', 'Highlights and callouts'],
  ['background', 'Background', 'Page background'],
  ['surface', 'Surface', 'Cards and tiles'],
  ['text', 'Text', 'Titles and body'],
  ['textMuted', 'Muted text', 'Axis labels, captions'],
  ['border', 'Border', 'Dividers and gridlines'],
  ['success', 'Success', 'Positive change'],
  ['warning', 'Warning', 'Caution'],
  ['danger', 'Danger', 'Negative change'],
];

function Swatch({ hex, onChange, label }) {
  return (
    <label className="swatch" style={{ background: hex }} title={label}>
      <input type="color" value={hex.slice(0, 7)} onChange={(e) => onChange(e.target.value.toUpperCase())} />
    </label>
  );
}

const SOURCE_LABEL = { brand: 'Brand', site: 'Website', derived: 'Derived', neutral: 'Neutral', edited: 'Edited' };

function PaletteStrip({ title, hint, colors, onEdit, sources }) {
  return (
    <div className="pal">
      <div className="pal-t"><b>{title}</b><span>{hint}</span></div>
      <div className="pal-strip">
        {colors.map((c, i) => (
          <div key={i} className="pal-cell">
            <Swatch hex={c} label={c} onChange={(v) => onEdit(i, v)} />
            {sources && <small className={`pal-src pal-src-${sources[i]}`}>{SOURCE_LABEL[sources[i]] || ''}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ColorsStep({ m, setColor, setPalette, regenPalettes }) {
  return (
    <section className="panel">
      <StepHead n="2" title="Colors">
        Here’s what we found. Click any swatch to change it. Each value shows where it came from.
      </StepHead>

      <div className="roles">
        {ROLES.map(([key, label, use]) => {
          const bg = key === 'text' || key === 'textMuted' || key === 'border' ? m.colors.surface : m.colors.surface;
          const cr = ['text', 'textMuted', 'primary', 'accent', 'success', 'warning', 'danger'].includes(key) ? contrast(m.colors[key], bg) : null;
          return (
            <div className="role" key={key}>
              <Swatch hex={m.colors[key]} label={label} onChange={(v) => setColor(key, v)} />
              <div className="role-main">
                <div className="role-t"><b>{label}</b><Badge kind={m.prov[key]} /></div>
                <small>{use}</small>
              </div>
              <input
                className="hex"
                value={m.colors[key]}
                onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && setColor(key, e.target.value.toUpperCase())}
                spellCheck={false}
              />
              {cr != null && <span className={`cr ${cr >= 4.5 ? 'ok' : 'bad'}`} title="Contrast against the surface color">{cr.toFixed(1)}:1</span>}
            </div>
          );
        })}
      </div>

      {m.alternatives.primary.length > 0 && (
        <div className="alt">
          Brandfetch lists a different primary:{' '}
          {m.alternatives.primary.map((a) => (
            <button key={a.hex} className="chip" onClick={() => setColor('primary', a.hex)}>
              <i style={{ background: a.hex }} /> {a.hex}
            </button>
          ))}
          <small>We prefer the color actually used on the live site.</small>
        </div>
      )}

      <div className="section-t">
        <h3>Chart palettes</h3>
        <button className="btn btn-ghost" onClick={regenPalettes}>Regenerate from primary + accent</button>
      </div>
      <PaletteStrip title="Categorical" hint="Unordered categories. Brand and Website colors are real; Derived ones harmonize with them." colors={m.palettes.categorical} sources={m.palettes.sources} onEdit={(i, v) => setPalette('categorical', i, v)} />
      <PaletteStrip title="Sequential" hint="Low → high magnitude" colors={m.palettes.sequential} onEdit={(i, v) => setPalette('sequential', i, v)} />
      <PaletteStrip title="Diverging" hint="Negative → positive around a midpoint" colors={m.palettes.diverging} onEdit={(i, v) => setPalette('diverging', i, v)} />
    </section>
  );
}

/* ---------- 3. Typography ---------- */

function FontCard({ role, label, f, uppercase, onFamily, onWeight }) {
  useEffect(() => loadFont(f.family), [f.family]);
  const suggestions = f.suggestions || (f.isSubstitute ? matchFonts({ name: f.brandName, role, weight: f.weight, uppercase }) : []);
  useEffect(() => { suggestions.forEach((x) => loadFont(x.family)); }, [suggestions.map((x) => x.family).join('|')]);
  // Short list of familiar fonts; the current font and the closest matches are pinned on top.
  const groups = fontGroups([f.family, ...suggestions.map((x) => x.family)]);
  return (
    <div className="font-card">
      <div className="font-t"><b>{label}</b><Badge kind={f.source} /></div>
      <ol className="font-steps">
        <li>
          <span>Found</span>
          <div>
            <b>{f.brandName || 'No font detected'}</b>
            {f.isSubstitute && <em className="warn">Custom brand font, not available on the web</em>}
            {!f.isSubstitute && f.brandName && <em className="ok-t">Available on Google Fonts</em>}
          </div>
        </li>
        <li>
          <span>Using</span>
          <select value={f.family} onChange={(e) => onFamily(e.target.value)}>
            {groups.map(([group, list]) => (
              <optgroup key={group} label={group}>{list.map((o) => <option key={o}>{o}</option>)}</optgroup>
            ))}
          </select>
        </li>
        <li>
          <span>Weight</span>
          <select value={f.weight} onChange={(e) => onWeight(Number(e.target.value))}>
            {[300, 400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </li>
      </ol>
      {suggestions.length > 0 && (
        <div className="matches">
          <span className="lbl">Closest free matches</span>
          {suggestions.map((x) => (
            <button key={x.family} className={`match ${x.family === f.family ? 'on' : ''}`} onClick={() => onFamily(x.family)}>
              <span className="match-sample" style={{ fontFamily: cssStack(x.family), fontWeight: f.weight, textTransform: uppercase ? 'uppercase' : 'none' }}>
                {role === 'heading' ? 'Revenue grew' : 'Readable body text'}
              </span>
              <small>{x.family} · {x.reason}</small>
            </button>
          ))}
        </div>
      )}
      {f.alternatives?.length > 0 && (
        <div className="alts">Also seen: {f.alternatives.map((a) => `${a.name} (${a.source})`).join(', ')}</div>
      )}
    </div>
  );
}

export function TypographyStep({ m, setFont, setTypo }) {
  const h = m.typography.heading;
  return (
    <section className="panel">
      <StepHead n="3" title="Typography">
        These are the fonts the brand uses. Custom fonts can’t be used in web apps, so we suggest the closest Google Font. Change either one and the preview updates.
      </StepHead>
      <div className="fonts">
        <FontCard role="heading" label="Headings" f={h} uppercase={h.transform === 'uppercase'} onFamily={(v) => setFont('heading', v)} onWeight={(v) => setTypo('heading', { weight: v })} />
        <FontCard role="body" label="Body and chart labels" f={m.typography.body} onFamily={(v) => setFont('body', v)} onWeight={(v) => setTypo('body', { weight: v })} />
      </div>
      <div className="row-controls">
        <div>
          <span className="lbl">Heading case</span>
          <Segmented value={h.transform} options={[['none', 'Sentence case'], ['uppercase', 'UPPERCASE']]} onChange={(v) => setTypo('heading', { transform: v })} />
        </div>
        <Slider label="Heading letter-spacing" value={h.tracking} min={-0.06} max={0.2} step={0.01} unit="em" onChange={(v) => setTypo('heading', { tracking: v })} />
      </div>
      <div className="type-sample" style={{ fontFamily: cssStack(m.typography.body.family) }}>
        <div style={{ fontFamily: cssStack(h.family), fontWeight: h.weight, textTransform: h.transform, letterSpacing: `${h.tracking}em`, fontSize: 30, lineHeight: 1.1 }}>
          Revenue grew 8% this quarter
        </div>
        <p style={{ fontWeight: m.typography.body.weight }}>West and East regions drove most of the gain, while SMB retention softened. Body copy and chart labels use this font.</p>
      </div>
    </section>
  );
}

/* ---------- 4. Shape & feel ---------- */

function CharacterCard({ m, analysisEnabled, analyzing, error, onAnalyze, setCharacter, clearCharacter }) {
  const c = m.character;
  const field = (key, label) => (
    <label className="char-f">
      <span className="lbl">{label}</span>
      <textarea rows={2} value={c[key]} onChange={(e) => setCharacter({ [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="char-card">
      <div className="char-head">
        <div>
          <h3>Visual character <span className="opt">Optional</span></h3>
          <p>Claude looks at a screenshot of their website and describes the mood, imagery and decorative style that CSS can’t measure. The result is added to the design file as extra rules.</p>
        </div>
        {!c && (
          <button className="btn btn-secondary" disabled={!analysisEnabled || analyzing || !m.screenshot} onClick={onAnalyze}>
            {analyzing ? 'Analyzing…' : 'Analyze with Claude'}
          </button>
        )}
        {c && <button className="btn btn-ghost" onClick={clearCharacter}>Remove</button>}
      </div>
      {!analysisEnabled && !c && <div className="hint">Off by default. To enable it, add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart the app.</div>}
      {analysisEnabled && !m.screenshot && !c && <div className="hint">No website screenshot is available for this company.</div>}
      {error && <div className="alert">{error}</div>}
      {c && (
        <div className="char-fields">
          {field('mood', 'Mood')}
          {field('imagery', 'Imagery')}
          {field('decoration', 'Decorative devices')}
          {field('rhythm', 'Layout rhythm')}
          <label className="char-f char-wide">
            <span className="lbl">Dashboard rules (one per line)</span>
            <textarea rows={5} value={c.rules.join('\n')} onChange={(e) => setCharacter({ rules: e.target.value.split('\n') })} />
          </label>
        </div>
      )}
    </div>
  );
}

export function ShapeStep({ m, setShape, ...characterProps }) {
  const s = m.shape;
  return (
    <section className="panel">
      <StepHead n="4" title="Shape and feel">
        Measured from the company’s own buttons, cards and spacing. This is what makes the app feel like them, not just look like them.
      </StepHead>
      <div className="feel-grid">
        <Slider label="Card corner radius" value={s.cardRadius} min={0} max={24} onChange={(v) => setShape({ cardRadius: v })} />
        <Slider label="Button corner radius" value={Math.min(s.buttonRadius, 24)} min={0} max={24} onChange={(v) => setShape({ buttonRadius: v })} />
        <Slider label="Border width" value={s.borderWidth} min={0} max={3} onChange={(v) => setShape({ borderWidth: v })} />
        <Slider label="Bar corner radius" value={s.barRadius} min={0} max={12} onChange={(v) => setShape({ barRadius: v })} />
        <div>
          <span className="lbl">Elevation <Badge kind={s.prov.shadow} /></span>
          <Segmented value={s.shadow} options={[['none', 'Flat'], ['soft', 'Soft'], ['medium', 'Raised']]} onChange={(v) => setShape({ shadow: v })} />
        </div>
        <div>
          <span className="lbl">Density <Badge kind={s.prov.density} /></span>
          <Segmented value={s.density} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]} onChange={(v) => setShape({ density: v })} />
        </div>
        <div>
          <span className="lbl">Chart gridlines</span>
          <Segmented value={s.gridlines} options={[['minimal', 'Minimal'], ['light', 'Light']]} onChange={(v) => setShape({ gridlines: v })} />
        </div>
        <Slider label="Line weight" value={s.lineWidth} min={1} max={4} onChange={(v) => setShape({ lineWidth: v })} />
      </div>
      <CharacterCard m={m} {...characterProps} />
    </section>
  );
}

/* ---------- 5. Logo ---------- */

export function LogoStep({ m, setLogo, addLogo }) {
  const [err, setErr] = useState('');
  async function pick(e) {
    setErr('');
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      addLogo(await readLogoFile(f));
    } catch (x) {
      setErr(x.message);
    }
  }
  return (
    <section className="panel">
      <StepHead n="5" title="Logo">
        Pick the mark for the app header, or upload your own. Dark marks sit on a light background; light marks on a dark one.
      </StepHead>
      {m.logos.length === 0 && <div className="alert">No logos were found for this brand. Upload one below.</div>}
      <div className="logos">
        {m.logos.map((l) => (
          <button key={l.id} className={`logo-tile ${m.logoId === l.id ? 'on' : ''}`} onClick={() => setLogo(l.id)}>
            <span className={`logo-bg ${l.theme === 'light' ? 'dk' : ''}`}><img src={l.url} alt={`${l.kind} (${l.theme})`} /></span>
            <small>{l.uploaded ? `Uploaded · ${l.fileName || 'logo'}` : `${l.kind} · ${l.theme === 'light' ? 'for dark bg' : 'for light bg'} · ${l.format}`}</small>
          </button>
        ))}
        <label className="logo-tile logo-add">
          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={pick} />
          <span className="logo-bg"><b>+</b></span>
          <small>Upload your own logo</small>
        </label>
      </div>
      {err && <div className="alert">{err}</div>}
    </section>
  );
}

/* ---------- 6. Review ---------- */

export function ReviewStep({ m, md, generated, stale, onReset }) {
  const logo = selectedLogo(m);
  return (
    <section className="panel">
      <StepHead n="6" title="Review and generate">
        Check the summary, then press <b>Generate Design File</b> below. You can go back to any step and change things, then regenerate.
      </StepHead>
      <div className="summary">
        <div><span>Company</span><b>{m.company.name}</b></div>
        <div><span>Primary / Accent</span><b><i style={{ background: m.colors.primary }} />{m.colors.primary} <i style={{ background: m.colors.accent }} />{m.colors.accent}</b></div>
        <div><span>Fonts</span><b>{m.typography.heading.family} / {m.typography.body.family}</b></div>
        <div><span>Corners · Elevation</span><b>{m.shape.cardRadius}px · {m.shape.shadow}</b></div>
        <div><span>Density</span><b>{m.shape.density}</b></div>
        <div><span>Logo</span><b>{logo ? `${logo.kind} (${logo.format})` : 'none'}</b></div>
      </div>
      {m.notes.length > 0 && (
        <ul className="notes">{m.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
      <div className="section-t">
        <h3>{generated ? (stale ? 'Design file (out of date, regenerate)' : 'Design file') : 'Design file preview'}</h3>
        <button className="btn btn-ghost" onClick={onReset}>Reset all to detected</button>
      </div>
      {generated && !stale && (
        <div className="next-hint"><b>Next:</b> click <b>Download Design File</b>, then upload it to Claude when you create your data app.</div>
      )}
      <pre className={`md ${generated && !stale ? '' : 'dim'}`}>{md}</pre>
    </section>
  );
}
