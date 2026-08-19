import { useState } from 'react';
import { User, Check, AlertCircle, Loader2 } from 'lucide-react';
import { settings } from '../../api/client';

interface AccountTabProps {
  initialUsername: string;
  initialDisplayName: string;
}

export function AccountTab({
  initialUsername,
  initialDisplayName,
}: AccountTabProps) {
  const [username, setUsername] = useState(initialUsername);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  return (
    <>
      {/* Profile Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4 scroll-mt-24">
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
    </>
  );
}
