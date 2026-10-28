import React, { useEffect, useMemo, useState } from 'react';
import Preview from './Preview.jsx';
import { CompanyStep, ColorsStep, TypographyStep, ShapeStep, LogoStep, ReviewStep } from './steps.jsx';
import { synthesize, withDetected, derivePalettes } from './lib/synthesize.js';
import { renderDesignMd } from './lib/render.js';
import { loadFont } from './lib/fonts.js';
import { fetchJson, analyzeSite } from './lib/api.js';

const TABLEAU_SYMBOL = 'https://cdn.brandfetch.io/id9sYMA_Im/theme/light/symbol.svg?c=1bxn5168vgovn2t5jgb34j594duYhJreifV';

const STEPS = [
  ['Company', 'Pick who to brand'],
  ['Colors', 'Palette and roles'],
  ['Typography', 'Fonts and case'],
  ['Shape & feel', 'Corners, depth, density'],
  ['Logo', 'Header mark'],
  ['Generate', 'Review and download'],
];

export default function App() {
  const [step, setStep] = useState(0);
  const [m, setM] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingFor, setLoadingFor] = useState('');
  const [error, setError] = useState('');
  const [generatedMd, setGeneratedMd] = useState(null);
  const [copied, setCopied] = useState(false);
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then((s) => setAnalysisEnabled(Boolean(s.analysisEnabled))).catch(() => {});
  }, []);

  const md = useMemo(() => (m ? renderDesignMd(m) : ''), [m]);
  const stale = generatedMd != null && generatedMd !== md;
  const isGenerated = generatedMd != null && !stale;

  useEffect(() => {
    if (!m) return;
    loadFont(m.typography.heading.family);
    loadFont(m.typography.body.family);
  }, [m?.typography.heading.family, m?.typography.body.family]);

  async function load(input) {
    setLoading(true);
    setLoadingFor(input);
    setError('');
    try {
      const domain = input.includes('.') ? input : guessDomain(input);
      // 1) brand identity (fast)  2) website analysis (slow, runs as a background job)
      const data = await fetchJson('/api/brand', { domain });
      const siteData = await analyzeSite({ domain: data.brand.domain || domain, screenshotUrl: data.brand.screenshot?.url });
      setM(withDetected(synthesize({ brand: data.brand, demo: data.demo, ...siteData })));
      setGeneratedMd(null);
      setStep(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Manual path: used when a company can't be pulled automatically.
  async function loadManual({ name, website, primary, logo }) {
    setLoading(true);
    setLoadingFor(name);
    setError('');
    try {
      const domain = website ? website.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const siteData = website ? await analyzeSite({ url: website }) : { site: null, siteError: null, screenshot: null, screenshotSource: null };
      const brand = {
        name: name.trim(),
        domain,
        description: '',
        colors: primary ? [{ hex: primary, type: 'brand' }] : [],
        fonts: [],
        logos: logo ? [{ type: 'logo', theme: 'dark', formats: [{ format: logo.format, src: logo.dataUrl }], uploaded: true, fileName: logo.name }] : [],
      };
      const model = synthesize({ brand, demo: false, ...siteData });
      if (primary) model.prov.primary = 'edited';
      model.notes.unshift('Entered manually; some values may be defaults.');
      setM(withDetected(model));
      setGeneratedMd(null);
      setStep(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const addLogo = (file) =>
    update((n) => {
      const id = `upload-${n.logos.length}`;
      n.logos.push({ id, kind: 'logo', theme: 'dark', format: file.format, url: file.dataUrl, pngUrl: file.dataUrl, uploaded: true, fileName: file.name });
      n.logoId = id;
    });

  // ----- edit actions (mark provenance as edited) -----
  const update = (fn) =>
    setM((prev) => {
      const { detected, ...rest } = prev;
      const next = structuredClone(rest);
      fn(next);
      return { ...next, detected };
    });

  const setColor = (key, hex) =>
    update((n) => {
      n.colors[key] = hex;
      n.prov[key] = 'edited';
      if (key === 'primary' || key === 'accent') n.palettes = derivePalettes(n.colors);
    });
  const setPalette = (kind, i, hex) => update((n) => { n.palettes[kind][i] = hex; });
  const regenPalettes = () => update((n) => { n.palettes = derivePalettes(n.colors); });
  const setFont = (role, family) =>
    update((n) => {
      n.typography[role].family = family;
      n.typography[role].isSubstitute = false;
      n.typography[role].source = 'edited';
      n.prov[`font-${role}`] = 'edited';
    });
  const setTypo = (role, p) => update((n) => { Object.assign(n.typography[role], p); });
  const setShape = (p) =>
    update((n) => {
      Object.assign(n.shape, p);
      if ('shadow' in p) n.shape.prov.shadow = 'edited';
      if ('density' in p) n.shape.prov.density = 'edited';
      if ('cardRadius' in p) n.shape.prov.radius = 'edited';
    });
  const setLogo = (id) => update((n) => { n.logoId = id; });
  const setCharacter = (p) => update((n) => { Object.assign(n.character, p); });
  const clearCharacter = () => { setAnalyzeError(''); update((n) => { n.character = null; }); };
  async function analyze() {
    setAnalyzing(true);
    setAnalyzeError('');
    try {
      const data = await fetchJson('/api/analyze', { domain: m.company.domain });
      update((n) => { n.character = data; });
    } catch (e) {
      setAnalyzeError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }
  const reset = () => setM((prev) => ({ ...prev.detected, detected: prev.detected }));

  const startOver = () => {
    if (!window.confirm('Start over? Your current company and any edits will be cleared.')) return;
    setM(null);
    setStep(0);
    setGeneratedMd(null);
    setError('');
    setAnalyzeError('');
    setLoading(false);
    setResetKey((k) => k + 1);
    window.scrollTo(0, 0);
  };

  const generate = () => setGeneratedMd(md);
  const download = () => {
    const blob = new Blob([generatedMd], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `design-${m.company.domain.replace(/\W+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(generatedMd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const canGo = (i) => i === 0 || Boolean(m);
  const last = step === STEPS.length - 1;

  return (
    <div className="app">
      <header className="topbar">
        <img src={TABLEAU_SYMBOL} alt="" className="brand-mark" />
        <div className="brand-t">
          <b>Brandify</b>
          <span>Design guides for Tableau Data Apps</span>
        </div>
        <div className="topbar-r">{m && <button className="btn-over" onClick={startOver}>Start over</button>}</div>
      </header>

      <section className="hero">
        <div className="hero-in">
          <h1>Make every Tableau Data App look like it belongs to your customer.</h1>
          <p>
            Brandify pulls a company’s logo, colors and fonts, studies how its website is built, and lets you fine-tune the result.
            Then it creates a design file. <b>After you download it, upload it to Claude when you create a data app</b> so the app matches that brand’s look and feel.
          </p>
        </div>
      </section>

      <nav className="flow" aria-label="Steps">
        <ol>
          {STEPS.map(([t], i) => (
            <li key={t} className={`${step === i ? 'on' : ''} ${i < step ? 'done' : ''}`}>
              <button disabled={!canGo(i)} onClick={() => setStep(i)}>
                <span className="dot">{i < step ? '✓' : i + 1}</span>
                <span className="flow-t">{t}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className={`shell ${step === 0 && !m ? 'solo' : ''}`}>
        <main className="main">
          {step === 0 && <CompanyStep key={resetKey} onLoad={load} onManual={loadManual} loading={loading} error={error} status={loadingFor} />}
          {m && step === 1 && <ColorsStep m={m} setColor={setColor} setPalette={setPalette} regenPalettes={regenPalettes} />}
          {m && step === 2 && <TypographyStep m={m} setFont={setFont} setTypo={setTypo} />}
          {m && step === 3 && <ShapeStep m={m} setShape={setShape} analysisEnabled={analysisEnabled} analyzing={analyzing} error={analyzeError} onAnalyze={analyze} setCharacter={setCharacter} clearCharacter={clearCharacter} />}
          {m && step === 4 && <LogoStep m={m} setLogo={setLogo} addLogo={addLogo} />}
          {m && step === 5 && <ReviewStep m={m} md={generatedMd ?? md} generated={generatedMd != null} stale={stale} onReset={reset} />}
        </main>

        {(m || step !== 0) && (
          <aside className="side">
            {m ? <Preview m={m} /> : null}
          </aside>
        )}
      </div>

      <footer className="bar">
        <div className="bar-in">
          <span className="bar-step">{m ? `Step ${step + 1} of ${STEPS.length} · ${STEPS[step][0]}` : 'Enter a company to begin'}</span>
          <div className="bar-r">
            <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
            {!last && <button className="btn btn-secondary" disabled={!m} onClick={() => setStep(step + 1)}>Next</button>}
            {isGenerated && <button className="btn btn-ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>}
            {isGenerated ? (
              <button className="btn btn-primary btn-lg" onClick={download}>Download Design File</button>
            ) : (
              <button className="btn btn-primary btn-lg" disabled={!m} onClick={generate}>{stale ? 'Regenerate Design File' : 'Generate Design File'}</button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

function guessDomain(name) {
  return `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`;
}
