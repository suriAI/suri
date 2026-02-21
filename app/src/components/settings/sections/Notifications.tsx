import { useEffect, useMemo, useState } from "react";
import type { AudioSettings } from "@/components/settings/types";
import { Dropdown } from "@/components/shared";

type RecognitionSoundAsset = { fileName: string; url: string };

interface NotificationsProps {
  audioSettings: AudioSettings;
  onAudioSettingsChange: (updates: Partial<AudioSettings>) => void;
}

export function Notifications({
  audioSettings,
  onAudioSettingsChange,
}: NotificationsProps) {
  const [soundAssets, setSoundAssets] = useState<RecognitionSoundAsset[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const assets = await window.electronAPI.assets.listRecognitionSounds();
        if (!cancelled) setSoundAssets(Array.isArray(assets) ? assets : []);
      } catch {
        if (!cancelled) setSoundAssets([]);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const soundOptions = useMemo(() => {
    return soundAssets.map((a) => ({ value: a.url, label: a.fileName }));
  }, [soundAssets]);

  return (
    <div className="space-y-6 max-w-auto p-10">
      <div className="space-y-4">
        {/* Recognition sound */}
        <div className="flex items-center py-3 border-b border-white/5 gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white/90">
              Recognition Sound
            </div>
            <div className="text-xs text-white/50 mt-0.5">
              Play a sound when an attendance recognition event is recorded
            </div>
          </div>

          <button
            onClick={() =>
              onAudioSettingsChange({
                recognitionSoundEnabled: !audioSettings.recognitionSoundEnabled,
              })
            }
            className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 flex-shrink-0 flex items-center ml-auto ${audioSettings.recognitionSoundEnabled
              ? "bg-cyan-500/30"
              : "bg-white/10"
              }`}
          >
            <div
              className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${audioSettings.recognitionSoundEnabled
                ? "translate-x-5"
                : "translate-x-0"
                }`}
            ></div>
          </button>
        </div>

        <div className="flex items-center py-3 border-b border-white/5 gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white/90">
              Recognition Sound Effect
            </div>
            <div className="text-xs text-white/50 mt-0.5">
              Choose a file from public assets:{" "}
              <span className="text-white/70">public/assets/sounds</span>
            </div>
          </div>

          <div className="w-72 max-w-[55%]">
            <Dropdown
              options={soundOptions}
              value={audioSettings.recognitionSoundUrl}
              onChange={(value) =>
                onAudioSettingsChange({
                  recognitionSoundUrl: value,
                })
              }
              placeholder={
                soundOptions.length ? "Select sound…" : "No sounds found"
              }
              emptyMessage="No sound files in assets"
              disabled={soundOptions.length === 0}
              allowClear={true}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
