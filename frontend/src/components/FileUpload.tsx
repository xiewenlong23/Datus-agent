import { useState, useRef } from 'react'

export default function FileUpload() {
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      // P4 will implement actual upload
      console.log('Files selected:', files)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      console.log('Files dropped:', files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  return (
    <div
      className="upload-zone"
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={isDragOver ? { borderColor: 'var(--accent-light)', background: '#eef2ff' } : {}}
    >
      <div className="upload-zone-title">拖拽合同到此处，或点击上传</div>
      <div className="upload-zone-hint">PDF / Word / 纯文本，单份不超过 200 页，可同时上传对照版本</div>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        accept=".pdf,.doc,.docx,.txt"
        multiple
        onChange={handleFileChange}
      />
    </div>
  )
}