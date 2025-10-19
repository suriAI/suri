import type { QuickSettings } from '../types';

interface DisplayProps {
  quickSettings: QuickSettings;
  toggleQuickSetting: (key: keyof QuickSettings) => void;
}

export function Display({ quickSettings, toggleQuickSetting }: DisplayProps) {
  const settingItems = [
    { 
      key: 'showFPS' as keyof QuickSettings, 
      label: 'FPS Counter',
      description: 'Frame rate indicator'
    },
    { 
      key: 'showBoundingBoxes' as keyof QuickSettings, 
      label: 'Bounding Boxes',
      description: 'Face detection outlines'
    },
    { 
      key: 'showAntiSpoofStatus' as keyof QuickSettings, 
      label: 'Anti-Spoof',
      description: 'Liveness detection status'
    },
    { 
      key: 'showRecognitionNames' as keyof QuickSettings, 
      label: 'Recognition Labels',
      description: 'Identity name tags'
    },
    { 
      key: 'showDebugInfo' as keyof QuickSettings, 
      label: 'Debug Info',
      description: 'Technical metrics'
    },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-white/90">Overlay Configuration</h3>
        <p className="text-sm text-white/50">Camera feed visual elements</p>
      </div>

      <div className="space-y-4">
        {settingItems.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between py-3 border-b border-white/5 gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white/90">{label}</div>
              <div className="text-xs text-white/50 mt-0.5">{description}</div>
            </div>
            
            <button
              onClick={() => toggleQuickSetting(key)}
              className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 flex-shrink-0 flex items-center ${
                quickSettings[key] ? 'bg-emerald-500/30' : 'bg-white/10'
              }`}
            >
              <div className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${
                quickSettings[key] ? 'translate-x-5' : 'translate-x-0'
              }`}></div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

