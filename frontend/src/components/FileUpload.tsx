import { useCallback, useState } from 'react'

interface FileUploadProps {
  onFile: (file: File) => void
  disabled: boolean
  loading?: boolean
}

export default function FileUpload({ onFile, disabled, loading = false }: FileUploadProps) {
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      if (!file.name.endsWith('.drawio') && !file.name.endsWith('.xml')) {
        alert('Please upload a .drawio file.')
        return
      }
      onFile(file)
    },
    [onFile]
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault()
      setDragging(false)
      handleFile(e.dataTransfer.files[0])
    },
    [handleFile]
  )

  const onDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragging(true)
  }

  const onDragLeave = () => setDragging(false)

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    handleFile(e.target.files?.[0])

  return (
    <label
      htmlFor="drawio-input"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={[
        'flex flex-col items-center justify-center w-full h-56 border-2 border-dashed rounded-2xl cursor-pointer transition-colors',
        dragging
          ? 'border-brand-500 bg-brand-50'
          : 'border-gray-300 bg-gray-50 hover:border-brand-500 hover:bg-brand-50',
        disabled ? 'opacity-50 pointer-events-none' : '',
      ].join(' ')}
    >
      <svg
        className="w-14 h-14 mb-3 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 15a4 4 0 004 4h10a4 4 0 000-8 1 1 0 01-1-1 6 6 0 10-11.8 1.6A4.002 4.002 0 003 15z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 11v6m0 0-2-2m2 2 2-2"
        />
      </svg>
      {loading ? (
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-2" />
          <p className="text-sm font-medium text-brand-700">Reading and converting diagram...</p>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-600">
            <span className="text-brand-600">Click to upload</span> or drag &amp; drop
          </p>
          <p className="mt-1 text-xs text-gray-400">.drawio files only — max 5 MB</p>
        </>
      )}
      <input
        id="drawio-input"
        type="file"
        accept=".drawio,.xml"
        className="sr-only"
        onChange={onChange}
        disabled={disabled}
      />
    </label>
  )
}
