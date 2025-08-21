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

export default function LiveCameraRecognition() {
  const [isStreaming, setIsStreaming] = useState(false)
  const [recognitionResults] = useState<RecognitionResult[]>([])
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([])
  const [showAddPerson, setShowAddPerson] = useState(false)
  const [newPersonName, setNewPersonName] = useState('')
  const [isAddingPerson, setIsAddingPerson] = useState(false)
  const [systemStats, setSystemStats] = useState({ today_records: 0, total_people: 0 })
  
  const imgRef = useRef<HTMLImageElement>(null)
  const frameUrlRef = useRef<string | null>(null)
  const streamingRef = useRef(false)
  const wsUnsubRef = useRef<(() => void) | null>(null)

  const connectWebSocket = useCallback(() => {
    try {
      // Use preload-exposed client so it reconnects automatically
      if (window.suriWS) {
        window.suriWS.connect('ws://127.0.0.1:8770/ws')
        const isAttendance = (m: Record<string, unknown>): m is { type: string; records: AttendanceRecord[] } => {
          const maybeType = m?.['type']
          const maybeRecs = (m as unknown as { records?: unknown }).records
          return maybeType === 'attendance_logged' && Array.isArray(maybeRecs)
        }
        wsUnsubRef.current = window.suriWS.onMessage((msg) => {
          if (isAttendance(msg)) {
            setTodayAttendance(prev => [...prev, ...msg.records])
          }
        })
      }
    } catch (error) {
      console.error('WebSocket connection failed:', error)
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
    await window.suriVideo.start({ device: 0, annotate: true })
  let lastSet = 0
  const offFrame = window.suriVideo.onFrame((buf) => {
        try {
          const u8 = (buf instanceof ArrayBuffer) ? new Uint8Array(buf) : (buf as Uint8Array)
          const ab = new ArrayBuffer(u8.byteLength)
          new Uint8Array(ab).set(u8)
          const blob = new Blob([ab], { type: 'image/jpeg' })
          const url = URL.createObjectURL(blob)
          if (imgRef.current) {
            const now = performance.now()
            if (now - lastSet < 12) { // ~80 fps guard; avoid thrash
              URL.revokeObjectURL(url)
              return
            }
            if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current)
            frameUrlRef.current = url
            imgRef.current.src = url
            lastSet = now
          }
        } catch (e) {
          console.error('onFrame error', e)
        }
      })
      // Keep unsubscriber in ref to cleanup when stopping
    window.__suriOffFrame = offFrame
      setIsStreaming(true)
      streamingRef.current = true
    } catch (error) {
      console.error('Failed to start stream:', error)
      setIsStreaming(false)
      streamingRef.current = false
    }
  }, [stopStream])

  useEffect(() => {
    connectWebSocket()
    fetchTodayAttendance()
    
    return () => {
      if (wsUnsubRef.current) wsUnsubRef.current()
      stopStream()
    }
  }, [connectWebSocket, fetchTodayAttendance, stopStream])

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
              {isStreaming ? '● Live' : '○ Stopped'}
            </div>
          </div>
          
          <div className="text-center px-4 py-2 bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl">
            <div className="text-[10px] text-white/50 uppercase tracking-[0.1em] font-light">Today</div>
            <div className="text-sm font-extralight text-white">{systemStats.today_records}</div>
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
      <div className="flex flex-1 px-8 pb-8 gap-8">
        {/* Glass Video Feed */}
        <div className="flex-1">
          <div className="h-[70vh] bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden">
            {isStreaming ? (
              <div className="relative h-full">
                <img
                  ref={imgRef}
                  className="w-full h-full object-contain bg-black rounded-2xl"
                  alt="Live camera feed"
                />
                
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
                  <div className="text-6xl mb-4">📹</div>
                  <p className="text-lg font-extralight text-white/80">Camera Stopped</p>
                  <p className="text-sm mt-2 text-white/40 font-light">Click "Start Camera" to begin</p>
                </div>
              </div>
            )}
          </div>
        
        {/* Glass Attendance Panel */}
        <div className="w-80">
          <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl h-[70vh] flex flex-col">
            <div className="p-6 border-b border-white/[0.05]">
              <h3 className="text-xs font-light text-white/60 uppercase tracking-[0.15em]">Today's Activity</h3>
              <div className="text-3xl font-extralight text-white mt-3">{todayAttendance.length}</div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              {todayAttendance.length > 0 ? (
                <div className="space-y-3">
                  {todayAttendance.slice().reverse().map((record, index) => (
                    <div key={index} className="group">
                      <div className="flex items-center justify-between py-4 px-5 bg-white/[0.02] border border-white/[0.05] rounded-xl hover:bg-white/[0.04] hover:border-white/[0.08] transition-all duration-300">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-light text-white">{record.name}</div>
                          <div className="text-xs text-white/50 mt-1 font-light">{record.time}</div>
                        </div>
                        <div className="text-xs font-light text-white/60">
                          {(record.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-center">
                  <div className="text-white/40">
                    <div className="text-4xl mb-4">●</div>
                    <p className="text-sm font-light">No activity today</p>
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
    </div>
  )
}

