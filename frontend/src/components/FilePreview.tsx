import { useEffect, useMemo, useState } from 'react'

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
  const fileNames = useMemo(() => Object.keys(data.files).sort((a, b) => a.localeCompare(b)), [data.files])
  const [activeTab, setActiveTab] = useState<string>('resources')
  const [copiedFile, setCopiedFile] = useState<string | null>(null)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})

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

  type ExplorerNode = {
    name: string
    path: string
    type: 'folder' | 'file'
    children: ExplorerNode[]
  }

  const explorerTree = useMemo<ExplorerNode[]>(() => {
    const rootMap = new Map<string, ExplorerNode>()

    const ensureChild = (children: ExplorerNode[], name: string, path: string, type: 'folder' | 'file') => {
      let child = children.find((n) => n.name === name && n.type === type)
      if (!child) {
        child = { name, path, type, children: [] }
        children.push(child)
      }
      return child
    }

    for (const filePath of fileNames) {
      const parts = filePath.split('/').filter(Boolean)
      if (parts.length === 0) continue

      const head = parts[0]
      if (!rootMap.has(head)) {
        rootMap.set(head, { name: head, path: head, type: parts.length === 1 ? 'file' : 'folder', children: [] })
      }

      let current = rootMap.get(head)!
      let currentPath = head

      for (let i = 1; i < parts.length; i++) {
        const part = parts[i]
        currentPath = `${currentPath}/${part}`
        const isLeaf = i === parts.length - 1
        current = ensureChild(current.children, part, currentPath, isLeaf ? 'file' : 'folder')
      }
    }

    const sortNodes = (nodes: ExplorerNode[]): ExplorerNode[] => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      for (const n of nodes) {
        if (n.children.length > 0) sortNodes(n.children)
      }
      return nodes
    }

    return sortNodes(Array.from(rootMap.values()))
  }, [fileNames])

  const toggleFolder = (path: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [path]: !prev[path],
    }))
  }

  const activeContent = activeTab === 'resources' ? '' : (data.files[activeTab] ?? '')

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

      {/* VS Code-like split layout */}
      <div className="bg-white rounded-lg border-2 border-gray-800 overflow-hidden h-[22rem] md:h-[26rem] shadow-md">
        <div className="grid grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)] h-full min-h-0">
          {/* LEFT: Explorer pane */}
          <div className="flex flex-col min-w-0 min-h-0 border-b md:border-b-0 md:border-r border-gray-800 bg-gray-50">
            <div className="px-4 py-2 border-b border-gray-800 bg-white text-xs font-semibold tracking-wide uppercase text-gray-600">
              Explorer
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 text-sm text-gray-700">
              <button
                onClick={() => setActiveTab('resources')}
                className={`w-full text-left px-2 py-1 rounded flex items-center gap-2 ${
                  activeTab === 'resources' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-gray-100'
                }`}
              >
                <span>☰</span>
                <span>Resources ({data.resources.length})</span>
              </button>

              <div className="mt-2 space-y-0.5">
                {renderNodes(explorerTree, 0)}
              </div>
            </div>
          </div>

          {/* RIGHT: Preview pane */}
          <div className="flex flex-col min-w-0 min-h-0 border-b md:border-b-0 md:border-l border-gray-800">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-white">
              <div className="text-xs font-medium tracking-wide uppercase text-gray-600">
                {activeTab === 'resources' ? 'Resources' : activeTab}
              </div>
              {activeTab !== 'resources' && (
                <button
                  onClick={() => copyToClipboard(activeContent, activeTab)}
                  className="text-xs px-2 py-1 rounded bg-gray-100 border border-gray-600 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  {copiedFile === activeTab ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>

            {activeTab === 'resources' ? (
              <div className="divide-y divide-gray-800 overflow-auto">
                {data.resources.length === 0 ? (
                  <div className="p-6 text-center text-gray-400">No resources found</div>
                ) : (
                  data.resources.map((resource, i) => (
                    <div key={i} className="p-4 hover:bg-gray-50 transition-colors">
                      <p className="font-mono text-sm font-medium text-gray-900 break-all">
                        {resource.type}.{resource.name}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">{resource.label}</p>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <pre className="flex-1 overflow-auto p-4 text-xs text-gray-800 font-mono leading-relaxed bg-gray-50">
                <code>{activeContent}</code>
              </pre>
            )}
          </div>
        </div>
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

  function renderNodes(nodes: ExplorerNode[], depth: number): JSX.Element[] {
    const items: JSX.Element[] = []

    for (const node of nodes) {
      const pad = { paddingLeft: `${depth * 12 + 8}px` }
      if (node.type === 'folder') {
        const isCollapsed = collapsedFolders[node.path] ?? false
        items.push(
          <button
            key={`folder-${node.path}`}
            onClick={() => toggleFolder(node.path)}
            style={pad}
            className="w-full text-left py-1 pr-2 rounded hover:bg-gray-100 flex items-center gap-1"
          >
            <span className="text-xs w-3">{isCollapsed ? '▸' : '▾'}</span>
            <span>📁</span>
            <span className="truncate">{node.name}</span>
          </button>
        )

        if (!isCollapsed) {
          items.push(...renderNodes(node.children, depth + 1))
        }
      } else {
        const isActive = activeTab === node.path
        items.push(
          <button
            key={`file-${node.path}`}
            onClick={() => setActiveTab(node.path)}
            style={pad}
            className={`w-full text-left py-1 pr-2 rounded flex items-center gap-1 ${
              isActive ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-gray-100'
            }`}
          >
            <span className="w-3" />
            <span>📄</span>
            <span className="truncate">{node.name}</span>
          </button>
        )
      }
    }

    return items
  }
}
