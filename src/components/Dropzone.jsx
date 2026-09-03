import React, { useRef, useState } from 'react';

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
      <div className="icon">⬆</div>
      <div><strong>Drop STL files here</strong> or click to browse</div>
      <div className="hint">
        Maximum {maxFiles} files · binary and ASCII STL · everything is processed locally in your browser
      </div>
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
