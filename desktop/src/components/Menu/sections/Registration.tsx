import { useState } from 'react';
import { FaceRegistrationLab } from './registration/FaceRegistrationLab';
import { BulkFaceRegistration } from '../modals/BulkFaceRegistration';
import { AssistedCameraRegistration } from '../modals/AssistedCameraRegistration';
import type {
  AttendanceGroup,
  AttendanceMember
} from '../../../types/recognition.js';

interface RegistrationProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh: () => void;
}

type RegistrationMode = 'single' | 'bulk' | 'queue' | null;

export function Registration({ group, members, onRefresh }: RegistrationProps) {
  const [mode, setMode] = useState<RegistrationMode>(null);

  if (mode === 'bulk') {
    return (
      <BulkFaceRegistration
        group={group}
        members={members}
        onRefresh={onRefresh}
        onClose={() => setMode(null)}
      />
    );
  }

  if (mode === 'queue') {
    return (
      <AssistedCameraRegistration
        group={group}
        members={members}
        onRefresh={onRefresh}
        onClose={() => setMode(null)}
      />
    );
  }

  if (mode === 'single') {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setMode(null)}
          className="group flex items-center gap-2 text-white/40 hover:text-white/80 transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <FaceRegistrationLab
          group={group}
          members={members}
          onRefresh={onRefresh}
        />
      </div>
    );
  }

  // Mode Selection View - Note: has_face_data check removed as it's not available here
  // You may want to fetch registration status separately if needed
  const total = members.length;
  const registered = 0; // Placeholder - implement if status tracking needed
  const progress = total > 0 ? (registered / total) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-light text-white">{registered}<span className="text-white/40">/{total}</span></div>
          <div className="text-xs text-white/40 mt-1">Registered</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-32 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-white/60">{Math.round(progress)}%</div>
        </div>
      </div>

      {/* Mode Cards */}
      <div className="grid gap-3">
        {/* Single */}
        <button
          onClick={() => setMode('single')}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 text-left hover:border-cyan-400/40 hover:bg-white/10 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-cyan-500/0 group-hover:from-cyan-500/5 group-hover:to-transparent transition-all duration-300" />
          <div className="relative flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 text-2xl group-hover:scale-110 transition-transform duration-300">
              👤
            </div>
            <div className="flex-1">
              <div className="text-lg font-medium text-white mb-1">Individual</div>
              <div className="text-sm text-white/50">Register one person at a time with precision</div>
            </div>
            <svg className="w-5 h-5 text-white/20 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>

        {/* Bulk */}
        <button
          onClick={() => setMode('bulk')}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 text-left hover:border-purple-400/40 hover:bg-white/10 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-purple-500/0 group-hover:from-purple-500/5 group-hover:to-transparent transition-all duration-300" />
          <div className="relative flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 text-2xl group-hover:scale-110 transition-transform duration-300">
              📸
            </div>
            <div className="flex-1">
              <div className="text-lg font-medium text-white mb-1">Batch Upload</div>
              <div className="text-sm text-white/50">Process multiple photos at once, assign faces</div>
            </div>
            <svg className="w-5 h-5 text-white/20 group-hover:text-purple-400 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>

        {/* Queue */}
        <button
          onClick={() => setMode('queue')}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 text-left hover:border-emerald-400/40 hover:bg-white/10 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-emerald-500/0 group-hover:from-emerald-500/5 group-hover:to-transparent transition-all duration-300" />
          <div className="relative flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-2xl group-hover:scale-110 transition-transform duration-300">
              🎥
            </div>
            <div className="flex-1">
              <div className="text-lg font-medium text-white mb-1">Camera Queue</div>
              <div className="text-sm text-white/50">Capture multiple people sequentially with live camera</div>
            </div>
            <svg className="w-5 h-5 text-white/20 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      </div>
    </div>
  );
}

