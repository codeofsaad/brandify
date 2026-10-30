import React, { useEffect, useRef, useState } from 'react';
import { readImageFile, LIMITS } from './lib/screenshot.js';

// Drop, paste (Cmd/Ctrl+V anywhere on the page) or browse for screenshots of the customer's existing app or slides.
// Images stay in the browser: nothing is uploaded.
export default function ReferenceDrop({ shots, onAdd, onRemove, compact = false, disabled = false }) {
  const [over, setOver] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef();

  const take = async (files) => {
    setErr('');
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return setErr('Drop an image file (PNG, JPG or WebP).');
    const room = LIMITS.MAX_FILES - shots.length;
    if (room <= 0) return setErr(`You can add up to ${LIMITS.MAX_FILES} screenshots. Remove one first.`);
    try {
      onAdd(await Promise.all(list.slice(0, room).map(readImageFile)));
    } catch (e) {
      setErr(e.message);
    }
  };

  // Pasting a copied screenshot works from anywhere on the page.
  useEffect(() => {
    if (disabled) return undefined;
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        take(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  return (
    <div className={`refdrop ${compact ? 'compact' : ''}`}>
      <div
        className={`dropzone ${over ? 'over' : ''} ${disabled ? 'off' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
        onClick={() => !disabled && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !disabled && input.current?.click()}
      >
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
        <div className="dz-icon" aria-hidden="true">＋</div>
        <b>{shots.length ? 'Add another screenshot' : 'Drop, paste or browse'}</b>
        <small>{shots.length ? `${shots.length} of ${LIMITS.MAX_FILES} added` : 'Press ⌘V to paste a copied screenshot. PNG, JPG or WebP.'}</small>
      </div>
      {shots.length > 0 && (
        <div className="thumbs">
          {shots.map((s) => (
            <div className="thumb" key={s.id} title={s.name}>
              <img src={s.dataUrl} alt={s.name} />
              <button aria-label={`Remove ${s.name}`} onClick={() => onRemove(s.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      {err && <div className="dz-err">{err}</div>}
      <p className="dz-note">Stays in your browser. It is never uploaded or saved, and it is not included in the design file.</p>
    </div>
  );
}
