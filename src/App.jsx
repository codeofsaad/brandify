import React, { useEffect, useMemo, useRef, useState } from 'react';
import Preview from './Preview.jsx';
import { CompanyStep, ColorsStep, TypographyStep, ShapeStep, LogoStep, ReviewStep } from './steps.jsx';
import { synthesize, withDetected, derivePalettes, applyReferenceToModel, useWebsiteColors, brandfetchHasColor, collectLogos } from './lib/synthesize.js';
import { colorsFromLogos } from './lib/logoColors.js';
import { analyzeShots, sampleColor } from './lib/screenshot.js';
import { renderDesignMd, selectedLogo } from './lib/render.js';
import { fetchLogoAsset } from './lib/logo.js';
import { loadFont, ensureCatalog } from './lib/fonts.js';
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
  const [progress, setProgress] = useState(null); // { phase: 'brand' | 'site', startedAt, status, ahead }
  const skipRef = useRef(null);
  const [error, setError] = useState('');
  const [generatedMd, setGeneratedMd] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loadedBuild, setLoadedBuild] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [shots, setShots] = useState([]); // reference screenshots; kept in memory only, never uploaded
  const [picking, setPicking] = useState(null); // colour role being picked from a screenshot
  const [logoAssets, setLogoAssets] = useState({}); // keyed by logo URL: embedded copies of logos already fetched
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    ensureCatalog(); // font catalog loads quietly in the background; it is ready long before a pull finishes
  }, []);

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then((s) => { setLoadedBuild(s.build ?? null); }).catch(() => {});
  }, []);

  // A tab left open across a deploy keeps running old code (and would generate an out-of-date design file).
  // Compare the server's build id with the one this tab loaded, every minute and whenever the tab regains focus.
  useEffect(() => {
    if (!loadedBuild || loadedBuild === 'dev') return;
    const check = () =>
      fetch('/api/status', { cache: 'no-store' })
        .then((r) => r.json())
        .then((s) => s.build && s.build !== loadedBuild && setUpdateAvailable(true))
        .catch(() => {});
    const id = setInterval(check, 60000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [loadedBuild]);

  useEffect(() => {
    if (!confirmReset) return;
    const onKey = (e) => e.key === 'Escape' && setConfirmReset(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmReset]);

  const currentLogo = m ? selectedLogo(m) : null;
  useEffect(() => {
    if (!picking) return undefined;
    const onKey = (e) => e.key === 'Escape' && setPicking(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  const md = useMemo(() => (m ? renderDesignMd(m, { logoAsset: currentLogo ? logoAssets[currentLogo.url] : null }) : ''), [m, logoAssets]);
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
    const ctrl = new AbortController();
    skipRef.current = () => ctrl.abort();
    setProgress({ phase: 'brand', startedAt: Date.now() });
    try {
      const domain = input.includes('.') ? input : guessDomain(input);
      // 1) brand identity (fast)  2) website analysis (slow, runs as a background job you can skip)
      const data = await fetchJson('/api/brand', { domain });
      const fallback = data.fallback || null; // Brandfetch could not answer: the website supplies the name and logo
      setProgress({ phase: 'site', startedAt: Date.now(), status: 'queued', ahead: 0 });
      let siteData = await analyzeSite(
        { domain: data.brand.domain || domain, screenshotUrl: data.brand.screenshot?.url, identity: Boolean(fallback) },
        { signal: ctrl.signal, onProgress: (p) => setProgress((prev) => ({ ...prev, ...p })) },
      );
      if (ctrl.signal.aborted) {
        // Skipped: continue with Brandfetch data; its saved screenshot can be shown straight from the CDN.
        const shot = data.brand.screenshot?.url || null;
        siteData = { site: null, siteError: 'You skipped the website analysis', screenshot: shot, screenshotSource: shot ? 'brandfetch' : null };
      }
      if (fallback) {
        const found = siteData.identity;
        if (!found?.logos?.length && !siteData.site && !(siteData.icon || data.icon)) {
          throw new Error(`${FALLBACK_WHY[fallback.code] || FALLBACK_WHY.unavailable} The company website could not be read either (${siteData.siteError || 'no response'}). Upload a logo or screenshot, or enter the details manually.`);
        }
        // Simple Icons supplies the official brand colour and a clean mark; the website's own logos stay first.
        const icon = siteData.icon || data.icon || null;
        const siteLogos = found?.logos || [];
        const mark = icon && { type: 'symbol', theme: 'dark', formats: [{ format: 'svg', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon.svg)}` }], uploaded: false, fileName: `${icon.slug}-mark.svg` };
        data.icon = icon;
        data.brand = {
          ...data.brand,
          name: cleanSiteName(found?.name) || data.brand.name,
          description: found?.description || '',
          colors: icon ? [{ hex: icon.hex, type: 'brand', source: 'simpleicons' }] : [],
          logos: [...siteLogos.filter((l) => l.type === 'logo'), ...(mark ? [mark] : []), ...siteLogos.filter((l) => l.type !== 'logo')],
        };
      }
      await ensureCatalog();
      const reference = shots.length ? { analysis: await analyzeShots(shots) } : null;
      // Brandfetch has no real brand colour? Read the logo before falling back to the website.
      const logoColors = brandfetchHasColor(data.brand) ? [] : await colorsFromLogos(collectLogos(data.brand));
      const model = synthesize({ brand: data.brand, demo: data.demo, reference, logoColors, ...siteData });
      if (fallback) {
        model.fromWebsite = true;
        const where = data.icon ? `The brand color is the official one from Simple Icons${data.icon.title !== data.brand.name ? ` (matched to "${data.icon.title}")` : ''}; the name and logo were read from the company's website` : `The name, logo and colors were read from the company's website${logoColors.length ? ' and its logo' : ''}`;
        model.notes.unshift(`${FALLBACK_WHY[fallback.code] || FALLBACK_WHY.unavailable} ${where}, so check them carefully.`);
      }
      setM(withDetected(model));
      setGeneratedMd(null);
      setStep(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setProgress(null);
      skipRef.current = null;
    }
  }

  // Screenshot only: no company lookup. Everything comes from the image; fonts and shape stay at defaults.
  async function loadFromShots(name) {
    setLoading(true);
    setLoadingFor(name);
    setError('');
    setProgress({ phase: 'brand', startedAt: Date.now() });
    try {
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer';
      const brand = { name: name.trim(), domain: slug, description: '', colors: [], fonts: [], logos: [] };
      const reference = { analysis: await analyzeShots(shots) };
      await ensureCatalog();
      setM(withDetected(synthesize({ brand, demo: false, reference, screenshotOnly: true, screenshot: shots[0]?.dataUrl || null, screenshotSource: 'reference' })));
      setGeneratedMd(null);
      setStep(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  // Add or remove screenshots after a company is loaded (Colors step). New ones are analyzed and applied straight away.
  const addShotsLater = async (list) => {
    const next = [...shots, ...list].slice(0, 4);
    setShots(next);
    try {
      const analysis = await analyzeShots(next);
      update((n) => applyReferenceToModel(n, analysis));
    } catch (e) {
      setError(e.message);
    }
  };
  const removeShotLater = (id) => {
    setShots((prev) => prev.filter((x) => x.id !== id));
    setPicking(null);
  };
  const setColorSource = (src) =>
    update((n) => {
      if (src === 'website') useWebsiteColors(n);
      else if (n.reference) applyReferenceToModel(n, n.reference.analysis);
    });
  const onSample = (hex) => {
    if (picking) setColor(picking, hex);
    setPicking(null);
  };

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
      await ensureCatalog();
      const reference = shots.length ? { analysis: await analyzeShots(shots) } : null;
      const logoColors = !primary && logo ? await colorsFromLogos(collectLogos(brand)) : [];
      const model = synthesize({ brand, demo: false, reference, logoColors, ...siteData });
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
      if (key === 'primary' || key === 'accent') n.palettes = derivePalettes(n.colors, n.paletteContext);
    });
  const setPalette = (kind, i, hex) => update((n) => { n.palettes[kind][i] = hex; if (kind === 'categorical' && n.palettes.sources) n.palettes.sources[i] = 'edited'; });
  const regenPalettes = () => update((n) => { n.palettes = derivePalettes(n.colors, n.paletteContext); });
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
  const reset = () => setM((prev) => ({ ...prev.detected, detected: prev.detected }));

  const startOver = () => {
    setConfirmReset(false);
    setShots([]);
    setPicking(null);
    setM(null);
    setStep(0);
    setGeneratedMd(null);
    setError('');
    setLoading(false);
    setResetKey((k) => k + 1);
    window.scrollTo(0, 0);
  };

  const generate = async () => {
    setGenerating(true);
    try {
      let asset = currentLogo ? logoAssets[currentLogo.url] : null;
      if (currentLogo && !asset) {
        asset = await fetchLogoAsset(currentLogo);
        setLogoAssets((prev) => ({ ...prev, [currentLogo.url]: asset }));
      }
      setGeneratedMd(renderDesignMd(m, { logoAsset: asset }));
    } finally {
      setGenerating(false);
    }
  };
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
        <div className="topbar-r">{m && <button className="btn-over" onClick={() => setConfirmReset(true)}>Start over</button>}</div>
      </header>

      {updateAvailable && (
        <div className="update-banner" role="alert">
          <span><b>A new version of Brandify is available.</b> Reload before generating a design file, or it may be missing recent improvements (such as the embedded logo). Reloading clears the current company.</span>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload now</button>
        </div>
      )}

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

      {m && step > 0 && (
        <div className="co-strip" aria-label="Current company">
          <div className="co-chip">
            {m.logos.find((l) => l.kind === 'icon')?.url ? (
              <img src={m.logos.find((l) => l.kind === 'icon').url} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
            ) : (
              <span className="co-initial">{m.company.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="co-label">Branding for</span>
            <b>{m.company.name}</b>
            <small>{m.company.domain}</small>
          </div>
        </div>
      )}

      <div className={`shell ${step === 0 ? 'solo' : ''}`}>
        <main className="main">
          {step === 0 && <CompanyStep key={resetKey} onLoad={load} onManual={loadManual} onShotsOnly={loadFromShots} shots={shots} onAddShots={(l) => setShots((p) => [...p, ...l].slice(0, 4))} onRemoveShot={(id) => setShots((p) => p.filter((x) => x.id !== id))} loading={loading} error={error} status={loadingFor} progress={progress} onSkip={() => skipRef.current?.()} current={m} onContinue={() => setStep(1)} />}
          {m && step === 1 && <ColorsStep m={m} setColor={setColor} setPalette={setPalette} regenPalettes={regenPalettes} shots={shots} onSetColorSource={setColorSource} onAddShots={addShotsLater} onRemoveShot={removeShotLater} onPick={(k) => setPicking(picking === k ? null : k)} picking={picking} />}
          {m && step === 2 && <TypographyStep m={m} setFont={setFont} setTypo={setTypo} />}
          {m && step === 3 && <ShapeStep m={m} setShape={setShape} />}
          {m && step === 4 && <LogoStep m={m} setLogo={setLogo} addLogo={addLogo} />}
          {m && step === 5 && <ReviewStep m={m} md={generatedMd ?? md} generated={generatedMd != null} stale={stale} onReset={reset} />}
        </main>

        {step !== 0 && (
          <aside className="side">
            {m ? <Preview m={m} shots={shots} picking={picking} onSample={onSample} onCancelPick={() => setPicking(null)} /> : null}
          </aside>
        )}
      </div>

      <footer className="bar">
        <div className="bar-in">
          <span className="bar-step">{m ? `${m.company.name} · Step ${step + 1} of ${STEPS.length} · ${STEPS[step][0]}` : 'Add a company or a screenshot to begin'}</span>
          <div className="bar-r">
            <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
            {!last && <button className="btn btn-primary btn-lg" disabled={!m} onClick={() => setStep(step + 1)}>Next</button>}
            {last && isGenerated && <button className="btn btn-ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>}
            {last && (isGenerated ? (
              <button className="btn btn-primary btn-lg" onClick={download}>Download Design File</button>
            ) : (
              <button className="btn btn-primary btn-lg" disabled={!m || generating} onClick={generate}>{generating ? 'Generating…' : stale ? 'Regenerate Design File' : 'Generate Design File'}</button>
            ))}
          </div>
        </div>
      </footer>

      {confirmReset && (
        <div className="modal-backdrop" onClick={() => setConfirmReset(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="reset-title">Start over?</h2>
            <p>This clears {m ? <b>{m.company.name}</b> : 'the current company'} and any changes you made. Nothing you have already downloaded is affected.</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" autoFocus onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={startOver}>Start over</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FALLBACK_WHY = {
  no_credits: 'Brandfetch has no API credits left.',
  not_found: 'Brandfetch has no brand data for this company.',
  rate_limited: 'Brandfetch is rate limiting requests.',
  no_key: 'Brandfetch is not set up.',
  unavailable: 'Brandfetch could not be reached.',
};

// "Dunkin'®" -> "Dunkin'", "Nike.com" -> "Nike"
const cleanSiteName = (n) => String(n || '').replace(/[®™©]/g, '').replace(/\.(com|net|org|io|co)$/i, '').trim().slice(0, 60);

function guessDomain(name) {
  return `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`;
}
