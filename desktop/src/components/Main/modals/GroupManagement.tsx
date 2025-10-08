import { useState } from 'react';
import type { AttendanceGroup, GroupType } from '../types';
import { getGroupTypeIcon } from '../utils/overlayRenderer';

interface GroupManagementProps {
  attendanceGroups: AttendanceGroup[];
  currentGroup: AttendanceGroup | null;
  handleSelectGroup: (group: AttendanceGroup) => void;
  handleDeleteGroup: (group: AttendanceGroup) => void;
  onClose: () => void;
  onCreateGroup: (name: string, type: GroupType) => Promise<void>;
}

export function GroupManagement({
  attendanceGroups,
  currentGroup,
  handleSelectGroup,
  handleDeleteGroup,
  onClose,
  onCreateGroup,
}: GroupManagementProps) {
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupType, setNewGroupType] = useState<GroupType>('general');

  const handleCreate = async () => {
    if (!newGroupName.trim()) return;
    await onCreateGroup(newGroupName, newGroupType);
    setNewGroupName('');
    setNewGroupType('general');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-xl font-bold mb-4">Group Management</h3>

        {/* Create New Group */}
        <div className="mb-6">
          <h4 className="text-lg font-medium mb-3">Create New Group</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-2">Group Name:</label>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Enter group name"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Group Type:</label>
              <select
                value={newGroupType}
                onChange={(e) => setNewGroupType(e.target.value as GroupType)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
              >
                <option value="general">👥 General</option>
                <option value="employee">👔 Employee</option>
                <option value="student">🎓 Student</option>
                <option value="visitor">👤 Visitor</option>
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={!newGroupName.trim()}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded transition-colors"
            >
              Create Group
            </button>
          </div>
        </div>

        {/* Existing Groups */}
        {attendanceGroups.length > 0 && (
          <div className="mb-4">
            <h4 className="text-lg font-medium mb-3">Existing Groups</h4>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {attendanceGroups.map(group => (
                <div key={group.id} className="flex items-center justify-between p-3 bg-gray-700 rounded">
                  <div>
                    <span className="font-medium">{getGroupTypeIcon(group.type)} {group.name}</span>
                    <div className="text-sm text-gray-400">
                      {group.type} • Members
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleSelectGroup(group)}
                      className={`px-3 py-1 rounded text-sm transition-colors ${currentGroup?.id === group.id ? 'bg-blue-600 text-white' : 'bg-gray-600 hover:bg-gray-500 text-gray-200'}`}
                    >
                      {currentGroup?.id === group.id ? 'Active' : 'Select'}
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition-colors"
                      title="Delete Group"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

