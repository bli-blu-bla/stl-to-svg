import React, { useRef, useState } from 'react';
import { Upload } from './Icons.jsx';
import { MODEL_EXTENSIONS } from '../lib/model.js';

export default function Dropzone({ onFiles, maxFiles }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (list) => {
    const files = Array.from(list).filter((f) => MODEL_EXTENSIONS.test(f.name));
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
      <strong>Drop STL or 3MF files or browse</strong>
      <span className="hint">STL (binary or ASCII) or 3MF · up to {maxFiles} files · 100 MB each</span>
      <input
        ref={inputRef}
        type="file"
        accept=".stl,.3mf,model/stl,model/3mf"
        multiple
        className="sr-only"
        onChange={(e) => { pick(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
