import type { MenuOption } from '../App'
import AppDropdown from './AppDropdown.tsx'

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
  const menuItems: Array<{
    id: MenuOption
    icon: React.ReactNode
    title: string
    description: string
    disabled: boolean
    primary?: boolean
  }> = [
    {
      id: 'live-camera' as MenuOption,
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
      title: 'Live Camera',
      description: 'Real-time facial recognition with instant detection and analysis',
      disabled: !isConnected,
      primary: true
    },
    {
      id: 'system-management' as MenuOption,
      icon: (
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      title: 'System Management',
      description: 'Manage people database and system configuration',
      disabled: !isConnected
    },
    {
      id: 'single-image' as MenuOption,
      icon: (
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
      ),
      title: 'Single Image',
      description: 'Upload and analyze individual photos',
      disabled: !isConnected
    },
    {
      id: 'batch-processing' as MenuOption,
      icon: (
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      ),
      title: 'Batch Processing',
      description: 'Process multiple images simultaneously',
      disabled: !isConnected
    },
    {
      id: 'add-person' as MenuOption,
      icon: (
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
        </svg>
      ),
      title: 'Add Person',
      description: 'Register new individuals to the database',
      disabled: !isConnected
    }
  ]

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Dynamic Gradient Mesh Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/[0.008] via-transparent to-white/[0.005] animate-gradient"></div>
        <div className="absolute top-1/4 -left-1/4 w-3/4 h-3/4 bg-gradient-radial from-white/[0.015] via-white/[0.003] to-transparent blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 -right-1/4 w-3/4 h-3/4 bg-gradient-radial from-white/[0.012] via-white/[0.002] to-transparent blur-3xl animate-pulse delay-3000"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/10"></div>
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Revolutionary Header Design */}
        <div className="px-6 md:px-8 pt-8 md:pt-12 pb-12 md:pb-16">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-12 md:mb-20 space-y-6 md:space-y-0">
              {/* Brand Identity */}
              <div className="flex items-end">
                <div>
                  <h1 className="text-5xl md:text-7xl font-extralight text-white tracking-[-0.03em] leading-none">
                    SURI
                  </h1>
                  <div className="flex items-center space-x-2 md:space-x-3 mt-2">
                    <div className="w-1 h-1 bg-white/40 rounded-full"></div>
                    <p className="text-[10px] md:text-xs text-white/50 font-light tracking-[0.2em] md:tracking-[0.25em] uppercase">Vision AI</p>
                    <div className="w-1 h-1 bg-white/40 rounded-full"></div>
                  </div>
                </div>
              </div>

              {/* Control Panel */}
              <div className="flex items-center space-x-4 md:space-x-6 w-full md:w-auto justify-end">
                <AppDropdown isConnected={isConnected} onRefreshStats={onRefreshStats} />
              </div>
            </div>

            {/* Floating Statistics Dashboard */}
            {systemStats && (
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-white/[0.02] via-white/[0.01] to-white/[0.02] blur-xl"></div>
                <div className="relative grid grid-cols-2 md:flex md:justify-center gap-8 md:gap-16 py-6 md:py-8">
                  <div className="text-center group cursor-default">
                    <div className="text-2xl md:text-4xl font-extralight text-white mb-2 tracking-tight group-hover:text-white/90 transition-colors duration-500">
                      {systemStats.total_people}
                    </div>
                    <div className="text-[8px] md:text-[9px] text-white/40 font-light uppercase tracking-[0.25em] md:tracking-[0.3em]">People</div>
                    <div className="w-8 md:w-12 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mt-2 md:mt-3 group-hover:via-white/40 transition-colors duration-500 mx-auto"></div>
                  </div>
                  
                  <div className="text-center group cursor-default">
                    <div className="text-2xl md:text-4xl font-extralight text-white mb-2 tracking-tight group-hover:text-white/90 transition-colors duration-500">
                      {systemStats.enhanced_templates}
                    </div>
                    <div className="text-[8px] md:text-[9px] text-white/40 font-light uppercase tracking-[0.25em] md:tracking-[0.3em]">Templates</div>
                    <div className="w-8 md:w-12 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mt-2 md:mt-3 group-hover:via-white/40 transition-colors duration-500 mx-auto"></div>
                  </div>
                  
                  <div className="text-center group cursor-default">
                    <div className="text-2xl md:text-4xl font-extralight text-white mb-2 tracking-tight group-hover:text-white/90 transition-colors duration-500">
                      {systemStats.today_records}
                    </div>
                    <div className="text-[8px] md:text-[9px] text-white/40 font-light uppercase tracking-[0.25em] md:tracking-[0.3em]">Today</div>
                    <div className="w-8 md:w-12 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mt-2 md:mt-3 group-hover:via-white/40 transition-colors duration-500 mx-auto"></div>
                  </div>
                  
                  <div className="text-center group cursor-default">
                    <div className="text-2xl md:text-4xl font-extralight text-white mb-2 tracking-tight group-hover:text-white/90 transition-colors duration-500">
                      {Math.round(systemStats.success_rate)}%
                    </div>
                    <div className="text-[8px] md:text-[9px] text-white/40 font-light uppercase tracking-[0.25em] md:tracking-[0.3em]">Success</div>
                    <div className="w-8 md:w-12 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mt-2 md:mt-3 group-hover:via-white/40 transition-colors duration-500 mx-auto"></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Revolutionary Menu Layout - No Boxes */}
        <div className="flex-1 px-6 md:px-8 pb-12 md:pb-16">
          <div className="max-w-7xl mx-auto">
            {/* Primary Action */}
            <div className="mb-12 md:mb-16">
              {menuItems.filter(item => item.primary).map((item) => (
                <button
                  key={item.id}
                  onClick={() => !item.disabled && onMenuSelect(item.id)}
                  disabled={item.disabled}
                  className={`group relative w-full text-left transition-all duration-700 ${
                    item.disabled 
                      ? 'opacity-40 cursor-not-allowed' 
                      : 'hover:-translate-y-1 md:hover:-translate-y-2'
                  }`}
                >
                  {/* Floating Content */}
                  <div className="flex flex-col md:flex-row items-start md:items-center md:justify-between py-8 md:py-12 px-4 md:px-8 space-y-4 md:space-y-0">
                    <div className="flex items-start md:items-center space-x-6 md:space-x-12 w-full">
                      <div className={`flex-shrink-0 transition-all duration-700 ${item.disabled ? 'text-white/30' : 'text-white/60 group-hover:text-white group-hover:scale-110'}`}>
                        {item.icon}
                      </div>
                      <div className="flex-1">
                        <h2 className={`text-2xl md:text-4xl font-extralight tracking-wide mb-2 md:mb-3 transition-all duration-500 ${
                          item.disabled ? 'text-white/30' : 'text-white/80 group-hover:text-white'
                        }`}>
                          {item.title}
                        </h2>
                        <p className={`text-sm md:text-base text-white/40 font-light leading-relaxed max-w-lg transition-all duration-500 ${
                          !item.disabled && 'group-hover:text-white/60'
                        }`}>
                          {item.description}
                        </p>
                      </div>
                    </div>
                    
                    {!item.disabled && (
                      <div className="hidden md:block opacity-0 group-hover:opacity-100 transition-all duration-500 transform translate-x-4 group-hover:translate-x-0">
                        <div className="w-12 md:w-16 h-12 md:h-16 rounded-full border border-white/20 flex items-center justify-center group-hover:border-white/40 transition-all duration-500">
                          <svg className="w-4 md:w-6 h-4 md:h-6 text-white/60 group-hover:text-white transition-colors duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Hover Line Effect */}
                  <div className="absolute bottom-0 left-4 md:left-8 right-4 md:right-8 h-px bg-gradient-to-r from-transparent via-white/0 to-transparent group-hover:via-white/30 transition-all duration-700"></div>
                  
                  {/* Disabled State */}
                  {item.disabled && (
                    <div className="absolute right-4 md:right-8 top-4 md:top-1/2 md:-translate-y-1/2">
                      <div className="text-xs text-white/30 font-light bg-white/[0.02] px-3 md:px-4 py-1 md:py-2 rounded-full border border-white/[0.05]">
                        Connection Required
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Secondary Actions Grid */}
            <div className="space-y-6 md:space-y-8">
              <div className="text-center mb-8 md:mb-12">
                <div className="w-16 md:w-24 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mx-auto mb-4 md:mb-6"></div>
                <h3 className="text-xs md:text-sm font-light text-white/40 tracking-[0.15em] md:tracking-[0.2em] uppercase">Additional Features</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
                {menuItems.filter(item => !item.primary).map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => !item.disabled && onMenuSelect(item.id)}
                    disabled={item.disabled}
                    className={`group relative text-left transition-all duration-500 ${
                      item.disabled 
                        ? 'opacity-40 cursor-not-allowed' 
                        : 'hover:-translate-y-1'
                    }`}
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <div className="flex items-start space-x-4 md:space-x-6 py-6 md:py-8 px-4 md:px-6">
                      <div className={`flex-shrink-0 transition-all duration-500 ${
                        item.disabled ? 'text-white/20' : 'text-white/50 group-hover:text-white/80 group-hover:scale-105'
                      }`}>
                        {item.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className={`text-lg md:text-xl font-light mb-2 md:mb-3 tracking-wide transition-colors duration-500 ${
                          item.disabled ? 'text-white/30' : 'text-white/70 group-hover:text-white/90'
                        }`}>
                          {item.title}
                        </h3>
                        <p className={`text-sm font-light leading-relaxed transition-colors duration-500 ${
                          item.disabled ? 'text-white/20' : 'text-white/40 group-hover:text-white/60'
                        }`}>
                          {item.description}
                        </p>
                      </div>
                      
                      {!item.disabled && (
                        <div className="hidden md:block flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                          <div className="w-6 md:w-8 h-6 md:h-8 rounded-full border border-white/10 flex items-center justify-center group-hover:border-white/30 transition-all duration-300">
                            <svg className="w-2 md:w-3 h-2 md:h-3 text-white/40 group-hover:text-white/70 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Subtle Hover Line */}
                    <div className="absolute bottom-0 left-4 md:left-6 right-4 md:right-6 h-px bg-gradient-to-r from-transparent via-white/0 to-transparent group-hover:via-white/20 transition-all duration-500"></div>
                    
                    {/* Disabled Indicator */}
                    {item.disabled && (
                      <div className="absolute right-4 md:right-6 top-4 md:top-1/2 md:-translate-y-1/2">
                        <div className="w-1.5 md:w-2 h-1.5 md:h-2 bg-white/20 rounded-full"></div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Elegant Footer */}
        <div className="px-6 md:px-8 pb-6 md:pb-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex justify-center">
              <div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-4 text-[8px] md:text-[9px] text-white/25 font-light tracking-[0.15em] md:tracking-[0.2em] uppercase text-center">
                <span>Advanced Recognition</span>
                <div className="hidden md:block w-1 h-1 bg-white/20 rounded-full"></div>
                <span>Real-time Processing</span>
                <div className="hidden md:block w-1 h-1 bg-white/20 rounded-full"></div>
                <span>Intelligent Analytics</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}