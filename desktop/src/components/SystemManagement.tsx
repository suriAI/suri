import { useState } from "react";

interface SystemStats {
  uptime: string;
  load: number;
  health: string;
  templateDistribution: { name: string; value: number }[];
}

interface LogEntry {
  id: number;
  message: string;
}

interface User {
  id: number;
  name: string;
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"];

export default function SystemManagement() {
  const [activeView, setActiveView] = useState("systemStats");
  const [systemStats] = useState<SystemStats>({
    uptime: "36 days",
    load: 0.42,
    health: "Optimal",
    templateDistribution: [
      { name: "Stable", value: 70 },
      { name: "Experimental", value: 20 },
      { name: "Deprecated", value: 10 },
    ],
  });
  const [logs] = useState<LogEntry[]>([
    { id: 1, message: "System started successfully." },
    { id: 2, message: "Template A deployed." },
    { id: 3, message: "User John updated profile." },
  ]);
  const [users] = useState<User[]>([
    { id: 1, name: "John Doe" },
    { id: 2, name: "Jane Smith" },
  ]);

  const renderSystemStats = () => (
    <div>
      <h2>System Health</h2>
      <p>Uptime: {systemStats.uptime}</p>
      <p>Load: {systemStats.load}</p>
      <p>Status: {systemStats.health}</p>
      <h2>Template Quality Distribution</h2>
      <ul>
        {systemStats.templateDistribution.map((entry, index) => (
          <li key={index} style={{ color: COLORS[index % COLORS.length] }}>
            {entry.name}: {entry.value}%
          </li>
        ))}
      </ul>
    </div>
  );

  const renderLogs = () => (
    <div>
      <h2>System Logs</h2>
      <ul>
        {logs.map((log) => (
          <li key={log.id}>{log.message}</li>
        ))}
      </ul>
    </div>
  );

  const renderUserManagement = () => (
    <div>
      <h2>User Management</h2>
      <ul>
        {users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );

  const renderMaintenanceView = () => (
    <div>
      <h2>Maintenance Mode</h2>
      <p>System is under scheduled maintenance.</p>
      <button>Resume Operations</button>
    </div>
  );

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-black via-zinc-900 to-black text-white">
      <div className="w-full max-w-3xl px-4 py-8 flex flex-col items-center">
        <h1 className="text-5xl font-light mb-6 text-center tracking-tight">System Management</h1>
        <div className="flex gap-4 mb-8 justify-center">
          <button onClick={() => setActiveView('systemStats')} className="px-6 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition text-white">System Stats</button>
          <button onClick={() => setActiveView('logs')} className="px-6 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition text-white">Logs</button>
          <button onClick={() => setActiveView('users')} className="px-6 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition text-white">Users</button>
          <button onClick={() => setActiveView('maintenance')} className="px-6 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition text-white">Maintenance</button>
        </div>
        <div className="w-full flex flex-col items-center">
          {activeView === 'systemStats' && renderSystemStats()}
          {activeView === 'logs' && renderLogs()}
          {activeView === 'users' && renderUserManagement()}
          {activeView === 'maintenance' && renderMaintenanceView()}
        </div>
      </div>
    </div>
  );
}