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
      description: 'Real-time face recognition',
      disabled: !isConnected
    },
    {
      id: 'single-image' as MenuOption,
      icon: '🖼️',
      title: 'Single Image',
      description: 'Upload and analyze images',
      disabled: !isConnected
    },
    {
      id: 'batch-processing' as MenuOption,
      icon: '📁',
      title: 'Batch Processing',
      description: 'Process multiple images',
      disabled: !isConnected
    },
    {
      id: 'system-management' as MenuOption,
      icon: '⚙️',
      title: 'System Management',
      description: 'Manage people and settings',
      disabled: !isConnected
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-900 to-black text-white">
      {/* Hero Section */}
      <div className="px-8 pt-20 pb-16">
        <div className="max-w-3xl">
          <h1 className="text-7xl font-extralight tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500 mb-6">
            SURI
          </h1>
          <p className="text-xl text-zinc-400 font-light leading-relaxed mb-12 max-w-2xl">
            Intelligent face recognition system for attendance and identification
          </p>
          
          {/* Status Indicator */}
          <div className="glass-card inline-flex items-center gap-4 px-4 py-3 rounded-2xl mb-16">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'} animate-pulse`}></div>
            <span className="text-sm text-zinc-300 uppercase tracking-wider font-medium">
              {isConnected ? 'System Ready' : 'System Offline'}
            </span>
            {isConnected && (
              <button
                onClick={onRefreshStats}
                className="text-xs text-zinc-400 hover:text-white transition-all duration-300"
              >
                Refresh
              </button>
            )}
          </div>

          {/* Quick Stats */}
          {systemStats && isConnected && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
              <div className="glass-card rounded-2xl p-4 text-center">
                <div className="text-3xl font-light text-white mb-2">{systemStats.total_people}</div>
                <div className="text-xs text-zinc-400 uppercase tracking-wider font-medium">People</div>
              </div>
              <div className="glass-card rounded-2xl p-4 text-center">
                <div className="text-3xl font-light text-white mb-2">{systemStats.enhanced_templates}</div>
                <div className="text-xs text-zinc-400 uppercase tracking-wider font-medium">Templates</div>
              </div>
              <div className="glass-card rounded-2xl p-4 text-center">
                <div className="text-3xl font-light text-white mb-2">{systemStats.today_records}</div>
                <div className="text-xs text-zinc-400 uppercase tracking-wider font-medium">Today</div>
              </div>
              <div className="glass-card rounded-2xl p-4 text-center">
                <div className="text-3xl font-light text-white mb-2">{Math.round(systemStats.success_rate * 100)}%</div>
                <div className="text-xs text-zinc-400 uppercase tracking-wider font-medium">Success</div>
              </div>
            </div>
          )}
        </div>

        {/* Menu Grid - Glass Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => !item.disabled && onMenuSelect(item.id)}
              disabled={item.disabled}
              className={`menu-card group relative p-8 rounded-2xl text-left ${
                item.disabled 
                  ? 'opacity-40 cursor-not-allowed hover:transform-none' 
                  : 'hover:scale-[1.02]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-3xl mb-6">{item.icon}</div>
                  <h3 className="text-xl font-light text-white mb-3 tracking-tight">{item.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{item.description}</p>
                </div>
                
                {!item.disabled && (
                  <div className="opacity-0 group-hover:opacity-100 transition-all duration-500 transform translate-x-2 group-hover:translate-x-0">
                    <div className="w-10 h-10 glass-card rounded-full flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-white rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                    </div>
                  </div>
                )}
              </div>
              
              {item.disabled && (
                <div className="absolute top-6 right-6 text-xs text-zinc-500 font-medium">
                  Connection required
                </div>
              )}
              
              {/* Hover gradient effect */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
