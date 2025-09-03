import { useState, useRef, useCallback, useEffect } from 'react'
import { ClientSideScrfdService } from '../services/ClientSideScrfdService'
import { ClientSideEdgeFaceService } from '../services/ClientSideEdgeFaceService'

interface DetectionResult {
  bbox: [number, number, number, number];
  confidence: number;
  landmarks: number[][];
  recognition?: {
    personId: string | null;
    similarity: number;
  };
}

export default function LiveCameraRecognition() {
  const [isStreaming, setIsStreaming] = useState(false)
  const [detectionResults, setDetectionResults] = useState<DetectionResult[]>([])
  const [systemStats, setSystemStats] = useState({ today_records: 0, total_people: 0 })
  const [cameraStatus, setCameraStatus] = useState<'stopped' | 'starting' | 'preview' | 'recognition'>('stopped')
  const [fps, setFps] = useState(0)
  const [processingTime, setProcessingTime] = useState(0)
  const [registrationMode, setRegistrationMode] = useState(false)
  const [newPersonId, setNewPersonId] = useState('')
  
  // Attendance tracking states
  const [attendanceMode, setAttendanceMode] = useState(false)
  const [currentDetectedPerson, setCurrentDetectedPerson] = useState<string | null>(null)
  const [stableDetectionCount, setStableDetectionCount] = useState(0)
  const [attendanceStatus, setAttendanceStatus] = useState<'waiting' | 'detecting' | 'confirmed' | 'recorded'>('waiting')

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)
  const fpsCounterRef = useRef({ frames: 0, lastTime: 0 })
  const canvasInitializedRef = useRef(false)
  const lastCaptureRef = useRef(0)
  const captureIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
  
  // Client-side SCRFD service for real-time processing
  const scrfdServiceRef = useRef<ClientSideScrfdService | null>(null)
  
  // Client-side EdgeFace service for face recognition
  const edgeFaceServiceRef = useRef<ClientSideEdgeFaceService | null>(null)

  // Define startProcessing first (will be defined later with useCallback)
  const startProcessingRef = useRef<(() => void) | null>(null)

  // Initialize client-side face detection and recognition
  const initializePipeline = useCallback(async () => {
    try {
      console.log('Initializing client-side face detection and recognition...')
      
      // Create and initialize client-side SCRFD service
      if (!scrfdServiceRef.current) {
        scrfdServiceRef.current = new ClientSideScrfdService()
      }
      
      // Create and initialize client-side EdgeFace service
      if (!edgeFaceServiceRef.current) {
        edgeFaceServiceRef.current = new ClientSideEdgeFaceService(0.6) // 60% similarity threshold
      }
      
      // Initialize SCRFD first
      console.log('🔄 Initializing SCRFD detection...')
      await scrfdServiceRef.current.initialize()
      console.log('✅ SCRFD detection ready')
      
      // Initialize EdgeFace second
      console.log('🔄 Initializing EdgeFace recognition...')
      await edgeFaceServiceRef.current.initialize()
      console.log('✅ EdgeFace recognition ready')
      
      // Load existing face database
      console.log('📂 Loading face database...')
      edgeFaceServiceRef.current.loadDatabase()
      
      setCameraStatus('recognition')
      console.log('🚀 Client-side face detection + EdgeFace recognition ready - RESEARCH-GRADE ACCURACY!')
      
      // Start processing immediately
      setTimeout(() => {
        console.log('Starting real-time processing with EdgeFace recognition')
        if (startProcessingRef.current) {
          startProcessingRef.current()
        }
      }, 100)
      
    } catch (error) {
      console.error('❌ Failed to initialize client-side pipeline:', error)
      console.error('📋 Detailed error:', error)
      setCameraStatus('stopped')
      
      // Show user-friendly error
      alert(`Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [])

  const startCamera = useCallback(async () => {
    try {
      console.log('Starting camera...')
      setIsStreaming(true)
      setCameraStatus('starting')

      // Get user media with ultra-low-latency settings for real-time recognition
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 60, min: 30 }, // Maximum FPS for real-time
          facingMode: 'user',
          // Disable ALL video processing that can cause delays
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
              
              try {
                // Ultra-low latency settings
                video.currentTime = 0
                
                // Critical low-latency attributes
                video.setAttribute('playsinline', 'true')
                video.setAttribute('webkit-playsinline', 'true')
                video.muted = true
                
                // Minimize buffering completely
                video.setAttribute('x5-video-player-type', 'h5')
                video.setAttribute('x5-video-player-fullscreen', 'false')
                video.setAttribute('x5-video-orientation', 'portrait') // Fixed typo: portraint → portrait
                
                // Set playback rate for minimal latency
                video.playbackRate = 1.0
                
                // Start playback immediately
                video.play().catch(err => {
                  console.error('Video playback failed:', err)
                })
              } catch (err) {
                console.error('Error configuring video:', err)
              }
            }          setCameraStatus('preview')
          
          // Initialize canvas size once when video loads - delay to ensure video is rendered
          setTimeout(() => {
            if (videoRef.current && canvasRef.current) {
              const video = videoRef.current
              const canvas = canvasRef.current
              
              // Get the actual display size of the video element
              const rect = video.getBoundingClientRect()
              
              // Set canvas to match video display size for perfect overlay (rounded for stability)
              const stableWidth = Math.round(rect.width)
              const stableHeight = Math.round(rect.height)
              
              canvas.width = stableWidth
              canvas.height = stableHeight
              canvasInitializedRef.current = true
              
              console.log('Canvas initialized with stable size:', canvas.width, 'x', canvas.height)
              console.log('Video natural size:', video.videoWidth, 'x', video.videoHeight)
              console.log('Video display size:', stableWidth, 'x', stableHeight)
            }
          }, 150) // Slightly longer delay to ensure video is fully rendered
          
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

  // Reuse canvases for better performance
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  
  const captureFrame = useCallback((): ImageData | null => {
    if (!videoRef.current || videoRef.current.videoWidth === 0) return null
    
    const video = videoRef.current
    
    
    // Create a reusable canvas only once
    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas')
      captureCanvasRef.current.width = video.videoWidth
      captureCanvasRef.current.height = video.videoHeight
    }
    
    const tempCanvas = captureCanvasRef.current
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })
    if (!tempCtx) return null
    
    // Update canvas size if video dimensions changed
    if (tempCanvas.width !== video.videoWidth || tempCanvas.height !== video.videoHeight) {
      tempCanvas.width = video.videoWidth
      tempCanvas.height = video.videoHeight
    }
    
    // Draw video frame to temp canvas at full resolution
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height)
    
    // Get image data from temp canvas (reuse existing buffer if possible)
    return tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height)
  }, [])

  const processFrameRealTime = useCallback(async () => {
    if (!isStreaming || cameraStatus !== 'recognition' || !scrfdServiceRef.current || !edgeFaceServiceRef.current) {
      return
    }

    try {
      const imageData = captureFrame()
      if (!imageData) {
        return
      }

      const startTime = performance.now()
      
      // Process frame through client-side SCRFD service - ZERO IPC LATENCY!
      const scrfdDetections = await scrfdServiceRef.current.detect(imageData)
      
      // Early exit if no faces detected - save computation!
      if (scrfdDetections.length === 0) {
        setDetectionResults([])
        return
      }
      
      // For real-time performance, prioritize processing the largest face only
      // Find the largest face (which is likely the closest/most important)
      let largestDetection = scrfdDetections[0]
      let largestArea = 0
      
      for (const det of scrfdDetections) {
        const [x1, y1, x2, y2] = det.bbox
        const area = (x2 - x1) * (y2 - y1)
        if (area > largestArea) {
          largestArea = area
          largestDetection = det
        }
      }
      
      // Create initial detection results with all faces but no recognition
      const detections: DetectionResult[] = scrfdDetections.map(det => ({
        bbox: det.bbox,
        confidence: det.confidence,
        landmarks: det.landmarks,
        recognition: {
          personId: null,
          similarity: 0
        }
      }))
      
      // Only run recognition on the largest face for real-time performance
      if (largestDetection.landmarks && largestDetection.landmarks.length >= 5) {
        try {
          // Process only the largest face for recognition
          const recognitionResult = await edgeFaceServiceRef.current.recognizeFace(imageData, largestDetection.landmarks)
          
          // Find the index of the largest detection
          const largestIndex = scrfdDetections.indexOf(largestDetection)
          
          // Update only that detection with recognition results
          if (largestIndex >= 0) {
            detections[largestIndex].recognition = {
              personId: recognitionResult.personId,
              similarity: recognitionResult.similarity
            }
          }
        } catch {
          // Silent fail - already have default recognition values
        }
      }
      
      const processingTime = performance.now() - startTime
      
      setDetectionResults(detections)
      setProcessingTime(processingTime)
      
      // Attendance tracking logic - enhanced with real recognition
      if (attendanceMode && detections.length > 0) {
        // Use null as initial value and handle the null case
        const largestDetection = detections.reduce((largest, current) => {
          if (!current) return largest
          
          const currentArea = (current.bbox[2] - current.bbox[0]) * (current.bbox[3] - current.bbox[1])
          const largestArea = largest ? (largest.bbox[2] - largest.bbox[0]) * (largest.bbox[3] - largest.bbox[1]) : 0
          return currentArea > largestArea ? current : largest
        }, detections[0]) // Initialize with first detection to avoid null
        
        // Check if face is centered and stable
        if (imageData && largestDetection) {
          const [x1, y1, x2, y2] = largestDetection.bbox
          const centerX = (x1 + x2) / 2
          const centerY = (y1 + y2) / 2
          const imgCenterX = imageData.width / 2
          const imgCenterY = imageData.height / 2
          
          // Check if face is reasonably centered (within 20% of center)
          const isCentered = Math.abs(centerX - imgCenterX) < imageData.width * 0.2 && 
                           Math.abs(centerY - imgCenterY) < imageData.height * 0.2
          
          if (isCentered && largestDetection.confidence > 0.7) {
            const recognizedId = largestDetection.recognition?.personId || 'unknown'
            
            if (currentDetectedPerson === recognizedId || currentDetectedPerson === null) {
              setCurrentDetectedPerson(recognizedId)
              setStableDetectionCount(prev => prev + 1)
              
              if (stableDetectionCount < 10) {
                setAttendanceStatus('detecting')
              } else if (stableDetectionCount >= 10 && stableDetectionCount < 30) {
                setAttendanceStatus('confirmed')
              } else if (stableDetectionCount >= 30) {
                setAttendanceStatus('recorded')
                // Auto-record attendance after 2 seconds of stable detection
                setTimeout(() => {
                  console.log(`📝 Attendance recorded for ${recognizedId}`)
                  setSystemStats(prev => ({ ...prev, today_records: prev.today_records + 1 }))
                  setAttendanceStatus('waiting')
                  setStableDetectionCount(0)
                  setCurrentDetectedPerson(null)
                }, 1000)
              }
            } else {
              // Different person detected, reset counter
              setStableDetectionCount(0)
              setAttendanceStatus('waiting')
              setCurrentDetectedPerson(recognizedId)
            }
          } else {
            // Reset if face moves or confidence drops
            setStableDetectionCount(0)
            setAttendanceStatus('waiting')
            setCurrentDetectedPerson(null)
          }
        }
      } else if (attendanceMode) {
        // No detections - reset
        setStableDetectionCount(0)
        setAttendanceStatus('waiting')
        setCurrentDetectedPerson(null)
      }
      
      // Update FPS counter for real-time monitoring
      fpsCounterRef.current.frames++
      
      const now = performance.now()
      if (now - fpsCounterRef.current.lastTime >= 1000) {
        setFps(fpsCounterRef.current.frames)
        fpsCounterRef.current.frames = 0
        fpsCounterRef.current.lastTime = now
      }
      
    } catch (error) {
      console.error('Client-side frame processing error:', error)
    }
  }, [isStreaming, cameraStatus, captureFrame, attendanceMode, stableDetectionCount, currentDetectedPerson])

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
    
    // Use adaptive frame processing with requestAnimationFrame instead of fixed interval
    const processNextFrame = async () => {
      if (isStreaming && cameraStatus === 'recognition') {
        const startTime = performance.now()
        await processFrameRealTime()
        
        // Adaptive timing - ensure minimum 33ms between frames (max ~30fps)
        // This creates a self-regulating system that won't overwhelm the CPU
        const processingDuration = performance.now() - startTime
        const delayTime = Math.max(0, 33 - processingDuration)
        
        setTimeout(() => {
          animationFrameRef.current = requestAnimationFrame(processNextFrame)
        }, delayTime)
      } else {
        // If not streaming or not in recognition mode, check again soon
        animationFrameRef.current = requestAnimationFrame(processNextFrame)
      }
    }
    
    // Start the adaptive processing loop
    animationFrameRef.current = requestAnimationFrame(processNextFrame)
    
    console.log('Real-time CLIENT-SIDE processing started with adaptive frame rate')
  }, [processFrameRealTime, isStreaming, cameraStatus])

  // Set the ref after the function is defined
  useEffect(() => {
    startProcessingRef.current = startProcessing
  }, [startProcessing])

  const registerFace = useCallback(async () => {
    if (!newPersonId.trim()) {
      alert('Please enter a person ID')
      return
    }
    
    if (!edgeFaceServiceRef.current) {
      alert('EdgeFace service not initialized')
      return
    }
    
    try {
      const imageData = captureFrame()
      if (!imageData) {
        alert('Failed to capture frame')
        return
      }
      
      // Find the largest face detection for registration
      // First check if we have any detections at all
      if (detectionResults.length === 0) {
        alert('No faces detected for registration')
        return
      }
      
      const largestDetection = detectionResults.reduce((largest, current) => {
        const currentArea = (current.bbox[2] - current.bbox[0]) * (current.bbox[3] - current.bbox[1])
        const largestArea = largest ? (largest.bbox[2] - largest.bbox[0]) * (largest.bbox[3] - largest.bbox[1]) : 0
        return currentArea > largestArea ? current : largest
      }, detectionResults[0]) // Initialize with first detection to avoid null
      
      if (!largestDetection || !largestDetection.landmarks || largestDetection.landmarks.length < 5) {
        alert('No face with sufficient landmarks detected for registration')
        return
      }
      
      // Register face using EdgeFace
      const success = await edgeFaceServiceRef.current.registerPerson(
        newPersonId.trim(), 
        imageData, 
        largestDetection.landmarks
      )
      
      if (success) {
        // Save database to localStorage
        edgeFaceServiceRef.current.saveDatabase()
        
        alert(`✅ Successfully registered ${newPersonId} with EdgeFace (Research-Grade Accuracy)`)
        setNewPersonId('')
        setRegistrationMode(false)
        setSystemStats(prev => ({ ...prev, total_people: prev.total_people + 1 }))
        
        console.log(`🎉 ${newPersonId} registered in EdgeFace database`)
      } else {
        alert('❌ Registration failed - Please try again with better face positioning')
      }
      
    } catch (error) {
      console.error('Registration error:', error)
      alert('Registration failed due to technical error')
    }
  }, [newPersonId, detectionResults, captureFrame])

  // Cache for storing pre-calculated values
  const drawCacheRef = useRef({
    lastVideoWidth: 0,
    lastVideoHeight: 0,
    scaleX: 1,
    scaleY: 1
  })
  
  const drawDetections = useCallback(() => {
    if (!canvasRef.current || !videoRef.current) return
    
    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    
    // Check if video dimensions changed, recalculate only if needed
    if (video.videoWidth !== drawCacheRef.current.lastVideoWidth || 
        video.videoHeight !== drawCacheRef.current.lastVideoHeight) {
      drawCacheRef.current.lastVideoWidth = video.videoWidth
      drawCacheRef.current.lastVideoHeight = video.videoHeight
      
      // Get current video display size
      const rect = video.getBoundingClientRect()
      const displayWidth = Math.round(rect.width)
      const displayHeight = Math.round(rect.height)
      
      // Only resize canvas if there's a significant size change (prevent micro-adjustments)
      const sizeDiffThreshold = 5 // increased threshold
      const widthDiff = Math.abs(canvas.width - displayWidth)
      const heightDiff = Math.abs(canvas.height - displayHeight)
      
      if (widthDiff > sizeDiffThreshold || heightDiff > sizeDiffThreshold) {
        canvas.width = displayWidth
        canvas.height = displayHeight
      }
      
      // Pre-calculate scale factors only when dimensions change
      drawCacheRef.current.scaleX = canvas.width / video.videoWidth
      drawCacheRef.current.scaleY = canvas.height / video.videoHeight
    }
    
    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Get cached scale factors
    const { scaleX, scaleY } = drawCacheRef.current
    
    // Draw detections with optimized rendering
    for (const detection of detectionResults) {
      const [x1, y1, x2, y2] = detection.bbox
      
      // Scale coordinates from video natural size to display size
      const scaledX1 = x1 * scaleX
      const scaledY1 = y1 * scaleY
      const scaledX2 = x2 * scaleX
      const scaledY2 = y2 * scaleY
      
      // Draw bounding box with better styling
      ctx.strokeStyle = detection.recognition?.personId ? '#00ff00' : '#ff0000'
      ctx.lineWidth = 2
      ctx.strokeRect(scaledX1, scaledY1, scaledX2 - scaledX1, scaledY2 - scaledY1)
      
      // Draw label with better background
      const label = detection.recognition?.personId 
        ? `${detection.recognition.personId} (${(detection.recognition.similarity * 100).toFixed(1)}%)`
        : `Unknown (${(detection.confidence * 100).toFixed(1)}%)`
      
      ctx.font = '14px Arial'
      const textMetrics = ctx.measureText(label)
      
      // Draw text background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
      ctx.fillRect(scaledX1, scaledY1 - 20, textMetrics.width + 8, 18)
      
      // Draw text
      ctx.fillStyle = detection.recognition?.personId ? '#00ff00' : '#ff0000'
      ctx.fillText(label, scaledX1 + 4, scaledY1 - 6)
      
      // Draw only first 5 landmarks for performance
      if (detection.landmarks && detection.landmarks.length > 0) {
        ctx.fillStyle = '#ffff00'
        const maxLandmarks = Math.min(detection.landmarks.length, 5)
        for (let i = 0; i < maxLandmarks; i++) {
          if (!detection.landmarks[i] || detection.landmarks[i].length < 2) continue
          
          const [x, y] = detection.landmarks[i]
          if (isNaN(x) || isNaN(y)) continue
          
          const scaledLandmarkX = x * scaleX
          const scaledLandmarkY = y * scaleY
          ctx.beginPath()
          ctx.arc(scaledLandmarkX, scaledLandmarkY, 2, 0, 2 * Math.PI)
          ctx.fill()
        }
      }
    }
  }, [detectionResults])

  // Draw detections overlay
  useEffect(() => {
    if (isStreaming) {
      drawDetections()
    }
  }, [detectionResults, drawDetections, isStreaming])

  // Handle window resize to keep canvas aligned
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout
    
    const handleResize = () => {
      // Debounce resize events to prevent constant recalculation
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        if (videoRef.current && canvasRef.current && canvasInitializedRef.current) {
          const video = videoRef.current
          const canvas = canvasRef.current
          const rect = video.getBoundingClientRect()
          
          // Update canvas size to match current video display size (with stability threshold)
          const newWidth = Math.round(rect.width)
          const newHeight = Math.round(rect.height)
          const sizeDiffThreshold = 5 // Larger threshold for resize events
          
          const widthDiff = Math.abs(canvas.width - newWidth)
          const heightDiff = Math.abs(canvas.height - newHeight)
          
          if (widthDiff > sizeDiffThreshold || heightDiff > sizeDiffThreshold) {
            console.log(`Resize: Canvas ${canvas.width}x${canvas.height} → ${newWidth}x${newHeight}`)
            canvas.width = newWidth
            canvas.height = newHeight
            
            // Redraw detections with new size
            drawDetections()
          }
        }
      }, 100) // 100ms debounce
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeTimeout)
    }
  }, [drawDetections])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
      
      // Clean up any canvas references
      if (captureCanvasRef.current) {
        captureCanvasRef.current = null
      }
      
      // Release services to help with garbage collection
      if (scrfdServiceRef.current) {
        // Ideally these services would have a dispose method
        scrfdServiceRef.current = null
      }
      
      if (edgeFaceServiceRef.current) {
        edgeFaceServiceRef.current = null
      }
    }
  }, [stopCamera])

  return (
    <div className="bg-black text-white pb-2">
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
            className={`px-6 py-3 rounded-xl text-sm font-light backdrop-blur-xl border transition-all duration-500 ${
              registrationMode
                ? 'bg-blue-500/20 border-blue-400/30 text-blue-300'
                : 'bg-white/[0.05] border-white/[0.10] text-white/80 hover:bg-white/[0.08]'
            }`}
          >
            {registrationMode ? '✕ Cancel' : '👤 Register Face'}
          </button>
          
          <button
            onClick={() => setAttendanceMode(!attendanceMode)}
            className={`px-6 py-3 rounded-xl text-sm font-light backdrop-blur-xl border transition-all duration-500 ${
              attendanceMode
                ? 'bg-green-500/20 border-green-400/30 text-green-300'
                : 'bg-white/[0.05] border-white/[0.10] text-white/80 hover:bg-white/[0.08]'
            }`}
          >
            {attendanceMode ? '✅ Stop Attendance' : '📝 Mark Attendance'}
          </button>
          
          <div className="flex items-center space-x-4 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-green-400"></div>
              <span>Camera: {cameraStatus}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-blue-400"></div>
              <span>FPS: {fps}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-purple-400"></div>
              <span>Processing: {processingTime.toFixed(2)}ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Video Stream */}
        <div className="flex-1 relative flex items-center justify-center">
          <div className="relative w-full max-w-4xl aspect-video overflow-hidden rounded-lg">
            <video
              ref={videoRef}
              className="w-full h-full object-cover block"
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '100%'
              }}
              autoPlay
              playsInline
              muted
            />
            
            {/* Canvas Overlay for Detections */}
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 w-full h-full pointer-events-none"
              style={{ 
                zIndex: 1000,
                mixBlendMode: 'normal',
                position: 'absolute'
              }}
            />
            
            {/* Status Overlay */}
            {cameraStatus === 'starting' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                  <div className="text-white text-lg">Starting Camera...</div>
                </div>
              </div>
            )}
            
            {cameraStatus === 'preview' && (
              <div className="absolute top-4 left-4 bg-black/50 px-3 py-1 rounded text-sm">
                Preview Mode - Loading Recognition...
              </div>
            )}
            
            {cameraStatus === 'recognition' && (
              <div className="absolute top-4 left-4 bg-green-500/50 px-3 py-1 rounded text-sm">
                ⚡ EdgeFace Recognition Active (Research-Grade)
              </div>
            )}
            
            {/* Attendance Mode Overlay */}
            {attendanceMode && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Center guide */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                  <div className="w-64 h-64 border-2 border-dashed border-white/50 rounded-lg flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-white/70 text-sm mb-2">Position your face here</div>
                      <div className="w-4 h-4 bg-white/50 rounded-full mx-auto"></div>
                    </div>
                  </div>
                </div>
                
                {/* Attendance Status */}
                <div className="absolute top-4 right-4 bg-black/70 px-4 py-2 rounded-lg">
                  <div className="text-white text-sm font-medium mb-1">Attendance Mode</div>
                  <div className={`text-sm ${
                    attendanceStatus === 'waiting' ? 'text-gray-400' :
                    attendanceStatus === 'detecting' ? 'text-yellow-400' :
                    attendanceStatus === 'confirmed' ? 'text-blue-400' :
                    'text-green-400'
                  }`}>
                    {attendanceStatus === 'waiting' && '👀 Looking for face...'}
                    {attendanceStatus === 'detecting' && `🎯 Detecting... ${stableDetectionCount}/10`}
                    {attendanceStatus === 'confirmed' && `✅ Confirmed! ${stableDetectionCount}/30`}
                    {attendanceStatus === 'recorded' && '📝 Recording attendance...'}
                  </div>
                </div>
                
                {/* Instructions */}
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 px-6 py-3 rounded-lg">
                  <div className="text-white text-sm text-center">
                    <div className="font-medium mb-1">Instructions:</div>
                    <div>1. Position face in center box</div>
                    <div>2. Stay still for 2 seconds</div>
                    <div>3. Wait for green confirmation</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 bg-white/[0.02] border-l border-white/[0.1] p-6">
          {/* Registration Form */}
          {registrationMode && (
            <div className="mb-6 p-4 bg-white/[0.05] rounded-lg border border-white/[0.1]">
              <h3 className="text-lg font-medium mb-4">Register New Person</h3>
              <div className="space-y-4">
                <input
                  type="text"
                  value={newPersonId}
                  onChange={(e) => setNewPersonId(e.target.value)}
                  placeholder="Enter Person ID"
                  className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded text-white placeholder-white/50"
                />
                <div className="flex space-x-2">
                  <button
                    onClick={registerFace}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    Register
                  </button>
                  <button
                    onClick={() => setRegistrationMode(false)}
                    className="px-4 py-2 bg-white/[0.1] text-white rounded hover:bg-white/[0.2] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Attendance Status */}
          {attendanceMode && (
            <div className="mb-6 p-4 bg-green-500/10 rounded-lg border border-green-500/30">
              <h3 className="text-lg font-medium mb-4 text-green-300">Attendance Mode Active</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-white/70">Status:</span>
                  <span className={`font-medium ${
                    attendanceStatus === 'waiting' ? 'text-gray-400' :
                    attendanceStatus === 'detecting' ? 'text-yellow-400' :
                    attendanceStatus === 'confirmed' ? 'text-blue-400' :
                    'text-green-400'
                  }`}>
                    {attendanceStatus === 'waiting' && 'Waiting for face'}
                    {attendanceStatus === 'detecting' && 'Detecting face'}
                    {attendanceStatus === 'confirmed' && 'Face confirmed'}
                    {attendanceStatus === 'recorded' && 'Attendance recorded'}
                  </span>
                </div>
                {attendanceStatus !== 'waiting' && (
                  <div className="flex justify-between">
                    <span className="text-white/70">Progress:</span>
                    <span className="text-white">
                      {stableDetectionCount}/{attendanceStatus === 'detecting' ? '10' : '30'}
                    </span>
                  </div>
                )}
                {currentDetectedPerson && (
                  <div className="flex justify-between">
                    <span className="text-white/70">Person:</span>
                    <span className="text-white">{currentDetectedPerson}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Detection Results */}
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-4">Live Detections</h3>
            <div className="space-y-2">
              {detectionResults.length === 0 ? (
                <div className="text-white/50 text-sm">No faces detected</div>
              ) : (
                detectionResults.map((detection, index) => (
                  <div key={index} className="p-3 bg-white/[0.05] rounded border border-white/[0.1]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">
                        {detection.recognition?.personId || 'Unknown'}
                      </span>
                      <span className="text-xs text-white/60">
                        {detection.confidence.toFixed(2)}
                      </span>
                    </div>
                    {detection.recognition?.personId && (
                      <div className="text-xs text-green-400">
                        Similarity: {(detection.recognition.similarity * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* System Stats */}
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-4">System Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-white/70">People in DB:</span>
                <span className="text-white">{systemStats.total_people}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Today's Records:</span>
                <span className="text-white">{systemStats.today_records}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Current FPS:</span>
                <span className="text-green-400">{fps}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Processing Time:</span>
                <span className="text-purple-400">{processingTime.toFixed(2)}ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}