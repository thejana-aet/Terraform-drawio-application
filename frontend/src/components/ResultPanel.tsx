interface ResultPanelProps {
  downloadUrl: string | null
  fileName: string | null
  error: string | null
  errorDetails: string | null
  loading: boolean
}

export default function ResultPanel({
  downloadUrl,
  fileName,
  error,
  errorDetails,
  loading,
}: ResultPanelProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-brand-600 animate-pulse">
        <svg
          className="w-10 h-10 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <p className="text-sm font-medium">Converting diagram…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
        <p className="font-semibold text-red-700">{error}</p>
        {errorDetails && (
          <p className="mt-1 text-red-500 break-words">{errorDetails}</p>
        )}
      </div>
    )
  }

  if (!downloadUrl) return null

  return (
    <div className="flex flex-col gap-4">
      {/* Download card */}
      <div className="flex items-center gap-4 rounded-xl border border-green-200 bg-green-50 p-4">
        <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-green-800 text-sm truncate">
            {fileName ?? 'terraform.zip'}
          </p>
          <p className="text-xs text-green-600 mt-0.5">
            Contains <code className="font-mono">main.tf</code>,{' '}
            <code className="font-mono">variables.tf</code>,{' '}
            <code className="font-mono">providers.tf</code>
          </p>
        </div>
        <a
          href={downloadUrl}
          download={fileName ?? 'terraform.zip'}
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </a>
      </div>

    </div>
  )
}
