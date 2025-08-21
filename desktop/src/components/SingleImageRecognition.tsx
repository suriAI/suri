import { useState, useRef } from 'react'



interface RecognitionResult {
  name: string | null
  confidence: number
  bbox: [number, number, number, number]
  quality: number
  method: string
  shouldLog: boolean
}

export default function SingleImageRecognition() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [results, setResults] = useState<RecognitionResult[]>([])
  const [processedImageUrl, setProcessedImageUrl] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file)
      setResults([])
      setProcessedImageUrl('')
    }
  }

  const processImage = async () => {
    if (!selectedFile) return

    setIsProcessing(true)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)

      const response = await fetch('http://127.0.0.1:8770/recognize/image', {
        method: 'POST',
        body: formData
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          type ApiFace = { name?: string; confidence?: number; similarity?: number; bbox?: [number,number,number,number]; quality?: number; method?: string; shouldLog?: boolean; should_log?: boolean }
          const raw = (data.results || data.faces || []) as ApiFace[]
          // Normalize API fields to UI shape
          const normalized: RecognitionResult[] = raw.map((r) => ({
            name: r.name ?? null,
            confidence: r.confidence ?? r.similarity ?? 0,
            bbox: (Array.isArray(r.bbox) ? r.bbox : [0,0,0,0]) as [number, number, number, number],
            quality: r.quality ?? 0,
            method: r.method ?? 'unknown',
            shouldLog: r.shouldLog ?? r.should_log ?? false
          }))
          setResults(normalized)
          if (data.annotated_image) {
            setProcessedImageUrl(data.annotated_image)
          }
        } else {
          alert(`❌ Processing failed: ${data.message}`)
        }
      } else {
        alert('❌ Failed to process image')
      }
    } catch (error) {
      console.error('Image processing error:', error)
      alert('❌ Connection error while processing image')
    } finally {
      setIsProcessing(false)
    }
  }

  const clearSelection = () => {
    setSelectedFile(null)
    setResults([])
    setProcessedImageUrl('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      {/* Glass Header */}
      <div className="mb-12">
        <h1 className="text-4xl font-extralight text-white tracking-tight">Single Image Recognition</h1>
        <p className="text-sm text-white/50 mt-3 font-light">Upload and analyze face recognition in images</p>
      </div>

      {/* Glass Upload Section */}
      <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 mb-8">
        <h3 className="text-xl font-light text-white mb-6">Upload Image</h3>
        
        <div className="space-y-6">
          <div className="flex items-center space-x-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-8 py-3 bg-white/[0.05] hover:bg-white/[0.08] backdrop-blur-xl border border-white/[0.10] text-white rounded-xl font-light transition-all duration-300"
            >
              📁 Select Image
            </button>
            
            {selectedFile && (
              <>
                <button
                  onClick={processImage}
                  disabled={isProcessing}
                  className="px-8 py-3 bg-white/[0.08] hover:bg-white/[0.12] disabled:bg-white/[0.02] disabled:cursor-not-allowed backdrop-blur-xl border border-white/[0.15] text-white rounded-xl font-light transition-all duration-300"
                >
                  {isProcessing ? '⏳ Processing...' : '🔍 Analyze Image'}
                </button>
                
                <button
                  onClick={clearSelection}
                  disabled={isProcessing}
                  className="px-6 py-3 bg-white/[0.03] hover:bg-white/[0.06] backdrop-blur-xl border border-white/[0.08] text-white/80 hover:text-white rounded-xl font-light transition-all duration-300"
                >
                  🗑️ Clear
                </button>
              </>
            )}
          </div>

          {selectedFile && (
            <div className="text-sm text-white/60 bg-white/[0.02] p-4 rounded-xl">
              <span className="font-light text-white/80">Selected:</span> {selectedFile.name}
              <span className="ml-4 text-white/40">
                ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Results Section */}
      {(selectedFile || processedImageUrl) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          {/* Glass Image Display */}
          <div className="lg:col-span-2">
            <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
              <h3 className="text-xl font-light text-white mb-6">
                {processedImageUrl ? 'Recognition Results' : 'Preview'}
              </h3>
              
              <div className="aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/[0.05]">
                {processedImageUrl ? (
                  <img
                    src={processedImageUrl}
                    alt="Processed image with recognition results"
                    className="w-full h-full object-contain"
                  />
                ) : selectedFile ? (
                  <img
                    src={URL.createObjectURL(selectedFile)}
                    alt="Selected image preview"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-white/40">
                    <div className="text-center">
                      <div className="text-6xl mb-4">🖼️</div>
                      <p className="text-lg font-light">No Image Selected</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Glass Recognition Results */}
          <div className="space-y-6">
            <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
              <h3 className="text-xl font-light text-white mb-6">
                Detection Results
              </h3>
              
              {isProcessing ? (
                <div className="text-center py-12">
                  <div className="animate-spin text-4xl mb-4">⏳</div>
                  <p className="text-white/60 font-light">Processing image...</p>
                </div>
              ) : results.length > 0 ? (
                <div className="space-y-4">
                  {results.map((result, index) => (
                    <div
                      key={index}
                      className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.05] transition-all duration-300"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-light text-white">
                          {result.name || `Unknown Face #${index + 1}`}
                        </span>
                        <span className={`text-xs px-3 py-1 rounded-full font-light ${
                          result.shouldLog
                            ? 'bg-white/[0.15] text-white border border-white/[0.20]'
                            : result.name
                            ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                            : 'bg-white/[0.05] text-white/60 border border-white/[0.05]'
                        }`}>
                          {result.shouldLog ? 'Recognized' : result.name ? 'Low Confidence' : 'Unknown'}
                        </span>
                      </div>
                      
                      <div className="text-xs text-white/50 space-y-1 font-light">
                        <div>Confidence: {(result.confidence * 100).toFixed(1)}%</div>
                        <div>Quality: {result.quality.toFixed(2)}</div>
                        <div>Method: {result.method}</div>
                        <div>
                          Position: [{result.bbox[0]}, {result.bbox[1]}, {result.bbox[2]}, {result.bbox[3]}]
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : processedImageUrl ? (
                <div className="text-center text-white/40 py-12">
                  <div className="text-4xl mb-3">👥</div>
                  <p className="font-light">No faces detected in image</p>
                </div>
              ) : (
                <div className="text-center text-white/40 py-12">
                  <div className="text-4xl mb-3">🔍</div>
                  <p className="font-light">Click "Analyze Image" to start recognition</p>
                </div>
              )}
            </div>

            {/* Glass Statistics */}
            {results.length > 0 && (
              <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
                <h3 className="text-xl font-light text-white mb-6">Summary</h3>
                
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between text-white/60">
                    <span className="font-light">Total Faces:</span>
                    <span className="text-white font-light">{results.length}</span>
                  </div>
                  <div className="flex justify-between text-white/60">
                    <span className="font-light">Recognized:</span>
                    <span className="text-white font-light">
                      {results.filter(r => r.shouldLog).length}
                    </span>
                  </div>
                  <div className="flex justify-between text-white/60">
                    <span className="font-light">Low Confidence:</span>
                    <span className="text-white/80 font-light">
                      {results.filter(r => r.name && !r.shouldLog).length}
                    </span>
                  </div>
                  <div className="flex justify-between text-white/60">
                    <span className="font-light">Unknown:</span>
                    <span className="text-white/60 font-light">
                      {results.filter(r => !r.name).length}
                    </span>
                  </div>
                  <div className="flex justify-between text-white/60 pt-3 border-t border-white/[0.05]">
                    <span className="font-light">Recognition Rate:</span>
                    <span className="text-white font-light">
                      {((results.filter(r => r.shouldLog).length / results.length) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Glass Instructions */}
      <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8">
        <h3 className="text-xl font-light text-white mb-6">📝 Instructions</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm text-white/60">
          <div>
            <h4 className="font-light text-white/80 mb-4">Supported Formats:</h4>
            <ul className="space-y-2 font-light">
              <li>• JPEG (.jpg, .jpeg)</li>
              <li>• PNG (.png)</li>
              <li>• BMP (.bmp)</li>
              <li>• TIFF (.tiff, .tif)</li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-light text-white/80 mb-4">Best Results:</h4>
            <ul className="space-y-2 font-light">
              <li>• Clear, well-lit faces</li>
              <li>• Front-facing poses</li>
              <li>• Minimal blur or motion</li>
              <li>• High resolution images</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}