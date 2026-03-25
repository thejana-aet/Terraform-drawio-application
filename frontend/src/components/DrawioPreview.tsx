interface DrawioPreviewData {
  fileName: string
  sizeBytes: number
  pageNames: string[]
  sourcePreview: string
  isMxFile: boolean
}

interface DrawioPreviewProps {
  data: DrawioPreviewData
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function DrawioPreview({ data }: DrawioPreviewProps) {
  return (
    <div className="rounded-lg border border-gray-800 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Uploaded Draw.io Preview</h3>
          <p className="text-xs text-slate-600 mt-0.5 break-all">{data.fileName}</p>
        </div>
        <span className="text-xs px-2 py-1 rounded bg-white border border-gray-800 text-slate-700">
          {formatSize(data.sizeBytes)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-gray-800 bg-white px-3 py-2">
          <span className="text-slate-500">Format: </span>
          <span className="font-medium text-slate-700">{data.isMxFile ? 'mxfile' : 'mxGraphModel/XML'}</span>
        </div>
        <div className="rounded border border-gray-800 bg-white px-3 py-2">
          <span className="text-slate-500">Pages: </span>
          <span className="font-medium text-slate-700">{data.pageNames.length}</span>
        </div>
      </div>

      {data.pageNames.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-700 mb-1">Diagram pages</p>
          <div className="flex flex-wrap gap-1.5">
            {data.pageNames.map((name, idx) => (
              <span key={`${name}-${idx}`} className="text-xs px-2 py-1 rounded bg-brand-50 border border-brand-200 text-brand-700">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:text-brand-800">
          Show source preview
        </summary>
        <pre className="mt-2 max-h-56 overflow-auto rounded border border-gray-800 bg-white p-3 text-[11px] leading-relaxed text-slate-700">
          <code>{data.sourcePreview}</code>
        </pre>
      </details>
    </div>
  )
}
