'use client';

import { useState } from 'react';
import { useAuth } from './AuthContext';

export default function AdminLogin() {
  const { isAdmin, login, logout } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    const success = await login(password);
    if (success) {
      setShowModal(false);
      setPassword('');
    } else {
      setError('Invalid password');
    }
    setLoading(false);
  };

  return (
    <>
      <footer className="h-8 border-t border-border bg-surface flex items-center justify-between px-4 shrink-0">
        <span className="text-xs text-muted">
          Data from data.austintexas.gov public APIs
        </span>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <span className="text-xs text-clean font-mono">ADMIN</span>
          )}
          <button
            onClick={() => isAdmin ? logout() : setShowModal(true)}
            className="text-xs text-muted hover:text-foreground transition-colors"
            title={isAdmin ? 'Logout' : 'Admin login'}
          >
            {isAdmin ? '⊗ Logout' : '⊙'}
          </button>
        </div>
      </footer>

      {/* Login Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-lg p-6 w-80">
            <h3 className="text-lg font-semibold mb-4">Admin Login</h3>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Password"
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm mb-3"
              autoFocus
            />
            {error && (
              <div className="text-xs text-critical mb-3">{error}</div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowModal(false); setPassword(''); setError(''); }}
                className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleLogin}
                disabled={loading}
                className="flex-1 px-3 py-2 bg-accent text-white rounded text-sm font-medium disabled:opacity-50"
              >
                {loading ? '...' : 'Login'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
