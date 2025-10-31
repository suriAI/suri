import { useState } from 'react';
import { FaceCapture } from './registration/FaceCapture.js';
import { BulkFaceRegistration } from '../modals/BulkFaceRegistration.js';
import { AssistedCameraRegistration } from '../modals/AssistedCameraRegistration.js';
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
      <FaceCapture
        group={group}
        members={members}
        onRefresh={onRefresh}
        onBack={() => setMode(null)}
      />
    );
  }

  // Mode Selection View - Calculate actual registration status
  const total = members.length;
  const registered = members.filter(member => member.has_face_data).length;
  const progress = total > 0 ? (registered / total) * 100 : 0;

  return (
    <div className="h-full flex flex-col overflow-hidden space-y-6">
      {/* Registration Status - Minimalist Progress Ring */}
      <div className="flex items-center justify-center flex-shrink-0">
        <div className="relative">
          {/* Progress Ring */}
          <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
            {/* Background circle */}
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="2"
            />
            {/* Progress circle */}
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke={progress === 100 ? "#00ff88" : progress > 0 ? "#fbbf24" : "rgba(255,255,255,0.3)"}
              strokeWidth="2"
              strokeDasharray={`${progress}, 100`}
              className="transition-all duration-500 ease-out"
            />
          </svg>
          
          {/* Count in center */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className={`text-lg font-medium ${progress === 100 ? 'text-[#00ff88]' : progress > 0 ? 'text-[#fbbf24]' : 'text-white/60'}`}>
                {registered}/{total}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mode Cards */}
      <div className="grid gap-3 flex-1 overflow-y-auto custom-scroll overflow-x-hidden min-h-0 pr-2">
        {/* Single */}
        <button
          onClick={() => setMode('single')}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 text-left hover:border-white/20 hover:bg-white/10 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all duration-300" />
          <div className="relative flex items-start gap-4">
            <div className="flex-1">
              <div className="text-lg font-medium text-white mb-1">Individual</div>
              <div className="text-sm text-white/50">Register one person at a time with high-quality face capture</div>
            </div>
            <svg className="w-5 h-5 text-white/20 group-hover:text-white/60 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>

        {/* Bulk */}
        <button
          onClick={() => setMode('bulk')}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 text-left hover:border-white/20 hover:bg-white/10 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all duration-300" />
          <div className="relative flex items-start gap-4">
            <div className="flex-1">
              <div className="text-lg font-medium text-white mb-1">Batch Upload</div>
              <div className="text-sm text-white/50">Process multiple photos at once, assign faces</div>
            </div>
            <svg className="w-5 h-5 text-white/20 group-hover:text-white/60 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>

        {/* Queue */}
        <button
          onClick={() => setMode('queue')}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 text-left hover:border-white/20 hover:bg-white/10 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all duration-300" />
          <div className="relative flex items-start gap-4">
            <div className="flex-1">
              <div className="text-lg font-medium text-white mb-1">Camera Queue</div>
              <div className="text-sm text-white/50">Capture multiple people sequentially with live camera</div>
            </div>
            <svg className="w-5 h-5 text-white/20 group-hover:text-white/60 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      </div>
    </div>
  );
}

