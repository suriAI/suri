import { useState, useEffect, useRef, useCallback } from 'react'

interface DetectionResult {
  bbox: [number, number, number, number];
  confidence: number;
  landmarks: number[][];
  recognition?: {
    personId: string | null;
    similarity: number;
  };
}

interface AttendanceRecord {
  name: string
  timestamp: string
  confidence: number
  time: string
}

export default function LiveCameraRecognition() {
  const [isStreaming, setIsStreaming] = useState(false)
  const [detectionResults, setDetectionResults] = useState<DetectionResult[]>([])
  const [todayAttendance] = useState<AttendanceRecord[]>([])
  const [systemStats, setSystemStats] = useState({ today_records: 0, total_people: 0 })
  const [cameraStatus, setCameraStatus] = useState<'stopped' | 'starting' | 'preview' | 'recognition'>('stopped')
  const [fps, setFps] = useState(0)
  const [processingTime, setProcessingTime] = useState(0)
  const [registrationMode, setRegistrationMode] = useState(false)
  const [newPersonId, setNewPersonId] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)
  const fpsCounterRef = useRef({ frames: 0, lastTime: 0 })
  const canvasInitializedRef = useRef(false)
  const lastCaptureRef = useRef(0)
  const captureIntervalRef = useRef<number | undefined>(undefined)

  // Define startProcessing first (will be defined later with useCallback)
  const startProcessingRef = useRef<(() => void) | null>(null)

  // Initialize face recognition pipeline
  const initializePipeline = useCallback(async () => {
    try {
      console.log('Initializing face recognition pipeline...')
      
      // Check if electronAPI is available
      if (!window.electronAPI) {
        throw new Error('electronAPI not available')
      }
      
      // Initialize the pipeline via IPC
      const result = await window.electronAPI.initializeFaceRecognition({
        similarityThreshold: 0.6
      })
      
      console.log('Pipeline initialization result:', result)
      
      if (result.success) {
        setCameraStatus('recognition')
        console.log('Face recognition pipeline ready')
        
        // Start processing now that everything is ready
        setTimeout(() => {
          console.log('Starting processing after status update')
          if (startProcessingRef.current) {
            startProcessingRef.current()
          }
        }, 100)
      } else {
        throw new Error(result.error || 'Pipeline initialization failed')
      }
    } catch (error) {
      console.error('Failed to initialize pipeline:', error)
      setCameraStatus('stopped')
    }
  }, [])

  const startCamera = useCallback(async () => {
    try {
      console.log('Starting camera...')
      setIsStreaming(true)
      setCameraStatus('starting')

      // Get user media with low-latency settings for real-time recognition
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { exact: 30 },
          facingMode: 'user',
          // Disable video processing that can cause delays and bounce-back effect
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        audio: false
      })

      console.log('Camera stream obtained')

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        
        videoRef.current.onloadedmetadata = () => {
          console.log('Video metadata loaded, starting playback')
          
          // Configure video for ultra-minimal latency
          if (videoRef.current) {
            const video = videoRef.current
            
            // Ultra-low latency settings
            video.currentTime = 0
            
            // Critical low-latency attributes
            video.setAttribute('playsinline', 'true')
            video.setAttribute('webkit-playsinline', 'true')
            video.muted = true
            
            // Minimize buffering completely
            video.setAttribute('x5-video-player-type', 'h5')
            if ('mozInputLatency' in video) {
              (video as any).mozInputLatency = 0.01
            }
            
            // Start playback immediately
            video.play()
          }
          
          setCameraStatus('preview')
          
          // Initialize canvas size once when video loads
          if (videoRef.current && canvasRef.current) {
            const video = videoRef.current
            const canvas = canvasRef.current
            
            // Use video's natural resolution for canvas - more performant
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            canvasInitializedRef.current = true
            console.log('Canvas initialized with video resolution:', canvas.width, 'x', canvas.height)
          }
          
          // Initialize pipeline (it will start processing automatically)
          initializePipeline()
        }
      }
    } catch (error) {
      console.error('Failed to start camera:', error)
      setIsStreaming(false)
      setCameraStatus('stopped')
    }
  }, [initializePipeline])

  const stopCamera = useCallback(() => {
    setIsStreaming(false)
    setCameraStatus('stopped')
    
    // Clean up any remaining intervals and frames
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = undefined
    }
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current)
      captureIntervalRef.current = undefined
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    
    // Reset canvas initialization flag for next session
    canvasInitializedRef.current = false
  }, [])

  const captureFrame = useCallback((): ImageData | null => {
    if (!videoRef.current || !canvasRef.current) return null
    
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    
    if (!ctx || video.videoWidth === 0) return null
    
    // Only set canvas size if not already initialized (prevents flickering)
    if (!canvasInitializedRef.current) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvasInitializedRef.current = true
      console.log('Canvas initialized during capture with video resolution:', canvas.width, 'x', canvas.height)
    }
    
    // Draw video frame to canvas (scale from video resolution to canvas size)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    
    // Get image data
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  }, [])

  const processFrameThrottled = useCallback(() => {
    if (!isStreaming || cameraStatus !== 'recognition') {
      return
    }

    const now = performance.now()
    // Throttle frame capture to reduce video element conflicts - 15 FPS for processing
    if (now - lastCaptureRef.current < 67) { // ~15 FPS
      return
    }

    lastCaptureRef.current = now

    try {
      const imageData = captureFrame()
      if (!imageData) {
        return
      }

      // Process frame through face recognition pipeline
      if (window.electronAPI?.processFrame) {
        // Process frame without await to prevent blocking
        window.electronAPI.processFrame(imageData).then(result => {
          setDetectionResults(result.detections)
          setProcessingTime(result.processingTime)
          
          // Update FPS counter
          fpsCounterRef.current.frames++
          
          if (now - fpsCounterRef.current.lastTime >= 1000) {
            setFps(fpsCounterRef.current.frames)
            fpsCounterRef.current.frames = 0
            fpsCounterRef.current.lastTime = now
          }
        }).catch(error => {
          console.error('Frame processing error:', error)
        })
      }
      
    } catch (error) {
      console.error('Frame capture error:', error)
    }
  }, [isStreaming, cameraStatus, captureFrame])

  const startProcessing = useCallback(() => {
    // Clean up any existing intervals
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = undefined
    }
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current)
      captureIntervalRef.current = undefined
    }
    
    fpsCounterRef.current = { frames: 0, lastTime: performance.now() }
    lastCaptureRef.current = 0
    
    // Use interval-based processing to reduce video element conflicts
    // 15 FPS processing allows smooth 30+ FPS preview
    captureIntervalRef.current = window.setInterval(processFrameThrottled, 67) // ~15 FPS
  }, [processFrameThrottled])

  // Set the ref after the function is defined
  useEffect(() => {
    startProcessingRef.current = startProcessing
  }, [startProcessing])

  const registerFace = useCallback(async () => {
    if (!newPersonId.trim()) {
      alert('Please enter a person ID')
      return
    }
    
    try {
      const imageData = captureFrame()
      if (!imageData) {
        alert('Failed to capture frame')
        return
      }
      
      // Find the largest face detection for registration
      const largestDetection = detectionResults.reduce((largest, current) => {
        const currentArea = (current.bbox[2] - current.bbox[0]) * (current.bbox[3] - current.bbox[1])
        const largestArea = largest ? (largest.bbox[2] - largest.bbox[0]) * (largest.bbox[3] - largest.bbox[1]) : 0
        return currentArea > largestArea ? current : largest
      }, null as DetectionResult | null)
      
      if (!largestDetection || !largestDetection.landmarks) {
        alert('No face detected for registration')
        return
      }
      
      const success = await window.electronAPI?.registerPerson(newPersonId.trim(), imageData, largestDetection.landmarks)
      
      if (success) {
        alert(`Successfully registered ${newPersonId}`)
        setNewPersonId('')
        setRegistrationMode(false)
        setSystemStats(prev => ({ ...prev, total_people: prev.total_people + 1 }))
      } else {
        alert('Failed to register face')
      }
    } catch (error) {
      console.error('Registration error:', error)
      alert('Registration failed')
    }
  }, [newPersonId, detectionResults, captureFrame])

  const drawDetections = useCallback(() => {
    if (!canvasRef.current || !videoRef.current) return
    
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    
    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Draw detections
    detectionResults.forEach((detection) => {
      const [x1, y1, x2, y2] = detection.bbox
      
      // Scale coordinates properly for canvas display
      const scaleX = canvas.width / videoRef.current!.videoWidth
      const scaleY = canvas.height / videoRef.current!.videoHeight
      
      const scaledX1 = x1 * scaleX
      const scaledY1 = y1 * scaleY
      const scaledX2 = x2 * scaleX
      const scaledY2 = y2 * scaleY
      
      // Draw bounding box
      ctx.strokeStyle = detection.recognition?.personId ? '#00ff00' : '#ff0000'
      ctx.lineWidth = 2
      ctx.strokeRect(scaledX1, scaledY1, scaledX2 - scaledX1, scaledY2 - scaledY1)
      
      // Draw label
      const label = detection.recognition?.personId 
        ? `${detection.recognition.personId} (${(detection.recognition.similarity * 100).toFixed(1)}%)`
        : `Unknown (${(detection.confidence * 100).toFixed(1)}%)`
      
      ctx.fillStyle = detection.recognition?.personId ? '#00ff00' : '#ff0000'
      ctx.font = '14px Arial'
      ctx.fillText(label, scaledX1, scaledY1 - 5)
      
      // Draw landmarks
      if (detection.landmarks) {
        ctx.fillStyle = '#ffff00'
        detection.landmarks.forEach(([x, y]) => {
          ctx.beginPath()
          ctx.arc(x, y, 3, 0, 2 * Math.PI)
          ctx.fill()
        })
      }
    })
  }, [detectionResults])

  // Draw detections overlay
  useEffect(() => {
    if (isStreaming) {
      drawDetections()
    }
  }, [detectionResults, drawDetections, isStreaming])

  // Note: Removed resize handler to improve performance
  // Canvas size is set once based on video resolution for optimal performance

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Control Bar */}
      <div className="px-8 py-6 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <button
            onClick={isStreaming ? stopCamera : startCamera}
            className={`px-8 py-3 rounded-xl text-sm font-light backdrop-blur-xl border transition-all duration-500 ${
              isStreaming 
                ? 'bg-white/[0.08] border-white/[0.15] text-white hover:bg-white/[0.12]'
                : 'bg-white/[0.05] border-white/[0.10] text-white/80 hover:bg-white/[0.08]'
            }`}
          >
            {isStreaming ? '⏹ Stop Camera' : '▶ Start Camera'}
          </button>
          
          <button
            onClick={() => setRegistrationMode(!registrationMode)}
            className="px-6 py-3 rounded-xl text-sm font-light bg-blue-600/20 border border-blue-400/30 text-blue-300 hover:bg-blue-600/30 transition-all duration-300"
          >
            {registrationMode ? 'Cancel Registration' : '👤 Register Face'}
          </button>
        </div>
        
        <div className="flex items-center space-x-6">
          <div className="text-center px-4 py-2 bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl">
            <div className="text-[10px] text-white/50 uppercase tracking-[0.1em] font-light">Status</div>
            <div className={`text-sm font-extralight ${isStreaming ? 'text-white' : 'text-white/40'}`}>
              {cameraStatus === 'stopped' && '○ Stopped'}
              {cameraStatus === 'starting' && '⟳ Starting'}
              {cameraStatus === 'preview' && '📹 Preview'}
              {cameraStatus === 'recognition' && '● Recognition'}
            </div>
          </div>
          
          <div className="text-center px-4 py-2 bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl">
            <div className="text-[10px] text-white/50 uppercase tracking-[0.1em] font-light">FPS</div>
            <div className="text-sm font-extralight text-white">{fps}</div>
          </div>
          
          <div className="text-center px-4 py-2 bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl">
            <div className="text-[10px] text-white/50 uppercase tracking-[0.1em] font-light">Processing</div>
            <div className="text-sm font-extralight text-white">{processingTime.toFixed(1)}ms</div>
          </div>
          
          <div className="text-center px-4 py-2 bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl">
            <div className="text-[10px] text-white/50 uppercase tracking-[0.1em] font-light">Today</div>
            <div className="text-sm font-extralight text-white">{systemStats.today_records}</div>
          </div>
        </div>
      </div>

      {/* Registration Panel */}
      {registrationMode && (
        <div className="px-8 pb-4">
          <div className="bg-blue-900/20 border border-blue-400/30 rounded-xl p-4 backdrop-blur-xl">
            <div className="flex items-center space-x-4">
              <input
                type="text"
                placeholder="Enter person ID/name"
                value={newPersonId}
                onChange={(e) => setNewPersonId(e.target.value)}
                className="flex-1 px-4 py-2 bg-white/[0.05] border border-white/[0.10] rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-blue-400/50"
                onKeyPress={(e) => e.key === 'Enter' && registerFace()}
              />
              <button
                onClick={registerFace}
                disabled={!newPersonId.trim() || detectionResults.length === 0}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
              >
                Register
              </button>
            </div>
            <div className="text-xs text-blue-300/70 mt-2">
              {detectionResults.length > 0 ? 'Face detected - ready to register' : 'Position your face in the camera view'}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 px-8 pb-8 gap-6">
        {/* Video Feed */}
        <div className="flex-1">
          <div className="relative h-[70vh] bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden flex items-center justify-center">
            {isStreaming ? (
              <>
                <div className="relative w-full max-w-4xl aspect-video">
                <video
                  ref={videoRef}
                  className="absolute inset-0 rounded-2xl w-full h-full"
                  playsInline
                  muted
                  autoPlay
                  preload="none"
                  disablePictureInPicture
                  controls={false}
                  style={{ 
                    objectFit: 'contain'
                  }}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 pointer-events-none rounded-2xl w-full h-full"
                  style={{ 
                    objectFit: 'contain'
                  }}
                />
              </div>
                
                {/* Detection Count Overlay */}
                {detectionResults.length > 0 && (
                  <div className="absolute top-4 left-4 px-4 py-2 bg-black/50 backdrop-blur-sm rounded-lg">
                    <div className="text-white text-sm">
                      {detectionResults.length} face{detectionResults.length !== 1 ? 's' : ''} detected
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-white/60">
                  <div className="flex items-center justify-center w-20 h-20 rounded-full bg-white/[0.02] border border-white/[0.05] mb-6 mx-auto">
                    <svg className="w-10 h-10 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <p className="text-sm mt-2 text-white/40 font-light">Click "Start Camera" to begin</p>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Attendance Panel */}
        <div className="w-64">
          <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl h-[70vh] flex flex-col">
            <div className="p-4 border-b border-white/[0.05]">
              <h3 className="text-[10px] font-light text-white/60 uppercase tracking-[0.15em]">Today's Activity</h3>
              <div className="text-2xl font-extralight text-white mt-2">{systemStats.today_records}</div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3">
              {todayAttendance.length > 0 ? (
                <div className="space-y-2">
                  {todayAttendance.slice().reverse().map((record, index) => (
                    <div key={index} className="group">
                      <div className="py-3 px-3 bg-white/[0.02] border border-white/[0.05] rounded-xl hover:bg-white/[0.04] hover:border-white/[0.08] transition-all duration-300">
                        <div className="text-sm font-light text-white truncate">{record.name}</div>
                        <div className="flex items-center justify-between mt-1">
                          <div className="text-xs text-white/50 font-light">{record.time}</div>
                          <div className="text-xs font-light text-white/60">
                            {(record.confidence * 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-center">
                  <div className="text-white/40">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.02] border border-white/[0.05] mb-3">
                      <svg className="w-6 h-6 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                      </svg>
                    </div>
                    <p className="text-xs font-light">No activity today</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}