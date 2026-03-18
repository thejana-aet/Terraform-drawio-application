import { useEffect, useState } from 'react'

interface Resource {
  type: string
  name: string
  label: string
}

interface PreviewData {
  resources: Resource[]
  files: Record<string, string>
  warnings: string[]
}

type TerraformFormat = 'flat' | 'modular'

interface FilePreviewProps {
  data: PreviewData
  onDownload: () => void
  onCancel: () => void
  onFormatChange: (format: TerraformFormat) => void
  format: TerraformFormat
  downloadFileName: string
  loading?: boolean
}

export default function FilePreview({
  data,
  onDownload,
  onCancel,
  onFormatChange,
  format,
  downloadFileName,
  loading = false,
}: FilePreviewProps) {
  const fileNames = Object.keys(data.files).sort((a, b) => a.localeCompare(b))
  const [activeTab, setActiveTab] = useState<string>('resources')
  const [copiedFile, setCopiedFile] = useState<string | null>(null)

  useEffect(() => {
    if (activeTab !== 'resources' && !(activeTab in data.files)) {
      setActiveTab('resources')
    }
  }, [activeTab, data.files])

  const copyToClipboard = (text: string, fileName: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedFile(fileName)
      setTimeout(() => setCopiedFile(null), 2000)
    })
  }

  const tabs: Array<{ id: string; label: string; count?: number; icon?: string }> = [
    { id: 'resources', label: 'Resources', count: data.resources.length },
    ...fileNames.map(fileName => ({
      id: fileName,
      label: fileName,
      icon: fileName.startsWith('modules/') ? '🧩' : '📄',
    })),
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-50 to-blue-50 rounded-lg p-4 border border-brand-200">
        <div className="flex items-center gap-3 mb-2">
          <div className="text-2xl">✅</div>
          <div>
            <h3 className="font-semibold text-gray-900">Ready to Review</h3>
            <p className="text-sm text-gray-600">
              Found {data.resources.length} resource{data.resources.length !== 1 ? 's' : ''} • {Object.keys(data.files).length} files
            </p>
          </div>
        </div>
      </div>

      {/* Format switcher */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-sm text-gray-600">Terraform layout</p>
        <div className="inline-flex rounded-md border border-gray-300 p-0.5">
          <button
            onClick={() => onFormatChange('flat')}
            className={`px-3 py-1.5 text-xs font-medium rounded ${
              format === 'flat' ? 'bg-brand-600 text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            Flat
          </button>
          <button
            onClick={() => onFormatChange('modular')}
            className={`px-3 py-1.5 text-xs font-medium rounded ${
              format === 'modular' ? 'bg-brand-600 text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            Modular
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 rounded text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-brand-600 shadow'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.icon && <span className="mr-1">{tab.icon}</span>}
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1 text-xs bg-gray-200 px-2 py-0.5 rounded-full">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
        {activeTab === 'resources' && (
          <div className="divide-y max-h-96 overflow-y-auto">
            {data.resources.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No resources found
              </div>
            ) : (
              data.resources.map((resource, i) => (
                <div key={i} className="p-4 hover:bg-gray-100 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm font-medium text-gray-900 break-all">
                        {resource.type}.{resource.name}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        {resource.label}
                      </p>
                    </div>
                    <span className="text-xs bg-brand-100 text-brand-700 px-2 py-1 rounded whitespace-nowrap">
                      {resource.type.split('_').pop()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab !== 'resources' && (
          <div className="flex flex-col h-96">
            {/* File header with copy button */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-100">
              <code className="text-sm font-medium text-gray-700">
                {activeTab}
              </code>
              <button
                onClick={() =>
                  copyToClipboard(
                    data.files[activeTab] ?? '',
                    activeTab
                  )
                }
                className="text-xs px-3 py-1 rounded bg-white border border-gray-300 hover:bg-gray-50 transition-colors"
              >
                {copiedFile === activeTab ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            {/* File content */}
            <pre className="flex-1 overflow-auto p-4 text-xs text-gray-700 font-mono leading-relaxed">
              <code>
                {data.files[activeTab] ?? ''}
              </code>
            </pre>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors font-medium"
        >
          ← Back
        </button>
        <button
          onClick={onDownload}
          disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Packaging...
            </>
          ) : (
            <>
              ⬇️ Download {downloadFileName}
            </>
          )}
        </button>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 rounded-lg p-3 border border-blue-200 text-sm text-blue-900">
        <p className="font-medium mb-1">💡 Before downloading</p>
        <ul className="text-xs space-y-1 text-blue-800">
          <li>• Review each Terraform file above</li>
          <li>• Update placeholder values (var.* references)</li>
          <li>• Verify resource dependencies are correct</li>
          <li>• Ensure sensitive data is properly configured</li>
        </ul>
      </div>
    </div>
  )
}
