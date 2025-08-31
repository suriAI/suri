import { useState, useEffect, useRef, useCallback } from 'react'



interface RecognitionResult {
  name: string | null
  confidence: number
  bbox: [number, number, number, number]
  quality: number
  method: string
  shouldLog: boolean
}

interface AttendanceRecord {
  name: string
  timestamp: string
  confidence: number
  time: string
}

interface CameraDevice {
  index: number
  name: string
  backend: string
  backend_id?: number
  works: boolean
  width: number
  height: number
  fps: number
}

export default function LiveCameraRecognition() {
  const [isStreaming, setIsStreaming] = useState(false)
  const [recognitionResults] = useState<RecognitionResult[]>([])
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([])
  const [showAddPerson, setShowAddPerson] = useState(false)
  const [newPersonName, setNewPersonName] = useState('')
  const [isAddingPerson, setIsAddingPerson] = useState(false)
  const [systemStats, setSystemStats] = useState({ today_records: 0, total_people: 0 })
  const [cameraStatus, setCameraStatus] = useState<'stopped' | 'starting' | 'preview' | 'recognition'>('stopped')
  const [availableCameras, setAvailableCameras] = useState<CameraDevice[]>([])
  const [currentCamera, setCurrentCamera] = useState<number>(0)
  const [showCameraSelector, setShowCameraSelector] = useState(false)
  const [isLoadingCameras, setIsLoadingCameras] = useState(false)
  
  const imgRef = useRef<HTMLImageElement>(null)
  const frameUrlRef = useRef<string | null>(null)
  const streamingRef = useRef(false)
  const wsUnsubRef = useRef<(() => void) | null>(null)
  const cameraSelectorRef = useRef<HTMLDivElement>(null)

    const connectWebSocket = useCallback(() => {
    try {
      // Use the video API's WebSocket broadcast handler
      if (window.suriVideo) {
        const isAttendance = (m: Record<string, unknown>): m is { type: string; event: { type: string; data: { person_name: string; confidence: number; record: AttendanceRecord; timestamp: number } } } => {
          const event = m?.event as Record<string, unknown>
          const eventType = event?.type
          const data = event?.data as Record<string, unknown>
          return eventType === 'attendance_logged' && Boolean(data?.person_name) && Boolean(data?.record)
        }
        wsUnsubRef.current = window.suriVideo.onWebSocketBroadcast((msg) => {
          if (isAttendance(msg)) {
            const record = msg.event.data.record
            setTodayAttendance(prev => [...prev, record])
            setSystemStats(prev => ({ ...prev, today_records: prev.today_records + 1 }))
          }
        })
      }
    } catch (error) {
      console.error('WebSocket broadcast connection failed:', error)
    }
  }, [])

  const fetchTodayAttendance = useCallback(async () => {
    try {
  const response = await fetch('http://127.0.0.1:8770/attendance/today')
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setTodayAttendance(data.records)
          setSystemStats(prev => ({ ...prev, today_records: data.records.length }))
        }
      }
    } catch (error) {
      console.error('Failed to fetch attendance:', error)
    }
  }, [])

  const stopStream = useCallback(async () => {
    try {
      setIsStreaming(false)
      streamingRef.current = false
      setCameraStatus('stopped')
      // Clean up blob URL if exists
      if (imgRef.current && imgRef.current.src) {
        if (imgRef.current.src.startsWith('blob:')) URL.revokeObjectURL(imgRef.current.src)
        imgRef.current.src = ''
        frameUrlRef.current = null
      }
      // unsubscribe frame listener if any
      if (window.__suriOffFrame) {
        try { window.__suriOffFrame() } catch (e) { console.warn('offFrame cleanup error', e) }
        window.__suriOffFrame = undefined
      }
      if (window.suriVideo) await window.suriVideo.stop()
    } catch (error) {
      console.error('Failed to stop stream:', error)
    }
  }, [])

  const startStream = useCallback(async () => {
    try {
      await stopStream()
    if (!window.suriVideo) throw new Error('suriVideo API not available')
    
    // Set UI to streaming immediately for instant feedback
    setIsStreaming(true)
    streamingRef.current = true
    setCameraStatus('preview')  // Skip 'starting' status for instant feel
    
    // Set up optimized frame handler for smooth real-time display
    let lastSet = 0
    const frameQueue: string[] = []
    const offFrame = window.suriVideo.onFrame((buf) => {
        try {
          const u8 = (buf instanceof ArrayBuffer) ? new Uint8Array(buf) : (buf as Uint8Array)
          const ab = new ArrayBuffer(u8.byteLength)
          new Uint8Array(ab).set(u8)
          const blob = new Blob([ab], { type: 'image/jpeg' })
          const url = URL.createObjectURL(blob)
          
          if (imgRef.current) {
            const now = performance.now()
            // Optimized frame rate limiting for smooth 25-30 FPS display
            if (now - lastSet < 33) { // ~30 fps max, prevents overwhelming browser
              URL.revokeObjectURL(url)
              return
            }
            
            // Clean up old frames to prevent memory leaks
            if (frameUrlRef.current) {
              URL.revokeObjectURL(frameUrlRef.current)
            }
            
            // Clean up frame queue if it gets too long
            while (frameQueue.length > 2) {
              const oldUrl = frameQueue.shift()
              if (oldUrl) URL.revokeObjectURL(oldUrl)
            }
            
            frameUrlRef.current = url
            frameQueue.push(url)
            imgRef.current.src = url
            lastSet = now
            
            // Auto-upgrade to preview on first frame
            if (streamingRef.current) setCameraStatus('preview')
          }
        } catch (e) {
          console.error('onFrame error', e)
        }
      })
    window.__suriOffFrame = offFrame
    
    // Start camera with fast startup (this should trigger frames immediately)
    await window.suriVideo.startFast({ device: currentCamera, annotate: true })
    
    } catch (error) {
      console.error('Failed to start stream:', error)
      setIsStreaming(false)
      streamingRef.current = false
      setCameraStatus('stopped')
    }
  }, [stopStream, currentCamera])

  useEffect(() => {
    connectWebSocket()
    fetchTodayAttendance()
    fetchAvailableCameras()
    
    // Listen for video events to update camera status
    const handleVideoEvent = (evt: Record<string, unknown>) => {
      if (evt.type === 'video.fast_preview_ready') {
        setCameraStatus('preview')
      } else if (evt.type === 'video.recognition_ready') {
        setCameraStatus('recognition')
      } else if (evt.type === 'video.models_loaded') {
        setCameraStatus('recognition')
      } else if (evt.type === 'video.error') {
        setCameraStatus('stopped')
        setIsStreaming(false)
        streamingRef.current = false
      }
    }
    
    const offVideoEvent = window.suriVideo?.onEvent?.(handleVideoEvent)
    
    return () => {
      if (wsUnsubRef.current) wsUnsubRef.current()
      if (offVideoEvent) offVideoEvent()
      stopStream()
    }
  }, [connectWebSocket, fetchTodayAttendance, stopStream])

  // Close camera selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (cameraSelectorRef.current && !cameraSelectorRef.current.contains(event.target as Node)) {
        setShowCameraSelector(false)
      }
    }

    if (showCameraSelector) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showCameraSelector])

  const addPersonFromCamera = async () => {
    if (!newPersonName.trim()) return
    
    setIsAddingPerson(true)
    try {
      // Capture current frame from the video stream
      if (!imgRef.current) {
        throw new Error('No video frame available')
      }
      
      // Create a canvas to capture the current frame
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Canvas context not available')
      }
      
      // Set canvas size to match image
      canvas.width = imgRef.current.naturalWidth
      canvas.height = imgRef.current.naturalHeight
      
      // Draw the current video frame to canvas
      ctx.drawImage(imgRef.current, 0, 0)
      
      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to capture frame'))
          }
        }, 'image/jpeg', 0.9)
      })
      
      // Send the captured frame to the regular add person endpoint
      const form = new FormData()
      form.append('name', newPersonName.trim())
      form.append('file', blob, 'camera_capture.jpg')
      
      const response = await fetch('http://127.0.0.1:8770/person/add', {
        method: 'POST',
        body: form
      })
      
      if (!response.ok) {
        // Handle HTTP errors
        let errorMessage = `HTTP ${response.status}`
        try {
          const errorData = await response.json()
          errorMessage = errorData.detail || errorData.message || errorMessage
        } catch {
          // Failed to parse JSON, use status text
          errorMessage = response.statusText || errorMessage
        }
        throw new Error(errorMessage)
      }
      
      const data = await response.json()
      if (data.success) {
        alert(`✅ ${newPersonName} added successfully!`)
        setNewPersonName('')
        setShowAddPerson(false)
        fetchSystemStats()
      } else {
        alert(`❌ Failed to add ${newPersonName}: ${data.message || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Add person error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Connection error'
      alert(`❌ Failed to add ${newPersonName}: ${errorMessage}`)
    } finally {
      setIsAddingPerson(false)
    }
  }

  const fetchSystemStats = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8770/system/status')
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setSystemStats({
            today_records: data.attendance_stats?.today_records ?? 0,
            total_people: data.database_stats?.total_people ?? 0
          })
        }
      }
    } catch (error) {
      console.error('Failed to fetch system stats:', error)
    }
  }

  const clearAttendance = async () => {
    if (!confirm('⚠️ Clear ALL attendance records? This cannot be undone.')) return
    
    try {
  const response = await fetch('http://127.0.0.1:8770/attendance/clear', {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setTodayAttendance([])
        alert('✅ Attendance log cleared!')
      }
    } catch (error) {
      console.error('Failed to clear attendance:', error)
    }
  }

  const fetchAvailableCameras = async () => {
    setIsLoadingCameras(true)
    try {
      const response = await fetch('http://127.0.0.1:8770/video/devices')
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAvailableCameras(data.devices)
          setCurrentCamera(data.current_device)
        }
      }
    } catch (error) {
      console.error('Failed to fetch cameras:', error)
    } finally {
      setIsLoadingCameras(false)
    }
  }

  const switchCamera = async (deviceIndex: number) => {
    try {
      // Stop current stream if running
      if (isStreaming) {
        await stopStream()
        // Small delay to ensure clean shutdown
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      
      const response = await fetch('http://127.0.0.1:8770/video/set_device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ device_index: deviceIndex })
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setCurrentCamera(deviceIndex)
          setShowCameraSelector(false)
          
          // If we were streaming before, restart with new camera
          if (streamingRef.current) {
            // Small delay before restarting
            setTimeout(() => {
              startStream()
            }, 300)
          }
          
          // Show success message
          const camera = availableCameras.find(c => c.index === deviceIndex)
          alert(`✅ Switched to: ${camera?.name || `Camera ${deviceIndex}`}`)
        } else {
          alert(`❌ Failed to switch camera: ${data.message || 'Unknown error'}`)
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        alert(`❌ Failed to switch camera: ${errorData.detail || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to switch camera:', error)
      alert('❌ Failed to switch camera: Network error')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Glass Morphism Control Bar */}
      <div className="px-8 py-6 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <button
            onClick={isStreaming ? stopStream : startStream}
            className={`px-8 py-3 rounded-xl text-sm font-light backdrop-blur-xl border transition-all duration-500 ${
              isStreaming 
                ? 'bg-white/[0.08] border-white/[0.15] text-white hover:bg-white/[0.12]'
                : 'bg-white/[0.05] border-white/[0.10] text-white/80 hover:bg-white/[0.08]'
            }`}
          >
            {isStreaming ? '⏹ Stop Camera' : '▶ Start Camera'}
          </button>
          
          {isStreaming && (
            <div className="flex items-center space-x-3">
              <button
                onClick={() => { window.suriVideo?.pause() }}
                className="px-4 py-2 rounded-xl text-xs font-light text-white/60 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] backdrop-blur-xl border border-white/[0.08] transition-all duration-300"
              >
                ⏸ Pause
              </button>
              <button
                onClick={() => { window.suriVideo?.resume() }}
                className="px-4 py-2 rounded-xl text-xs font-light text-white/60 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] backdrop-blur-xl border border-white/[0.08] transition-all duration-300"
              >
                ▶ Resume
              </button>
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-6">
          <div className="text-center px-4 py-2 bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl">
            <div className="text-[10px] text-white/50 uppercase tracking-[0.1em] font-light">Status</div>
            <div className={`text-sm font-extralight ${isStreaming ? 'text-white' : 'text-white/40'}`}>
              {cameraStatus === 'stopped' && '○ Stopped'}
              {cameraStatus === 'preview' && '📹 Preview'}
              {cameraStatus === 'recognition' && '● Recognition'}
            </div>
          </div>
          
          <div className="text-center px-4 py-2 bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl">
            <div className="text-[10px] text-white/50 uppercase tracking-[0.1em] font-light">Today</div>
            <div className="text-sm font-extralight text-white">{systemStats.today_records}</div>
          </div>
          
          <div className="relative" ref={cameraSelectorRef}>
            <button
              onClick={() => setShowCameraSelector(!showCameraSelector)}
              className="px-4 py-2 rounded-xl text-xs font-light text-white/60 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] backdrop-blur-xl border border-white/[0.08] transition-all duration-300 flex items-center gap-2"
            >
              📷 {availableCameras.find(c => c.index === currentCamera)?.name?.split(' ')[0] || `Camera ${currentCamera}`}
              <span className="text-white/40">▼</span>
            </button>
            
            {showCameraSelector && (
              <div className="absolute top-full left-0 mt-2 min-w-[280px] bg-black/80 backdrop-blur-xl border border-white/[0.15] rounded-xl overflow-hidden z-50">
                <div className="p-3 border-b border-white/[0.10]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/70 font-light">Select Camera</span>
                    <button
                      onClick={fetchAvailableCameras}
                      disabled={isLoadingCameras}
                      className="text-xs text-white/50 hover:text-white/80 transition-colors"
                    >
                      {isLoadingCameras ? '⟳' : '↻'}
                    </button>
                  </div>
                </div>
                
                {isLoadingCameras ? (
                  <div className="p-4 text-center">
                    <div className="text-sm text-white/60">Scanning cameras...</div>
                  </div>
                ) : availableCameras.length === 0 ? (
                  <div className="p-4 text-center">
                    <div className="text-sm text-white/60">No cameras found</div>
                    <div className="text-xs text-white/40 mt-1">Check camera connections</div>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {availableCameras.map((camera) => (
                      <button
                        key={camera.index}
                        onClick={() => switchCamera(camera.index)}
                        className={`w-full p-3 text-left hover:bg-white/[0.05] transition-colors border-b border-white/[0.05] last:border-b-0 ${
                          camera.index === currentCamera ? 'bg-white/[0.08] text-white' : 'text-white/80'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-light">{camera.name}</div>
                            <div className="text-xs text-white/50 mt-1">
                              {camera.width}x{camera.height} • {camera.backend}
                              {camera.index === currentCamera && ' • Active'}
                            </div>
                          </div>
                          <div className={`w-2 h-2 rounded-full ${camera.works ? 'bg-green-400' : 'bg-red-400'}`} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAddPerson(true)}
            disabled={!isStreaming}
            className="px-4 py-2 rounded-xl text-xs font-light text-white/60 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] backdrop-blur-xl border border-white/[0.08] transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            + Add Person
          </button>
          
          <button
            onClick={fetchTodayAttendance}
            className="px-4 py-2 rounded-xl text-xs font-light text-white/60 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] backdrop-blur-xl border border-white/[0.08] transition-all duration-300"
          >
            ↻ Refresh
          </button>
          
          <button
            onClick={clearAttendance}
            className="px-4 py-2 rounded-xl text-xs font-light text-white/40 hover:text-white/80 bg-white/[0.02] hover:bg-white/[0.05] backdrop-blur-xl border border-white/[0.05] transition-all duration-300"
          >
            🗑 Clear Log
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 px-8 pb-8 gap-6">
        {/* Glass Video Feed */}
        <div className="flex-1">
          <div className="h-[70vh] bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden">
            {isStreaming ? (
              <div className="relative h-full">
                {/* Camera feed image */}
                <img
                  ref={imgRef}
                  className="w-full h-full object-contain bg-black rounded-2xl"
                />
                

                
                {/* Centered loader when image hasn't rendered yet */}
                {cameraStatus === 'preview' && !imgRef.current?.src && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm">
                    <div className="text-center">
                      
                      <div className="flex items-center justify-center mb-2">
                        <svg className="w-8 h-8 text-white/60 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </div>

                      <p className="text-sm text-white/80 font-light">Loading...</p>
                      <p className="text-xs text-white/50 mt-1 font-light">will activate shortly</p>
                    </div>
                  </div>
                )}
                
                {/* Glass Recognition Overlays */}
                {recognitionResults.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none">
                    {recognitionResults.map((result, index) => (
                      <div
                        key={index}
                        className="absolute top-6 left-6 px-4 py-3 rounded-xl backdrop-blur-xl text-xs bg-white/[0.08] border border-white/[0.15]"
                      >
                        <div className="font-light text-white">
                          {result.name || 'Unknown'} ({(result.confidence * 100).toFixed(1)}%)
                        </div>
                        <div className="text-xs text-white/60 mt-1">
                          Quality: {result.quality.toFixed(2)} • {result.method}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
        
        {/* Narrow Glass Attendance Panel */}
        <div className="w-64">
          <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl h-[70vh] flex flex-col">
            <div className="p-4 border-b border-white/[0.05]">
              <h3 className="text-[10px] font-light text-white/60 uppercase tracking-[0.15em]">Today's Activity</h3>
              <div className="text-2xl font-extralight text-white mt-2">{systemStats.today_records}</div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3">
                             {systemStats.today_records > 0 ? (
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

      {/* Glass Add Person Modal */}
      {showAddPerson && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50">
          <div className="bg-white/[0.05] backdrop-blur-xl border border-white/[0.15] rounded-2xl p-8 w-96 max-w-full mx-4">
            <h3 className="text-xl font-light text-white mb-6">Add New Person</h3>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm text-white/60 mb-3 font-light">Person's Name</label>
                <input
                  type="text"
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  placeholder="Enter full name"
                  className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/[0.20] focus:bg-white/[0.05] transition-all duration-300 font-light"
                  disabled={isAddingPerson}
                />
              </div>
              
              <div className="text-xs text-white/50 bg-white/[0.02] p-4 rounded-xl font-light">
                Position the person's face in the camera and click Add Person.
              </div>
              
              <div className="flex items-center space-x-4 pt-2">
                <button
                  onClick={addPersonFromCamera}
                  disabled={!newPersonName.trim() || isAddingPerson}
                  className="flex-1 px-6 py-3 bg-white/[0.08] border border-white/[0.15] text-white rounded-xl hover:bg-white/[0.12] transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed font-light"
                >
                  {isAddingPerson ? 'Adding...' : 'Add Person'}
                </button>
                
                <button
                  onClick={() => {
                    setShowAddPerson(false)
                    setNewPersonName('')
                  }}
                  disabled={isAddingPerson}
                  className="px-6 py-3 text-white/60 hover:text-white bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] rounded-xl transition-all duration-300 disabled:opacity-30 font-light"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

