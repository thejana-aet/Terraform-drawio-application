import { useState, useCallback } from 'react'
import FileUpload from './components/FileUpload'
import ResultPanel from './components/ResultPanel'
import FilePreview from './components/FilePreview'
import DrawioPreview from './components/DrawioPreview'

interface PreviewResource {
  type: string
  name: string
  label: string
}

interface PreviewData {
  resources: PreviewResource[]
  files: Record<string, string>
  warnings: string[]
}

type TerraformFormat = 'flat' | 'modular'

interface UploadedDrawioPreview {
  fileName: string
  sizeBytes: number
  pageNames: string[]
  sourcePreview: string
  isMxFile: boolean
}

interface ConversionState {
  loading: boolean
  downloadUrl: string | null
  fileName: string | null
  error: string | null
  errorDetails: string | null
}

const INITIAL_STATE: ConversionState = {
  loading: false,
  downloadUrl: null,
  fileName: null,
  error: null,
  errorDetails: null,
}

export default function App() {
  const [state, setState] = useState<ConversionState>(INITIAL_STATE)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [uploadedPreview, setUploadedPreview] = useState<UploadedDrawioPreview | null>(null)
  const [previewData, setPreviewData] = useState<PreviewData | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [terraformFormat, setTerraformFormat] = useState<TerraformFormat>('flat')

  const extractPageNames = (xmlLike: string): string[] => {
    const matches = [...xmlLike.matchAll(/<diagram\b[^>]*name="([^"]+)"[^>]*>/gi)]
    const names = matches.map((m) => m[1]?.trim()).filter((name): name is string => Boolean(name))
    return [...new Set(names)].slice(0, 20)
  }

  const buildUploadedPreview = async (file: File): Promise<UploadedDrawioPreview> => {
    const text = await file.text()
    const isMxFile = /<mxfile\b/i.test(text)
    const pageNames = extractPageNames(text)
    return {
      fileName: file.name,
      sizeBytes: file.size,
      pageNames,
      sourcePreview: text.slice(0, 9000),
      isMxFile,
    }
  }

  const handleFile = useCallback(async (file: File, requestedFormat?: TerraformFormat) => {
    // Revoke any previous blob URL to prevent memory leaks
    if (state.downloadUrl) {
      URL.revokeObjectURL(state.downloadUrl)
    }

    setSelectedFile(file)
    setSelectedFileName(file.name)
    setState({ ...INITIAL_STATE, loading: true })
    setPreviewData(null)

    try {
      const filePreview = await buildUploadedPreview(file)
      setUploadedPreview(filePreview)
    } catch {
      setUploadedPreview({
        fileName: file.name,
        sizeBytes: file.size,
        pageNames: [],
        sourcePreview: 'Could not read file contents for preview.',
        isMxFile: false,
      })
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      // First, get the preview
      const formatToUse = requestedFormat ?? terraformFormat
      const previewRes = await fetch(`/api/preview?format=${formatToUse}`, {
        method: 'POST',
        body: formData,
      })

      if (!previewRes.ok) {
        let error = 'Conversion failed'
        let errorDetails: string | null = null
        try {
          const json = await previewRes.json() as { error?: string; details?: string }
          error = json.error ?? error
          errorDetails = json.details ?? null
        } catch {
          errorDetails = `HTTP ${previewRes.status} ${previewRes.statusText}`
        }
        setState({ ...INITIAL_STATE, error, errorDetails })
        return
      }

      const preview = (await previewRes.json()) as any
      setPreviewData(preview)
      setState({
        loading: false,
        downloadUrl: null,
        fileName: null,
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
  }, [state.downloadUrl, terraformFormat])

  const handleDownload = useCallback(async () => {
    if (!selectedFile) return

    setIsDownloading(true)

    try {
      const uploadData = new FormData()
      uploadData.append('file', selectedFile)

      const res = await fetch(`/api/convert?format=${terraformFormat}`, {
        method: 'POST',
        body: uploadData,
      })

      if (!res.ok) {
        let error = 'Download failed'
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

      const baseName = selectedFile.name.replace(/\.(drawio|xml)$/i, '')
      const suffix = terraformFormat === 'modular' ? '-modular' : ''
      setState({
        loading: false,
        downloadUrl,
        fileName: `${baseName}-terraform${suffix}.zip`,
        error: null,
        errorDetails: null,
      })
      setPreviewData(null)
    } catch (err) {
      setState({
        ...INITIAL_STATE,
        error: 'Download error',
        errorDetails: err instanceof Error ? err.message : 'Failed to download file',
      })
    } finally {
      setIsDownloading(false)
    }
  }, [selectedFile, terraformFormat])

  const handleBackFromPreview = () => {
    setPreviewData(null)
    setState(INITIAL_STATE)
    setSelectedFile(null)
    setSelectedFileName(null)
    setUploadedPreview(null)
  }

  const handleReset = () => {
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl)
    setState(INITIAL_STATE)
    setSelectedFile(null)
    setSelectedFileName(null)
    setUploadedPreview(null)
    setPreviewData(null)
  }

  const formatLabel = terraformFormat === 'modular' ? 'modular' : 'flat'

  const handleFormatChange = useCallback((nextFormat: TerraformFormat) => {
    setTerraformFormat(nextFormat)
    if (selectedFile) {
      void handleFile(selectedFile, nextFormat)
    }
  }, [selectedFile, handleFile])

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
          {(!previewData && !state.downloadUrl) && (
            <>
              {/* Upload zone */}
              <div>
                <FileUpload onFile={handleFile} disabled={state.loading} loading={state.loading} />
                {selectedFileName && !state.loading && (
                  <p className="mt-2 text-xs text-center text-gray-400">
                    Selected: <span className="font-medium text-gray-600">{selectedFileName}</span>
                  </p>
                )}
              </div>

              {uploadedPreview && (
                <DrawioPreview data={uploadedPreview} />
              )}

              {/* Loading state */}
              {state.loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-sm text-gray-600">Converting diagram...</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Preview View */}
          {previewData && !state.downloadUrl && (
            <>
              <hr className="border-gray-100" />
              <FilePreview
                data={previewData}
                onDownload={handleDownload}
                onCancel={handleBackFromPreview}
                onFormatChange={handleFormatChange}
                format={terraformFormat}
                downloadFileName={selectedFileName
                  ? `${selectedFileName.replace(/\.(drawio|xml)$/i, '')}-terraform-${formatLabel}.zip`
                  : `terraform-${formatLabel}.zip`}
                loading={isDownloading}
              />
            </>
          )}

          {/* Result Panel */}
          {state.downloadUrl && (
            <>
              <hr className="border-gray-100" />
              <ResultPanel
                downloadUrl={state.downloadUrl}
                fileName={state.fileName}
                error={state.error}
                errorDetails={state.errorDetails}
                loading={state.loading}
              />
            </>
          )}

          {/* Error state */}
          {state.error && !state.downloadUrl && !previewData && (
            <>
              <hr className="border-gray-100" />
              <ResultPanel
                downloadUrl={null}
                fileName={null}
                error={state.error}
                errorDetails={state.errorDetails}
                loading={false}
              />
            </>
          )}

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
