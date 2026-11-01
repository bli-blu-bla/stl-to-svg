import React, { useRef, useState } from 'react';
import { Upload } from './Icons.jsx';

export default function Dropzone({ onFiles, maxFiles }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (list) => {
    const files = Array.from(list).filter((f) => /\.stl$/i.test(f.name));
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
    >
      <Upload />
      <strong>Drop STL files or browse</strong>
      <span className="hint">Binary or ASCII · up to {maxFiles} files · 100 MB each</span>
      <input
        ref={inputRef}
        type="file"
        accept=".stl,model/stl"
        multiple
        className="sr-only"
        onChange={(e) => { pick(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
