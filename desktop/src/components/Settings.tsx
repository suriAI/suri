/**
 * Settings Component - SQLite Backend Management
 * 
 * This component provides a management interface for the SQLite backend database,
 * similar to System Management but using BackendService for HTTP API communication
 * instead of Electron IPC.
 */

import React, { useState, useEffect } from 'react';
import { backendService } from '../services/BackendService';

// Interfaces for Settings component
interface SettingsOverview {
  totalPersons: number;
  totalEmbeddings: number;
  lastUpdated: string;
}

interface PersonDetails {
  person_id: string;
  embedding_count: number;
  last_seen?: string;
}

interface SettingsProps {
  onBack: () => void;
  isModal?: boolean; // New prop to determine if rendered as modal
}

export const Settings: React.FC<SettingsProps> = ({ onBack, isModal = false }) => {
  // State management
  const [activeView, setActiveView] = useState<'overview' | 'people' | 'search' | 'advanced' | 'maintenance'>('overview');
  const [systemData, setSystemData] = useState<SettingsOverview>({
    totalPersons: 0,
    totalEmbeddings: 0,
    lastUpdated: new Date().toISOString()
  });
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PersonDetails[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState<PersonDetails | null>(null);
  const [allPersons, setAllPersons] = useState<PersonDetails[]>([]);
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Load system data on component mount
  useEffect(() => {
    loadSystemData();
  }, []);

  const loadSystemData = async () => {
    setIsLoading(true);
    try {
      // Get database statistics from backend
      const stats = await backendService.getDatabaseStats();
      setSystemData({
        totalPersons: stats.total_persons,
        totalEmbeddings: stats.total_embeddings,
        lastUpdated: new Date().toISOString()
      });
      
      // Convert PersonInfo[] to PersonDetails[]
      const persons: PersonDetails[] = stats.persons.map(person => ({
        person_id: person.person_id,
        embedding_count: person.embedding_count,
        last_seen: person.last_seen
      }));
      setAllPersons(persons);
    } catch (error) {
      console.error('Failed to load system data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsLoading(true);
    try {
      // Filter persons based on search query
      const filtered = allPersons.filter(person => 
        person.person_id.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setSearchResults(filtered);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePerson = async (person: PersonDetails) => {
    setIsLoading(true);
    try {
      await backendService.removePerson(person.person_id);
      await loadSystemData(); // Refresh data
      setShowDeleteDialog(null);
    } catch (error) {
      console.error('Failed to delete person:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const startEdit = (person: PersonDetails) => {
    setEditingPerson(person.person_id);
    setEditName(person.person_id);
  };

  const cancelEdit = () => {
    setEditingPerson(null);
    setEditName('');
  };

  const saveEdit = async () => {
    if (!editingPerson || !editName.trim() || editName.trim() === editingPerson) {
      cancelEdit();
      return;
    }

    setIsLoading(true);
    try {
      await backendService.updatePerson(editingPerson, editName.trim());
      await loadSystemData(); // Refresh data
      cancelEdit();
    } catch (error) {
      console.error('Failed to update person:', error);
      alert('Failed to update person name. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (showDeleteDialog) {
      await handleDeletePerson(showDeleteDialog);
    }
  };

  const handleClearDatabase = async () => {
    if (!window.confirm('Are you sure you want to clear the entire database? This action cannot be undone.')) {
      return;
    }

    setIsLoading(true);
    try {
      await backendService.clearDatabase();
      await loadSystemData(); // Refresh data
    } catch (error) {
      console.error('Failed to clear database:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshData = async () => {
    await loadSystemData();
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* People Database Section */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-light text-white/90 mb-4 flex items-center space-x-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          <span>People Database</span>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/[0.03] rounded-xl p-4">
            <div className="text-2xl font-light text-white">{systemData.totalPersons}</div>
            <div className="text-sm text-white/60">Total People</div>
          </div>
          <div className="bg-white/[0.03] rounded-xl p-4">
            <div className="text-2xl font-light text-white">{systemData.totalEmbeddings}</div>
            <div className="text-sm text-white/60">Total Embeddings</div>
          </div>
        </div>
      </div>

      {/* Performance Section */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-light text-white/90 mb-4 flex items-center space-x-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <span>Performance</span>
        </h3>
        <div className="text-sm text-white/60">
          Last updated: {new Date(systemData.lastUpdated).toLocaleString()}
        </div>
      </div>
    </div>
  );

  const renderPeople = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-light text-white/90">Registered People</h3>
        <button
          onClick={loadSystemData}
          className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-200 rounded-xl text-sm transition-colors duration-150"
        >
          Refresh
        </button>
      </div>
      
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="max-h-96 overflow-y-auto">
          {allPersons.length === 0 ? (
            <div className="p-6 text-center text-white/60">
              No people registered in the database
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {allPersons.map((person) => (
                <div key={person.person_id} className="group p-4 hover:bg-white/[0.02] transition-colors duration-150">
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      {editingPerson === person.person_id ? (
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="px-3 py-1 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white font-medium focus:outline-none focus:border-white/[0.20] focus:bg-white/[0.05] transition-colors duration-150"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') saveEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            autoFocus
                          />
                          <button
                            onClick={saveEdit}
                            className="px-3 py-1 bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.15] text-white rounded-lg text-sm transition-colors duration-150"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] text-white/80 hover:text-white rounded-lg text-sm transition-colors duration-150"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div>
                          <button
                            onClick={() => startEdit(person)}
                            className="text-white/90 font-medium hover:text-white transition-colors duration-150 text-left"
                          >
                            {person.person_id}
                          </button>
                          <div className="text-sm text-white/60 mt-1">
                            {person.embedding_count} embeddings
                            {person.last_seen && ` • Last seen: ${new Date(person.last_seen).toLocaleString()}`}
                          </div>
                        </div>
                      )}
                    </div>

                    {editingPerson !== person.person_id && (
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button
                          onClick={() => startEdit(person)}
                          className="px-3 py-1 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white/80 hover:text-white rounded-lg text-sm transition-colors duration-150"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setShowDeleteDialog(person)}
                          className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-200 rounded-lg text-sm transition-colors duration-150"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderSearch = () => (
    <div className="space-y-4">
      <div className="flex space-x-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search registered persons..."
          className="flex-1 px-4 py-2 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/[0.2]"
        />
        <button
          onClick={handleSearch}
          className="px-6 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-200 rounded-xl transition-colors duration-150"
        >
          Search
        </button>
      </div>

      {searchResults.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="divide-y divide-white/[0.05]">
            {searchResults.map((person, index) => (
              <div key={person.person_id} className="p-4">
                <div className="font-medium text-white/90">Registered Person #{index + 1}</div>
                <div className="text-sm text-white/60">
                  {person.embedding_count} face embedding{person.embedding_count !== 1 ? 's' : ''}
                  {person.last_seen && ` • Last seen: ${new Date(person.last_seen).toLocaleString()}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderMaintenance = () => (
    <div className="space-y-6">
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-light text-white/90 mb-4">System Maintenance</h3>
        <div className="space-y-4">
          <button
              onClick={handleClearDatabase}
              disabled={isLoading}
              className="w-full px-4 py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-200 rounded-xl transition-colors duration-150 disabled:opacity-50"
            >
              Clear Database
            </button>
            <button
              onClick={handleRefreshData}
              disabled={isLoading}
              className="w-full px-4 py-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-200 rounded-xl transition-colors duration-150 disabled:opacity-50"
            >
              Refresh Data
            </button>
        </div>
      </div>
    </div>
  );

  // Main content JSX
  const mainContent = (
    <div className={isModal ? "w-full p-6" : "min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-slate-900 p-6"}>
      <div className={isModal ? "w-full" : "max-w-6xl mx-auto"}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="flex items-center space-x-2 px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-white/80 hover:text-white rounded-xl transition-colors duration-150"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              <span>{isModal ? "Close" : "Back to Camera"}</span>
            </button>
            <h1 className="text-3xl font-light text-white">Settings</h1>
          </div>
        </div>

        {/* Floating Statistics Dashboard */}
        <div className={`${isModal ? "absolute top-0 right-0" : "fixed top-6 right-6"} bg-black/40 border border-white/[0.1] rounded-2xl p-4 min-w-[200px] z-10`}>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-white/60">Total People</span>
              <span className="font-mono">{systemData.totalPersons}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/60">Total Embeddings</span>
              <span className="font-mono">{systemData.totalEmbeddings}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/60">Backend Status</span>
              <span className="font-mono text-green-400">Connected</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-2">
          {[
            { id: 'overview', label: 'Overview', icon: 'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605' },
            { id: 'people', label: 'People', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
            { id: 'search', label: 'Search', icon: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z' },
            { id: 'maintenance', label: 'Maintenance', icon: 'M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id as 'overview' | 'people' | 'search' | 'advanced' | 'maintenance')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-colors duration-150 transform-gpu ${
                activeView === tab.id
                  ? 'bg-white/[0.1] text-white border border-white/[0.2]'
                  : 'text-white/60 hover:text-white/80 hover:bg-white/[0.05]'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              <span className="text-sm font-light">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-black/20 rounded-2xl flex items-center justify-center z-10">
              <div className="flex items-center space-x-3 text-white">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                <span>Loading...</span>
              </div>
            </div>
          )}

          {activeView === 'overview' && renderOverview()}
          {activeView === 'people' && renderPeople()}
          {activeView === 'search' && renderSearch()}
          {activeView === 'maintenance' && renderMaintenance()}
        </div>

        {/* Delete Confirmation Dialog */}
        {showDeleteDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-slate-800 border border-white/[0.1] rounded-2xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-medium text-white mb-4">Confirm Deletion</h3>
              <p className="text-white/70 mb-6">
                Are you sure you want to delete "{showDeleteDialog.person_id}"? This action cannot be undone.
              </p>
              <div className="flex space-x-3">
                <button
                onClick={() => setShowDeleteDialog(null)}
                className="flex-1 px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-white rounded-xl transition-colors duration-150"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-200 rounded-xl transition-colors duration-150"
              >
                Delete
              </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Return modal wrapper if isModal is true, otherwise return content directly
  if (isModal) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
        <div className="custom-scroll rounded-tl-md rounded-bl-2xl  bg-black border border-white/[0.1] max-w-5xl w-full max-h-[60vh] overflow-y-auto relative">
          {mainContent}
        </div>
      </div>
    );
  }

  return mainContent;
};