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
      {/* Minimalist header */}
      <div className="mb-8">
        <h1 className="text-3xl font-light text-white">Single Image Recognition</h1>
        <p className="text-sm text-zinc-500 mt-2">Upload and analyze face recognition in images</p>
      </div>

      {/* File Upload Section */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Upload Image</h3>
        
        <div className="space-y-4">
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
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all duration-200"
            >
              📁 Select Image
            </button>
            
            {selectedFile && (
              <>
                <button
                  onClick={processImage}
                  disabled={isProcessing}
                  className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-zinc-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all duration-200"
                >
                  {isProcessing ? '⏳ Processing...' : '🔍 Analyze Image'}
                </button>
                
                <button
                  onClick={clearSelection}
                  disabled={isProcessing}
                  className="px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all duration-200"
                >
                  🗑️ Clear
                </button>
              </>
            )}
          </div>

          {selectedFile && (
            <div className="text-sm text-zinc-300">
              <span className="font-medium text-white">Selected:</span> {selectedFile.name}
              <span className="ml-4 text-zinc-400">
                ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Results Section */}
      {(selectedFile || processedImageUrl) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Image Display */}
          <div className="lg:col-span-2">
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
              <h3 className="text-lg font-semibold text-white mb-4">
                {processedImageUrl ? 'Recognition Results' : 'Preview'}
              </h3>
              
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
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
                  <div className="flex items-center justify-center h-full text-zinc-400">
                    <div className="text-center">
                      <div className="text-6xl mb-4">🖼️</div>
                      <p className="text-lg">No Image Selected</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recognition Results */}
          <div className="space-y-4">
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
              <h3 className="text-lg font-semibold text-white mb-4">
                Detection Results
              </h3>
              
              {isProcessing ? (
                <div className="text-center py-8">
                  <div className="animate-spin text-4xl mb-4">⏳</div>
                  <p className="text-zinc-300">Processing image...</p>
                </div>
              ) : results.length > 0 ? (
                <div className="space-y-3">
                  {results.map((result, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-lg border ${
                        result.shouldLog
                          ? 'bg-green-500/20 border-green-500/50'
                          : result.name
                          ? 'bg-yellow-500/20 border-yellow-500/50'
                          : 'bg-red-500/20 border-red-500/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-white">
                          {result.name || `Unknown Face #${index + 1}`}
                        </span>
                        <span className={`text-sm px-2 py-1 rounded ${
                          result.shouldLog
                            ? 'bg-green-500 text-white'
                            : result.name
                            ? 'bg-yellow-500 text-black'
                            : 'bg-red-500 text-white'
                        }`}>
                          {result.shouldLog ? 'Recognized' : result.name ? 'Low Confidence' : 'Unknown'}
                        </span>
                      </div>
                      
                      <div className="text-sm text-zinc-300 space-y-1">
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
                <div className="text-center text-zinc-400 py-8">
                  <div className="text-3xl mb-2">👥</div>
                  <p>No faces detected in image</p>
                </div>
              ) : (
                <div className="text-center text-zinc-400 py-8">
                  <div className="text-3xl mb-2">🔍</div>
                  <p>Click "Analyze Image" to start recognition</p>
                </div>
              )}
            </div>

            {/* Statistics */}
            {results.length > 0 && (
              <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Summary</h3>
                
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-zinc-300">
                    <span>Total Faces:</span>
                    <span className="text-white font-medium">{results.length}</span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Recognized:</span>
                    <span className="text-green-400 font-medium">
                      {results.filter(r => r.shouldLog).length}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Low Confidence:</span>
                    <span className="text-yellow-400 font-medium">
                      {results.filter(r => r.name && !r.shouldLog).length}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Unknown:</span>
                    <span className="text-red-400 font-medium">
                      {results.filter(r => !r.name).length}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-300 pt-2 border-t border-zinc-600">
                    <span>Recognition Rate:</span>
                    <span className="text-blue-400 font-medium">
                      {((results.filter(r => r.shouldLog).length / results.length) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
        <h3 className="text-lg font-semibold text-white mb-4">📝 Instructions</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-zinc-300">
          <div>
            <h4 className="font-medium text-white mb-2">Supported Formats:</h4>
            <ul className="space-y-1">
              <li>• JPEG (.jpg, .jpeg)</li>
              <li>• PNG (.png)</li>
              <li>• BMP (.bmp)</li>
              <li>• TIFF (.tiff, .tif)</li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-medium text-white mb-2">Best Results:</h4>
            <ul className="space-y-1">
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
