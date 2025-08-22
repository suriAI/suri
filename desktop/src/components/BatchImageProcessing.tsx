import { useState, useRef } from 'react'

interface BatchImageProcessingProps {
  onBack: () => void
}

interface BatchResult {
  filename: string
  faces_detected: number
  faces_recognized: number
  processing_time: number
  faces: Array<{
    name: string | null
    confidence: number
    quality: number
    method: string
    shouldLog: boolean
  }>
}

interface BatchSummary {
  total_images: number
  total_faces: number
  total_recognized: number
  processing_time: number
  recognition_rate: number
}

export default function BatchImageProcessing({ onBack }: BatchImageProcessingProps) {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [results, setResults] = useState<BatchResult[]>([])
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [currentProgress, setCurrentProgress] = useState(0)
  const [currentFile, setCurrentFile] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0) {
      setSelectedFiles(files)
      setResults([])
      setSummary(null)
      setCurrentProgress(0)
    }
  }

  const processBatchOptimized = async () => {
    if (!selectedFiles || selectedFiles.length === 0) return

    setIsProcessing(true)
    setResults([])
    setSummary(null)
    setCurrentProgress(0)

    const startTime = Date.now()

    try {
      // Use the new batch endpoint for better performance
      const formData = new FormData()
      for (let i = 0; i < selectedFiles.length; i++) {
        formData.append('files', selectedFiles[i])
      }

      const response = await fetch('http://127.0.0.1:8770/recognize/batch', {
        method: 'POST',
        body: formData
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
                     // Convert API response to our format
           const batchResults: BatchResult[] = data.results.map((result: { filename: string; faces_detected: number; faces_recognized: number; faces: Array<{ name: string; confidence: number; quality: number; method: string; should_log: boolean }> }) => ({
             filename: result.filename,
             faces_detected: result.faces_detected,
             faces_recognized: result.faces_recognized,
             processing_time: data.summary.processing_time_seconds * 1000, // Convert to ms
             faces: result.faces.map((face: { name: string; confidence: number; quality: number; method: string; should_log: boolean }) => ({
               name: face.name,
               confidence: face.confidence,
               quality: face.quality,
               method: face.method,
               shouldLog: face.should_log
             }))
           }))

          setResults(batchResults)
          setCurrentProgress(100)

                     // Create summary
           const summary: BatchSummary = {
             total_images: data.summary.total_images,
             total_faces: data.summary.total_faces_detected,
             total_recognized: data.summary.total_faces_recognized,
             processing_time: (Date.now() - startTime) / 1000, // Convert to seconds
             recognition_rate: data.summary.recognition_rate
           }
          setSummary(summary)
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Batch processing error:', error)
      alert('❌ Batch processing failed. Falling back to individual processing...')
      // Fallback to individual processing
      processBatch()
    } finally {
      setIsProcessing(false)
      setCurrentFile('')
    }
  }

  const processBatch = async () => {
    if (!selectedFiles || selectedFiles.length === 0) return

    setIsProcessing(true)
    setResults([])
    setSummary(null)
    setCurrentProgress(0)

    const batchResults: BatchResult[] = []
    const startTime = Date.now()

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i]
        setCurrentFile(file.name)
        setCurrentProgress(((i + 1) / selectedFiles.length) * 100)

        const formData = new FormData()
        formData.append('file', file)

        try {
          const response = await fetch('http://127.0.0.1:8770/recognize/image', {
            method: 'POST',
            body: formData
          })

          if (response.ok) {
            const data = await response.json()
            if (data.success) {
              type ApiFace = { name?: string; confidence?: number; similarity?: number; quality?: number; method?: string; shouldLog?: boolean; should_log?: boolean }
              const raw = (data.results || data.faces || []) as ApiFace[]
              const faces = raw.map((f) => ({
                name: f.name ?? null,
                confidence: f.confidence ?? f.similarity ?? 0,
                quality: f.quality ?? 0,
                method: f.method ?? 'unknown',
                shouldLog: f.shouldLog ?? f.should_log ?? false
              }))
              const result: BatchResult = {
                filename: file.name,
                faces_detected: faces.length,
                faces_recognized: faces.filter((f) => f.shouldLog).length,
                processing_time: (data.processing_info?.time_ms ?? data.processing_time ?? 0),
                faces
              }
              batchResults.push(result)
              setResults([...batchResults])
            }
          }
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error)
          const errorResult: BatchResult = {
            filename: file.name,
            faces_detected: 0,
            faces_recognized: 0,
            processing_time: 0,
            faces: []
          }
          batchResults.push(errorResult)
          setResults([...batchResults])
        }

        // Small delay to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // Calculate summary
      const totalTime = (Date.now() - startTime) / 1000
      const totalFaces = batchResults.reduce((sum, r) => sum + r.faces_detected, 0)
      const totalRecognized = batchResults.reduce((sum, r) => sum + r.faces_recognized, 0)

      setSummary({
        total_images: selectedFiles.length,
        total_faces: totalFaces,
        total_recognized: totalRecognized,
        processing_time: totalTime,
        recognition_rate: totalFaces > 0 ? (totalRecognized / totalFaces) * 100 : 0
      })

    } catch (error) {
      console.error('Batch processing error:', error)
      alert('❌ Batch processing failed')
    } finally {
      setIsProcessing(false)
      setCurrentFile('')
      setCurrentProgress(0)
    }
  }

  const clearSelection = () => {
    setSelectedFiles(null)
    setResults([])
    setSummary(null)
    setCurrentProgress(0)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const exportResults = () => {
    if (!results.length) return

    const csvContent = [
      'Filename,Faces Detected,Faces Recognized,Recognition Rate,Processing Time (ms)',
      ...results.map(r => 
        `"${r.filename}",${r.faces_detected},${r.faces_recognized},${r.faces_detected > 0 ? ((r.faces_recognized / r.faces_detected) * 100).toFixed(1) : 0}%,${r.processing_time}`
      )
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch_recognition_results_${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      {/* Glass Header */}
      <div className="mb-12">
        <div className="flex items-center space-x-6 mb-4">
          <button
            onClick={onBack}
            className="px-6 py-3 bg-white/[0.05] hover:bg-white/[0.08] backdrop-blur-xl border border-white/[0.10] text-white rounded-xl font-light transition-all duration-300"
          >
            ← Back
          </button>
        </div>
        <h1 className="text-4xl font-extralight text-white tracking-tight">Batch Image Processing</h1>
        <p className="text-sm text-white/50 mt-3 font-light">Process multiple images for face recognition analysis</p>
      </div>

      {/* Glass File Upload Section */}
      <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 mb-8">
        <h3 className="text-xl font-light text-white mb-6">Select Images</h3>
        
        <div className="space-y-6">
          <div className="flex items-center space-x-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-8 py-3 bg-white/[0.05] hover:bg-white/[0.08] backdrop-blur-xl border border-white/[0.10] text-white rounded-xl font-light transition-all duration-300 flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span>Select Multiple Images</span>
            </button>
            
            {selectedFiles && (
              <>
                <button
                  onClick={processBatchOptimized}
                  disabled={isProcessing}
                  className="px-8 py-3 bg-white/[0.08] hover:bg-white/[0.12] disabled:bg-white/[0.02] disabled:cursor-not-allowed backdrop-blur-xl border border-white/[0.15] text-white rounded-xl font-light transition-all duration-300 flex items-center space-x-2"
                >
                  {isProcessing ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                      </svg>
                      <span>Process All Images</span>
                    </>
                  )}
                </button>
                
                <button
                  onClick={clearSelection}
                  disabled={isProcessing}
                  className="px-6 py-3 bg-white/[0.03] hover:bg-white/[0.06] backdrop-blur-xl border border-white/[0.08] text-white/80 hover:text-white rounded-xl font-light transition-all duration-300 flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  <span>Clear</span>
                </button>

                {results.length > 0 && (
                  <button
                    onClick={exportResults}
                    className="px-6 py-3 bg-white/[0.05] hover:bg-white/[0.08] backdrop-blur-xl border border-white/[0.10] text-white rounded-xl font-light transition-all duration-300 flex items-center space-x-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                    <span>Export CSV</span>
                  </button>
                )}
              </>
            )}
          </div>

          {selectedFiles && (
            <div className="text-sm text-white/60 bg-white/[0.02] p-4 rounded-xl">
              <span className="font-light text-white/80">Selected:</span> {selectedFiles.length} images
              <span className="ml-4 text-white/40">
                ({(Array.from(selectedFiles).reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(2)} MB total)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Glass Progress Section */}
      {isProcessing && (
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 mb-8">
          <h3 className="text-xl font-light text-white mb-6">Processing Progress</h3>
          
          <div className="space-y-6">
            <div className="w-full bg-white/[0.05] rounded-full h-2">
              <div 
                className="bg-white/[0.20] h-2 rounded-full transition-all duration-300"
                style={{ width: `${currentProgress}%` }}
              ></div>
            </div>
            
            <div className="flex justify-between text-sm">
              <span className="text-white/60 font-light">
                {currentProgress.toFixed(1)}% Complete
              </span>
              <span className="text-white/60 font-light">
                {results.length} / {selectedFiles?.length || 0} processed
              </span>
            </div>
            
            {currentFile && (
              <div className="text-sm text-white/40 font-light">
                Currently processing: <span className="text-white/80">{currentFile}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Glass Summary Section */}
      {summary && (
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 mb-8">
          <h3 className="text-xl font-light text-white mb-6">Batch Summary</h3>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-xl p-6 text-center">
              <div className="text-3xl font-extralight text-white">{summary.total_images}</div>
              <div className="text-xs text-white/50 mt-2 font-light uppercase tracking-widest">Images Processed</div>
            </div>
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-xl p-6 text-center">
              <div className="text-3xl font-extralight text-white">{summary.total_faces}</div>
              <div className="text-xs text-white/50 mt-2 font-light uppercase tracking-widest">Faces Detected</div>
            </div>
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-xl p-6 text-center">
              <div className="text-3xl font-extralight text-white">{summary.total_recognized}</div>
              <div className="text-xs text-white/50 mt-2 font-light uppercase tracking-widest">Faces Recognized</div>
            </div>
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-xl p-6 text-center">
              <div className="text-3xl font-extralight text-white">{summary.recognition_rate.toFixed(1)}%</div>
              <div className="text-xs text-white/50 mt-2 font-light uppercase tracking-widest">Recognition Rate</div>
            </div>
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-xl p-6 text-center">
              <div className="text-3xl font-extralight text-white">{summary.processing_time.toFixed(1)}s</div>
              <div className="text-xs text-white/50 mt-2 font-light uppercase tracking-widest">Total Time</div>
            </div>
          </div>
        </div>
      )}

      {/* Glass Results Section */}
      {results.length > 0 && (
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 mb-8">
          <h3 className="text-xl font-light text-white mb-6">Processing Results</h3>
          
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {results.map((result, index) => (
              <div
                key={index}
                className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="font-light text-white truncate mr-4">
                    {result.filename}
                  </span>
                  <div className="flex space-x-3 text-sm">
                    <span className="px-3 py-1 bg-white/[0.05] text-white/80 rounded-full font-light">
                      {result.faces_detected} faces
                    </span>
                    <span className="px-3 py-1 bg-white/[0.08] text-white rounded-full font-light">
                      {result.faces_recognized} recognized
                    </span>
                    {result.faces_detected > 0 && (
                      <span className="px-3 py-1 bg-white/[0.10] text-white rounded-full font-light">
                        {((result.faces_recognized / result.faces_detected) * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
                
                {result.faces.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {result.faces.map((face, faceIndex) => (
                      <div key={faceIndex} className="text-sm text-white/60 flex justify-between font-light">
                        <span>{face.name || `Unknown #${faceIndex + 1}`}</span>
                        <span className={`${face.shouldLog ? 'text-white' : face.name ? 'text-white/80' : 'text-white/50'}`}>
                          {(face.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Glass Instructions */}
      <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8">
        <h3 className="text-xl font-light text-white mb-6">📝 Instructions</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm text-white/60">
          <div>
            <h4 className="font-light text-white/80 mb-4">How to Use:</h4>
            <ul className="space-y-2 font-light">
              <li>• Select multiple images using the file picker</li>
              <li>• Click "Process All Images" to start batch recognition</li>
              <li>• Monitor progress in real-time</li>
              <li>• Export results to CSV for analysis</li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-light text-white/80 mb-4">Performance Tips:</h4>
            <ul className="space-y-2 font-light">
              <li>• Process images in smaller batches for better performance</li>
              <li>• Ensure stable internet connection</li>
              <li>• Use consistent image quality for best results</li>
              <li>• Check server load if processing seems slow</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}