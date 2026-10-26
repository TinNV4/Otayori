import React from 'react';
import { Layers, MessageSquare, Shield, BookOpen, Smartphone } from 'lucide-react';

export type ActiveTab = 'family_liff' | 'doc_history' | 'line_simulator' | 'admin_dashboard' | 'privacy_guide';

interface NavigationProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  familyName?: string;
  quotaUsed?: number;
  quotaLimit?: number;
  totalDocs?: number;
  showSimulator?: boolean;
  showAdmin?: boolean;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  familyName,
  quotaUsed = 0,
  quotaLimit = 50,
  totalDocs = 0,
  showSimulator = false,
  showAdmin = false,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-8 h-16">
          {/* Zone 1: Single text element wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
              日
            </div>
            <button
              onClick={() => onSelectTab('family_liff')}
              className="text-left font-bold text-slate-900 tracking-tight text-lg hover:text-emerald-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              Giấy Tờ Nhật
            </button>
          </div>

          {/* Zone 2: 5 single-line nav links conforming to Top Bar Contract */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              onClick={() => onSelectTab('family_liff')}
              className={`flex items-center gap-1.5 py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'family_liff'
                  ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600'
                  : 'hover:text-slate-900'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>Trợ Lý Gia Đình</span>
            </button>

            <button
              onClick={() => onSelectTab('doc_history')}
              className={`flex items-center gap-1.5 py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'doc_history'
                  ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600'
                  : 'hover:text-slate-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Lịch Sử Giấy Tờ ({totalDocs})</span>
            </button>

            {showSimulator && (

            <button
              onClick={() => onSelectTab('line_simulator')}
              className={`flex items-center gap-1.5 py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'line_simulator'
                  ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600'
                  : 'hover:text-slate-900'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>LINE Test Lab</span>
            </button>

            )}

            {showAdmin && (

            <button
              onClick={() => onSelectTab('admin_dashboard')}
              className={`flex items-center gap-1.5 py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'admin_dashboard'
                  ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600'
                  : 'hover:text-slate-900'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>LIFF Quản Trị</span>
            </button>

            )}

            <button
              onClick={() => onSelectTab('privacy_guide')}
              className={`flex items-center gap-1.5 py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === 'privacy_guide'
                  ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600'
                  : 'hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Bảo Mật</span>
            </button>
          </nav>

          {/* Zone 3: 1 primary action / Family status */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:flex flex-col items-end text-xs">
              <span className="font-medium text-slate-800 truncate max-w-[180px]">
                {familyName || 'Chưa có gia đình'}
              </span>
              <span className="text-slate-500 tabular-nums">
                Quota: {quotaUsed}/{quotaLimit} giấy tờ/tháng
              </span>
            </div>

            {showSimulator && (

            <button
              onClick={() => onSelectTab('line_simulator')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Mở LINE Bot</span>
            </button>

            )}
          </div>
        </div>
      </div>

      {/* Mobile Sub-Nav */}
      <div className="md:hidden border-t border-slate-100 px-4 py-2 flex items-center justify-between text-xs overflow-x-auto gap-2">
        <button
          onClick={() => onSelectTab('family_liff')}
          className={`whitespace-nowrap px-2.5 py-1.5 rounded-md ${
            activeTab === 'family_liff' ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-600'
          }`}
        >
          📱 Gia đình
        </button>
        <button
          onClick={() => onSelectTab('doc_history')}
          className={`whitespace-nowrap px-2.5 py-1.5 rounded-md ${
            activeTab === 'doc_history' ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-600'
          }`}
        >
          📁 Lịch sử ({totalDocs})
        </button>
        {showSimulator && (
        <button
          onClick={() => onSelectTab('line_simulator')}
          className={`whitespace-nowrap px-2.5 py-1.5 rounded-md ${
            activeTab === 'line_simulator' ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-600'
          }`}
        >
          💬 Chatbot
        </button>
        )}
        {showAdmin && (
        <button
          onClick={() => onSelectTab('admin_dashboard')}
          className={`whitespace-nowrap px-2.5 py-1.5 rounded-md ${
            activeTab === 'admin_dashboard' ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-600'
          }`}
        >
          🛡️ Admin
        </button>
        )}
        <button
          onClick={() => onSelectTab('privacy_guide')}
          className={`whitespace-nowrap px-2.5 py-1.5 rounded-md ${
            activeTab === 'privacy_guide' ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-600'
          }`}
        >
          📜 Bảo mật
        </button>
      </div>
    </header>
  );
};
