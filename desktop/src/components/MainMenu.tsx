import type { MenuOption } from '../App'

interface MainMenuProps {
  onMenuSelect: (menu: MenuOption) => void
  isConnected: boolean
  systemStats: {
    legacy_faces: number
    enhanced_templates: number
    total_people: number
    today_records: number
    total_records: number
    success_rate: number
  } | null
  onRefreshStats: () => void
}

export default function MainMenu({ 
  onMenuSelect, 
  isConnected, 
  systemStats,
  onRefreshStats 
}: MainMenuProps) {
  const menuItems = [
    {
      id: 'live-camera' as MenuOption,
      icon: '📹',
      title: 'Live Camera',
      description: 'Real-time recognition',
      disabled: !isConnected
    },
    {
      id: 'single-image' as MenuOption,
      icon: '🖼️',
      title: 'Single Image',
      description: 'Upload & analyze',
      disabled: !isConnected
    },
    {
      id: 'batch-processing' as MenuOption,
      icon: '📁',
      title: 'Batch Processing',
      description: 'Multiple images',
      disabled: !isConnected
    },
    {
      id: 'system-management' as MenuOption,
      icon: '⚙️',
      title: 'System Management',
      description: 'People & settings',
      disabled: !isConnected
    }
  ]

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Ultra Subtle Glass Orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/3 left-1/4 w-80 h-80 bg-white/[0.02] rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-white/[0.015] rounded-full blur-3xl animate-pulse delay-2000"></div>
        <div className="absolute top-2/3 left-1/2 w-64 h-64 bg-white/[0.01] rounded-full blur-2xl animate-pulse delay-4000"></div>
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Compact Header */}
        <div className="px-6 pt-8 pb-6">
          <div className="max-w-7xl mx-auto">
            {/* Minimalist Header */}
            <div className="flex items-center justify-between mb-12">
              <div className="flex items-center space-x-5">
                <div className="relative group">
                  <div className="w-12 h-12 rounded-xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] flex items-center justify-center">
                    <div className="w-5 h-5 rounded-lg bg-white/90"></div>
                  </div>
                  <div className="absolute -inset-1 bg-white/[0.05] rounded-xl blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                </div>
                <div>
                  <h1 className="text-5xl font-extralight text-white tracking-[-0.02em]">
                    SURI
                  </h1>
                  <p className="text-xs text-white/60 font-light tracking-widest uppercase mt-1">Face Recognition</p>
                </div>
              </div>

              {/* Glass Status */}
              <div className="flex items-center space-x-4">
                <div className="px-6 py-3 rounded-full bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] flex items-center space-x-3">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-white animate-pulse' : 'bg-white/40'}`}></div>
                  <span className="text-xs font-light tracking-widest text-white/90 uppercase">
                    {isConnected ? 'Online' : 'Offline'}
                  </span>
                </div>
                <button 
                  onClick={onRefreshStats}
                  className="p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] backdrop-blur-xl border border-white/[0.08] text-white/60 hover:text-white transition-all duration-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Glass Stats Cards */}
            {systemStats && (
              <div className="grid grid-cols-4 gap-6 mb-16">
                <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl p-6 text-center group hover:bg-white/[0.04] transition-all duration-500">
                  <div className="text-2xl font-extralight text-white mb-2 tracking-tight">
                    {systemStats.total_people}
                  </div>
                  <div className="text-[10px] text-white/50 font-light uppercase tracking-[0.2em]">People</div>
                </div>
                <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl p-6 text-center group hover:bg-white/[0.04] transition-all duration-500">
                  <div className="text-2xl font-extralight text-white mb-2 tracking-tight">
                    {systemStats.enhanced_templates}
                  </div>
                  <div className="text-[10px] text-white/50 font-light uppercase tracking-[0.2em]">Templates</div>
                </div>
                <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl p-6 text-center group hover:bg-white/[0.04] transition-all duration-500">
                  <div className="text-2xl font-extralight text-white mb-2 tracking-tight">
                    {systemStats.today_records}
                  </div>
                  <div className="text-[10px] text-white/50 font-light uppercase tracking-[0.2em]">Today</div>
                </div>
                <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-xl p-6 text-center group hover:bg-white/[0.04] transition-all duration-500">
                  <div className="text-2xl font-extralight text-white mb-2 tracking-tight">
                    {Math.round(systemStats.success_rate * 100)}%
                  </div>
                  <div className="text-[10px] text-white/50 font-light uppercase tracking-[0.2em]">Success</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pure Glass Menu Grid */}
        <div className="flex-1 px-6 pb-8">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => !item.disabled && onMenuSelect(item.id)}
                  disabled={item.disabled}
                  className={`group relative overflow-hidden rounded-2xl transition-all duration-700 ${
                    item.disabled 
                      ? 'opacity-30 cursor-not-allowed' 
                      : 'hover:scale-[1.02] hover:-translate-y-1'
                  }`}
                >
                  {/* Pure Glass Background */}
                  <div className="absolute inset-0 bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl"></div>
                  
                  {/* Hover Glass Enhancement */}
                  {!item.disabled && (
                    <div className="absolute inset-0 bg-white/[0.03] backdrop-blur-xl border border-white/[0.12] rounded-2xl opacity-0 group-hover:opacity-100 transition-all duration-700"></div>
                  )}
                  
                  {/* Content */}
                  <div className="relative z-10 p-8 h-full flex flex-col min-h-[200px]">
                    <div className="flex items-start justify-between mb-8">
                      <div className="text-3xl transition-transform duration-700 group-hover:scale-110">
                        {item.icon}
                      </div>
                      {!item.disabled && (
                        <div className="w-8 h-8 rounded-full bg-white/[0.05] backdrop-blur-xl border border-white/[0.1] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-700 transform translate-x-2 group-hover:translate-x-0">
                          <svg className="w-3 h-3 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 flex flex-col justify-center">
                      <h3 className="text-lg font-light text-white mb-3 tracking-wide group-hover:text-white/90 transition-colors duration-500">
                        {item.title}
                      </h3>
                      <p className="text-sm text-white/60 group-hover:text-white/70 transition-colors duration-500 leading-relaxed font-light">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  
                  {/* Disabled Overlay */}
                  {item.disabled && (
                    <div className="absolute inset-0 rounded-2xl bg-black/40 backdrop-blur-sm flex items-center justify-center">
                      <div className="text-xs text-white/40 font-light bg-white/[0.02] px-4 py-2 rounded-full border border-white/[0.05]">
                        Connection Required
                      </div>
                    </div>
                  )}

                  {/* Subtle Hover Glow */}
                  <div className="absolute inset-0 rounded-2xl bg-white/[0.01] opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"></div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Minimalist Footer */}
        <div className="px-6 pb-8">
          <div className="max-w-7xl mx-auto text-center">
            <p className="text-[10px] text-white/30 font-light tracking-[0.15em] uppercase">
              Enterprise Face Recognition • Real-time Processing • Advanced Analytics
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}