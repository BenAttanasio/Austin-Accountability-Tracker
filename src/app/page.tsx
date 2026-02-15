'use client';

import { useState } from 'react';
import { AuthProvider } from '@/components/AuthContext';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import AdminLogin from '@/components/AdminLogin';
import DashboardTab from '@/components/DashboardTab';
import FlagsTab from '@/components/FlagsTab';
import CrossRefsTab from '@/components/CrossRefsTab';
import WatchlistTab from '@/components/WatchlistTab';
import LiveLogTab from '@/components/LiveLogTab';
import ExportTab from '@/components/ExportTab';

export default function Home() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <AuthProvider>
      <div className="h-screen flex flex-col">
        <Header />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <main className="flex-1 overflow-hidden">
            {activeTab === 'dashboard' && <DashboardTab onNavigate={setActiveTab} />}
            {activeTab === 'flags' && <FlagsTab />}
            {activeTab === 'crossrefs' && <CrossRefsTab />}
            {activeTab === 'watchlist' && <WatchlistTab />}
            {activeTab === 'log' && <LiveLogTab />}
            {activeTab === 'export' && <ExportTab />}
          </main>
        </div>
        <AdminLogin />
      </div>
    </AuthProvider>
  );
}
