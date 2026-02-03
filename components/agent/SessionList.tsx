'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

export type SessionItem = {
  id: string;
  title: string;
  updatedAt: string;
  lastMessagePreview?: string;
};

export function SessionList({
  sessions,
  currentId,
  loading,
  onSelect,
  onNewChat,
  onAfterAction,
  hideDashboardLink = false,
}: {
  sessions: SessionItem[];
  currentId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  /** Called after rename or delete; if deletedId is set, the parent may redirect when it was the current session */
  onAfterAction?: (deletedId?: string) => void;
  /** Hide the Dashboard link (useful when already on dashboard page) */
  hideDashboardLink?: boolean;
}) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) {
      const s = sessions.find((x) => x.id === renamingId);
      setRenameValue(s?.title || '');
      renameInputRef.current?.focus();
    }
  }, [renamingId, sessions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRename = (id: string) => {
    setMenuOpenId(null);
    setRenamingId(id);
  };

  const submitRename = async (id: string) => {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameValue.trim() }),
      });
      if (res.ok) {
        setRenamingId(null);
        onAfterAction?.();
      }
    } catch {
      // ignore
    }
  };

  const handleDeleteSuccess = (id: string) => {
    onAfterAction?.(id);
  };

  const handleDelete = (id: string) => {
    setMenuOpenId(null);
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    setDeletingId(id);
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        if (res.ok) {
          handleDeleteSuccess(id);
        }
      } finally {
        setDeletingId(null);
      }
    })();
  };

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-3 space-y-2">
        {!hideDashboardLink && (
          <Link
            href="/"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Dashboard
          </Link>
        )}
        <button
          type="button"
          onClick={onNewChat}
          className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-sm text-gray-500">Loading…</div>
        ) : (
          <ul className="p-2">
            {sessions.map((s) => (
              <li key={s.id} className="group relative flex items-center gap-0.5 rounded-lg">
                {renamingId === s.id ? (
                  <div className="flex flex-1 items-center gap-1 pr-8">
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename(s.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => submitRename(s.id)}
                      className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
                    />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      className={`min-w-0 flex-1 truncate rounded-lg px-3 py-2.5 text-left text-sm ${
                        currentId === s.id
                          ? 'bg-gray-100 font-medium text-gray-900'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                      title={s.lastMessagePreview ?? s.title}
                    >
                      {s.title || 'New chat'}
                    </button>
                    <div className="relative shrink-0" ref={menuOpenId === s.id ? menuRef : undefined}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(menuOpenId === s.id ? null : s.id);
                        }}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        aria-label="Menu"
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="5" r="1.5" />
                          <circle cx="12" cy="12" r="1.5" />
                          <circle cx="12" cy="19" r="1.5" />
                        </svg>
                      </button>
                      {menuOpenId === s.id && (
                        <div className="absolute right-0 top-full z-10 mt-0.5 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => handleRename(s.id)}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(s.id)}
                            disabled={deletingId === s.id}
                            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {deletingId === s.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
