import { useState, useEffect, useRef } from 'react';
import { User, Link2, Loader2, Check, AlertCircle, Upload, FileText, Cog, Clock, CheckCircle2, XCircle, Play, Send, Ban, StopCircle, Monitor, Sun, Moon, Bell, BellOff, Download, Plus, Pencil, Trash2, Smile } from 'lucide-react';
import { settings, importApi, jobs, moodActivities } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { MoodIconRow } from '../components/MoodIcons';
import type { UserSettings, ImportResult, Job, MoodActivityGroup } from '../types';

function SwarmImportSection({ onImportComplete }: { onImportComplete?: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    setResult(null);
    setImportError(null);
  };

  const handleImport = async () => {
    if (selectedFiles.length === 0) return;
    setImporting(true);
    setResult(null);
    setImportError(null);
    try {
      const data = await importApi.swarm(selectedFiles);
      setResult(data);
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (data.imported > 0) {
        // Auto-trigger server-side backfill
        try {
          await jobs.start('backfill');
        } catch { /* ignore if already running */ }
        onImportComplete?.();
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Upload size={20} className="text-gray-600 dark:text-gray-400" />
        Swarm Import
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Import your check-in history from Swarm CSV export files. Upload all your CSV files at once for batch import.
      </p>

      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 dark:hover:bg-primary-900/20 transition-colors"
      >
        <Upload size={24} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {selectedFiles.length > 0
            ? `${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''} selected`
            : 'Click to select CSV files'}
        </p>
        <p className="text-xs text-gray-400 mt-1">Select your CSV files</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {selectedFiles.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-700 dark:text-gray-300"
              >
                <FileText size={12} />
                {f.name}
              </span>
            ))}
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            className="btn-primary"
          >
            {importing ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Importing...
              </>
            ) : (
              <>
                <Upload size={16} className="mr-2" />
                Import {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      )}

      {importError && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} />
          {importError}
        </div>
      )}

      {result && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check size={16} />
            Import complete
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{result.imported}</p>
              <p className="text-xs text-gray-500">Imported</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{result.skipped}</p>
              <p className="text-xs text-gray-500">Skipped</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{result.total_errors}</p>
              <p className="text-xs text-gray-500">Errors</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div>
              <button
                onClick={() => setShowErrors(!showErrors)}
                className="text-xs text-primary-600 hover:text-primary-700"
              >
                {showErrors ? 'Hide' : 'Show'} error details
              </button>
              {showErrors && (
                <ul className="mt-2 space-y-1 text-xs text-red-600 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function JobStatusIcon({ status }: { status: Job['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock size={16} className="text-gray-400" />;
    case 'running':
      return <Loader2 size={16} className="animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle2 size={16} className="text-green-500" />;
    case 'failed':
      return <XCircle size={16} className="text-red-500" />;
    case 'cancelled':
      return <Ban size={16} className="text-amber-500" />;
  }
}

function JobsSection({ refreshKey }: { refreshKey: number }) {
  const [jobList, setJobList] = useState<Job[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = async () => {
    try {
      const data = await jobs.list();
      setJobList(data);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  };

  useEffect(() => {
    loadJobs();
  }, [refreshKey]);

  // Poll while any job is running
  useEffect(() => {
    const hasActive = jobList.some((j) => j.status === 'pending' || j.status === 'running');
    if (!hasActive) return;
    const interval = setInterval(loadJobs, 3000);
    return () => clearInterval(interval);
  }, [jobList]);

  const startJob = async (type: string) => {
    setStarting(true);
    setError(null);
    try {
      await jobs.start(type);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start job');
    } finally {
      setStarting(false);
    }
  };

  const cancelJob = async (id: string) => {
    try {
      await jobs.cancel(id);
      // Mark as cancelling optimistically in the UI
      setJobList((prev) =>
        prev.map((j) =>
          j.id === id ? { ...j, progress: { ...j.progress, message: 'Cancelling...' } } : j
        )
      );
      // Poll quickly until the job is actually cancelled/completed
      const pollCancel = async (retries: number) => {
        const data = await jobs.list();
        setJobList(data);
        const job = data.find((j: Job) => j.id === id);
        if (job && (job.status === 'pending' || job.status === 'running') && retries > 0) {
          setTimeout(() => pollCancel(retries - 1), 1000);
        }
      };
      pollCancel(15);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel job');
    }
  };

  const hasActiveJob = jobList.some((j) => j.status === 'pending' || j.status === 'running');

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Cog size={20} className="text-gray-600 dark:text-gray-400" />
        Jobs
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Run background tasks to enrich venue data or sync with external services.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => startJob('backfill')}
          disabled={starting || hasActiveJob}
          className="btn-primary"
        >
          {starting ? (
            <>
              <Loader2 size={16} className="animate-spin mr-2" />
              Starting...
            </>
          ) : (
            <>
              <Play size={16} className="mr-2" />
              Backfill Venues
            </>
          )}
        </button>
        <button
          onClick={() => startJob('dawarich-export')}
          disabled={starting || hasActiveJob}
          className="btn-secondary"
        >
          <Send size={16} className="mr-2" />
          Export to Dawarich
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {jobList.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Jobs</h3>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {jobList.map((job) => (
              <div key={job.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <JobStatusIcon status={job.status} />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">{job.type}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      job.status === 'completed' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                      job.status === 'running' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                      job.status === 'failed' ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                      'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(job.status === 'pending' || job.status === 'running') && (
                      <button
                        onClick={() => cancelJob(job.id)}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                      >
                        <StopCircle size={13} />
                        Cancel
                      </button>
                    )}
                    <span className="text-xs text-gray-400">{formatRelativeTime(job.created_at)}</span>
                  </div>
                </div>
                {job.progress?.message && (
                  <p className="text-xs text-gray-500 mt-1 ml-6">{job.progress.message}</p>
                )}
                {job.error && job.status !== 'cancelled' && (
                  <p className="text-xs text-red-500 mt-1 ml-6">{job.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityManagementSection() {
  const [groups, setGroups] = useState<MoodActivityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addingActivityForGroup, setAddingActivityForGroup] = useState<string | null>(null);
  const [newActivityName, setNewActivityName] = useState('');
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editingActivity, setEditingActivity] = useState<string | null>(null);
  const [editActivityName, setEditActivityName] = useState('');

  useEffect(() => {
    moodActivities.groups().then(setGroups).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      const group = await moodActivities.createGroup({ name: newGroupName.trim() });
      setGroups(prev => [...prev, { ...group, activities: [] }]);
      setNewGroupName('');
      setAddingGroup(false);
    } catch (err) {
      console.error('Failed to create group:', err);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm('Delete this group and all its activities?')) return;
    try {
      await moodActivities.deleteGroup(id);
      setGroups(prev => prev.filter(g => g.id !== id));
    } catch (err) {
      console.error('Failed to delete group:', err);
    }
  };

  const handleRenameGroup = async (id: string) => {
    if (!editGroupName.trim()) return;
    try {
      await moodActivities.updateGroup(id, { name: editGroupName.trim() });
      setGroups(prev => prev.map(g => g.id === id ? { ...g, name: editGroupName.trim() } : g));
      setEditingGroup(null);
    } catch (err) {
      console.error('Failed to rename group:', err);
    }
  };

  const handleAddActivity = async (groupId: string) => {
    if (!newActivityName.trim()) return;
    try {
      const activity = await moodActivities.createActivity({ group_id: groupId, name: newActivityName.trim() });
      setGroups(prev => prev.map(g =>
        g.id === groupId ? { ...g, activities: [...g.activities, activity] } : g
      ));
      setNewActivityName('');
      setAddingActivityForGroup(null);
    } catch (err) {
      console.error('Failed to create activity:', err);
    }
  };

  const handleDeleteActivity = async (activityId: string, groupId: string) => {
    try {
      await moodActivities.deleteActivity(activityId);
      setGroups(prev => prev.map(g =>
        g.id === groupId ? { ...g, activities: g.activities.filter(a => a.id !== activityId) } : g
      ));
    } catch (err) {
      console.error('Failed to delete activity:', err);
    }
  };

  const handleRenameActivity = async (activityId: string, groupId: string) => {
    if (!editActivityName.trim()) return;
    try {
      await moodActivities.updateActivity(activityId, { name: editActivityName.trim() });
      setGroups(prev => prev.map(g =>
        g.id === groupId ? {
          ...g,
          activities: g.activities.map(a => a.id === activityId ? { ...a, name: editActivityName.trim() } : a),
        } : g
      ));
      setEditingActivity(null);
    } catch (err) {
      console.error('Failed to rename activity:', err);
    }
  };

  if (loading) {
    return (
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6">
        <Loader2 className="animate-spin text-gray-400 mx-auto" size={24} />
      </div>
    );
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Cog size={20} className="text-gray-600 dark:text-gray-400" />
        Mood Activities
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Manage activity groups and activities for mood check-ins.
      </p>

      {groups.length === 0 && !addingGroup && (
        <p className="text-sm text-gray-400 italic">No activity groups yet.</p>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              {editingGroup === group.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={editGroupName}
                    onChange={(e) => setEditGroupName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRenameGroup(group.id)}
                    className="input text-sm flex-1"
                    autoFocus
                  />
                  <button onClick={() => handleRenameGroup(group.id)} className="text-primary-600 text-sm font-medium">Save</button>
                  <button onClick={() => setEditingGroup(null)} className="text-gray-400 text-sm">Cancel</button>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{group.name}</h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingGroup(group.id); setEditGroupName(group.name); }}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="Rename group"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group.id)}
                      className="p-1 text-gray-400 hover:text-red-500"
                      title="Delete group"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {group.activities.map((act) => (
                <span key={act.id} className="group inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {editingActivity === act.id ? (
                    <span className="flex items-center gap-1">
                      <input
                        type="text"
                        value={editActivityName}
                        onChange={(e) => setEditActivityName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRenameActivity(act.id, group.id)}
                        className="bg-transparent text-xs w-20 outline-none"
                        autoFocus
                      />
                      <button onClick={() => handleRenameActivity(act.id, group.id)} className="text-primary-500">
                        <Check size={10} />
                      </button>
                    </span>
                  ) : (
                    <>
                      <span
                        className="cursor-pointer"
                        onClick={() => { setEditingActivity(act.id); setEditActivityName(act.name); }}
                      >
                        {act.name}
                      </span>
                      <button
                        onClick={() => handleDeleteActivity(act.id, group.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                      >
                        <XCircle size={11} />
                      </button>
                    </>
                  )}
                </span>
              ))}
              {addingActivityForGroup === group.id ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="text"
                    value={newActivityName}
                    onChange={(e) => setNewActivityName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddActivity(group.id)}
                    placeholder="Name"
                    className="px-2 py-0.5 text-xs rounded-full border border-gray-300 dark:border-gray-600 bg-transparent w-24 outline-none focus:border-primary-400"
                    autoFocus
                  />
                  <button onClick={() => handleAddActivity(group.id)} className="text-primary-500"><Plus size={12} /></button>
                  <button onClick={() => { setAddingActivityForGroup(null); setNewActivityName(''); }} className="text-gray-400 text-xs">Cancel</button>
                </span>
              ) : (
                <button
                  onClick={() => setAddingActivityForGroup(group.id)}
                  className="px-2 py-0.5 text-xs rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors"
                >
                  <Plus size={10} className="inline -mt-0.5" /> Add
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {addingGroup ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddGroup()}
            placeholder="Group name"
            className="input text-sm flex-1"
            autoFocus
          />
          <button onClick={handleAddGroup} className="btn-primary text-sm px-3 py-1.5">Add</button>
          <button onClick={() => { setAddingGroup(false); setNewGroupName(''); }} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => setAddingGroup(true)}
          className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center gap-1"
        >
          <Plus size={14} /> Add Group
        </button>
      )}
    </div>
  );
}

export default function Settings() {
  const [data, setData] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobRefreshKey, setJobRefreshKey] = useState(0);

  // Profile form
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Integration form
  const [dawarichUrl, setDawarichUrl] = useState('');
  const [dawarichApiKey, setDawarichApiKey] = useState('');
  const [immichUrl, setImmichUrl] = useState('');
  const [immichApiKey, setImmichApiKey] = useState('');
  const [malojaUrl, setMalojaUrl] = useState('');
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [integrationMsg, setIntegrationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Notifications
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notifyStreak, setNotifyStreak] = useState(true);
  const [notifyWeekly, setNotifyWeekly] = useState(true);
  const [notifyMilestone, setNotifyMilestone] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMsg, setNotifMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const s = await settings.get();
        setData(s);
        setUsername(s.username || '');
        setDisplayName(s.display_name || '');
        setDawarichUrl(s.dawarich_url || '');
        setDawarichApiKey(s.dawarich_api_key || '');
        setImmichUrl(s.immich_url || '');
        setImmichApiKey(s.immich_api_key || '');
        setMalojaUrl(s.maloja_url || '');
        setNotificationsEnabled(s.notifications_enabled ?? true);
        setNotifyStreak(s.notify_streak_reminder ?? true);
        setNotifyWeekly(s.notify_weekly_summary ?? true);
        setNotifyMilestone(s.notify_milestone ?? true);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await settings.updateProfile({ username, display_name: displayName });
      setProfileMsg({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setProfileSaving(false);
    }
  };

  const saveIntegrations = async () => {
    setIntegrationSaving(true);
    setIntegrationMsg(null);
    try {
      await settings.update({
        dawarich_url: dawarichUrl || null,
        dawarich_api_key: dawarichApiKey || null,
        immich_url: immichUrl || null,
        immich_api_key: immichApiKey || null,
        maloja_url: malojaUrl || null,
      });
      setIntegrationMsg({ type: 'success', text: 'Integration settings saved.' });
    } catch (err) {
      setIntegrationMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setIntegrationSaving(false);
    }
  };

  const saveNotifications = async () => {
    setNotifSaving(true);
    setNotifMsg(null);
    try {
      await settings.update({
        notifications_enabled: notificationsEnabled,
        notify_streak_reminder: notifyStreak,
        notify_weekly_summary: notifyWeekly,
        notify_milestone: notifyMilestone,
      });
      setNotifMsg({ type: 'success', text: 'Notification preferences saved.' });
    } catch (err) {
      setNotifMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setNotifSaving(false);
    }
  };

  const { theme: currentTheme, setTheme } = useTheme();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>

      {/* Profile Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <User size={20} className="text-gray-600 dark:text-gray-400" />
          Profile
        </h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input"
            placeholder="Optional"
          />
        </div>
        {profileMsg && (
          <div className={`flex items-center gap-2 text-sm ${profileMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {profileMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            {profileMsg.text}
          </div>
        )}
        <button onClick={saveProfile} disabled={profileSaving} className="btn-primary">
          {profileSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
          Save Profile
        </button>
      </div>

      {/* Appearance Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Sun size={20} className="text-primary-600" />
          Appearance
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choose your preferred color scheme.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'system' as const, label: 'Follow System', icon: Monitor },
            { value: 'light' as const, label: 'Light', icon: Sun },
            { value: 'dark' as const, label: 'Dark', icon: Moon },
          ]).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-sm font-medium ${
                currentTheme === value
                  ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400 shadow-sm'
                  : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <Icon size={20} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Mood Icon Pack */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Smile size={20} className="text-primary-600" />
          Mood Icons
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choose which icons represent your mood scale.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'emoji' as const, label: 'Emoji' },
            { value: 'lucide' as const, label: 'Rounded' },
            { value: 'nature' as const, label: 'Nature' },
          ]).map(({ value, label }) => (
            <button
              key={value}
              onClick={async () => {
                await settings.update({ mood_icon_pack: value });
                setData(prev => prev ? { ...prev, mood_icon_pack: value } : prev);
              }}
              className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-sm font-medium ${
                data?.mood_icon_pack === value
                  ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400 shadow-sm'
                  : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <MoodIconRow pack={value} size={20} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Activity & Group Management */}
      <ActivityManagementSection />

      {/* Notifications Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          {notificationsEnabled ? <Bell size={20} className="text-primary-600" /> : <BellOff size={20} className="text-gray-400" />}
          Notifications
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Control which notifications you receive.
        </p>

        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Enable Notifications</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Master toggle for all notifications</p>
            </div>
            <button
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                notificationsEnabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </label>

          <div className={`space-y-3 transition-opacity ${notificationsEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3" />

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Streak Reminders</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Remind you to check in to keep your streak alive</p>
              </div>
              <button
                onClick={() => setNotifyStreak(!notifyStreak)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  notifyStreak ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  notifyStreak ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Weekly Summary</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">A recap of your check-ins from the past week</p>
              </div>
              <button
                onClick={() => setNotifyWeekly(!notifyWeekly)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  notifyWeekly ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  notifyWeekly ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Milestones</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Celebrate when you hit check-in milestones (100, 500, etc.)</p>
              </div>
              <button
                onClick={() => setNotifyMilestone(!notifyMilestone)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  notifyMilestone ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  notifyMilestone ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </label>
          </div>
        </div>

        {notifMsg && (
          <div className={`flex items-center gap-2 text-sm ${notifMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {notifMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            {notifMsg.text}
          </div>
        )}
        <button onClick={saveNotifications} disabled={notifSaving} className="btn-primary">
          {notifSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
          Save Notifications
        </button>
      </div>

      {/* Integrations Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Link2 size={20} className="text-gray-600 dark:text-gray-400" />
          Integrations
        </h2>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Dawarich</h3>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">URL</label>
                <input
                  type="url"
                  value={dawarichUrl}
                  onChange={(e) => setDawarichUrl(e.target.value)}
                  className="input"
                  placeholder="https://dawarich.example.com"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">API Key</label>
                <input
                  type="password"
                  value={dawarichApiKey}
                  onChange={(e) => setDawarichApiKey(e.target.value)}
                  className="input"
                  placeholder="Enter API key"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Immich</h3>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">URL</label>
                <input
                  type="url"
                  value={immichUrl}
                  onChange={(e) => setImmichUrl(e.target.value)}
                  className="input"
                  placeholder="https://immich.example.com"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">API Key</label>
                <input
                  type="password"
                  value={immichApiKey}
                  onChange={(e) => setImmichApiKey(e.target.value)}
                  className="input"
                  placeholder="Enter API key"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Maloja</h3>
            <p className="text-xs text-gray-500 mb-2">
              Connect to your Maloja scrobble server to show what music you were listening to around each check-in.
            </p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">URL</label>
              <input
                type="url"
                value={malojaUrl}
                onChange={(e) => setMalojaUrl(e.target.value)}
                className="input"
                placeholder="https://maloja.example.com"
              />
            </div>
          </div>
        </div>

        {integrationMsg && (
          <div className={`flex items-center gap-2 text-sm ${integrationMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {integrationMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            {integrationMsg.text}
          </div>
        )}
        <button onClick={saveIntegrations} disabled={integrationSaving} className="btn-primary">
          {integrationSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
          Save Integrations
        </button>
      </div>

      {/* Export Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Download size={20} className="text-gray-600 dark:text-gray-400" />
          Export Data
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Download all your check-in data as a JSON file.
        </p>
        <a
          href="/api/v1/checkins/export"
          download
          className="btn-primary inline-flex items-center gap-2"
        >
          <Download size={16} />
          Export JSON
        </a>
      </div>

      {/* Import Section */}
      <SwarmImportSection onImportComplete={() => setJobRefreshKey((k) => k + 1)} />

      {/* Jobs Section */}
      <JobsSection refreshKey={jobRefreshKey} />
    </div>
  );
}
