import { useState, useCallback } from 'react'
import FileUpload from './components/FileUpload'
import ResultPanel from './components/ResultPanel'

interface ConversionState {
  loading: boolean
  downloadUrl: string | null
  fileName: string | null
  warnings: string[]
  error: string | null
  errorDetails: string | null
}

const INITIAL_STATE: ConversionState = {
  loading: false,
  downloadUrl: null,
  fileName: null,
  warnings: [],
  error: null,
  errorDetails: null,
}

export default function App() {
  const [state, setState] = useState<ConversionState>(INITIAL_STATE)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    // Revoke any previous blob URL to prevent memory leaks
    if (state.downloadUrl) {
      URL.revokeObjectURL(state.downloadUrl)
    }

    setSelectedFileName(file.name)
    setState({ ...INITIAL_STATE, loading: true })

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        let error = 'Conversion failed'
        let errorDetails: string | null = null
        try {
          const json = await res.json() as { error?: string; details?: string }
          error = json.error ?? error
          errorDetails = json.details ?? null
        } catch {
          errorDetails = `HTTP ${res.status} ${res.statusText}`
        }
        setState({ ...INITIAL_STATE, error, errorDetails })
        return
      }

      const blob = await res.blob()
      const downloadUrl = URL.createObjectURL(blob)

      // Parse warnings from response header
      const warningsHeader = res.headers.get('X-D2C-Warnings')
      let warnings: string[] = []
      if (warningsHeader) {
        try {
          warnings = JSON.parse(warningsHeader) as string[]
        } catch {
          // Ignore malformed header
        }
      }

      const baseName = file.name.replace(/\.(drawio|xml)$/i, '')
      setState({
        loading: false,
        downloadUrl,
        fileName: `${baseName}-terraform.zip`,
        warnings,
        error: null,
        errorDetails: null,
      })
    } catch (err) {
      setState({
        ...INITIAL_STATE,
        error: 'Network error',
        errorDetails: err instanceof Error ? err.message : 'Could not reach the conversion server.',
      })
    }
  }, [state.downloadUrl])

  const handleReset = () => {
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl)
    setState(INITIAL_STATE)
    setSelectedFileName(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-brand-50 flex items-start justify-center py-16 px-4">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-600 shadow-lg mb-4">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
            Draw.io → Terraform
          </h1>
          <p className="mt-2 text-gray-500 text-sm">
            Upload an AWS architecture diagram and download ready-to-use{' '}
            <code className="font-mono text-brand-600">.tf</code> files.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl ring-1 ring-black/5 p-6 flex flex-col gap-5">
          {/* Upload zone */}
          <div>
            <FileUpload onFile={handleFile} disabled={state.loading} />
            {selectedFileName && !state.loading && (
              <p className="mt-2 text-xs text-center text-gray-400">
                Selected: <span className="font-medium text-gray-600">{selectedFileName}</span>
              </p>
            )}
          </div>

          {/* Divider */}
          {(state.loading || state.downloadUrl || state.error) && (
            <hr className="border-gray-100" />
          )}

          {/* Result */}
          <ResultPanel
            downloadUrl={state.downloadUrl}
            fileName={state.fileName}
            warnings={state.warnings}
            error={state.error}
            errorDetails={state.errorDetails}
            loading={state.loading}
          />

          {/* Convert another */}
          {(state.downloadUrl || state.error) && (
            <button
              onClick={handleReset}
              className="self-center text-sm text-gray-400 hover:text-brand-600 transition-colors underline underline-offset-2"
            >
              Convert another diagram
            </button>
          )}
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-400">
          Supports Draw.io compressed &amp; plain XML · Generates HCL for Terraform ≥ 1.6
        </p>
      </div>
    </div>
  )
}
