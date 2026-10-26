import React, { useState, useEffect } from 'react';
import { Navigation, ActiveTab } from './components/Navigation.tsx';
import { FamilyLIFFView } from './components/FamilyLIFFView.tsx';
import { DocumentHistoryView } from './components/DocumentHistoryView.tsx';
import { LineSimulatorView } from './components/LineSimulatorView.tsx';
import { AdminLIFFView } from './components/AdminLIFFView.tsx';
import { PrivacyAndGuideView } from './components/PrivacyAndGuideView.tsx';
import { ExtractedDocument, Family, AdminMetrics, InviteCode, AuditLog } from './types/index.ts';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('family_liff');
  const [currentFamilyId, setCurrentFamilyId] = useState<string>('fam_tokyo_01');
  const [family, setFamily] = useState<Family | null>(null);
  const [documents, setDocuments] = useState<ExtractedDocument[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [allFamilies, setAllFamilies] = useState<Family[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load all app data from backend APIs
  const loadAppData = async () => {
    try {
      // 1. Load family profile
      const resFam = await fetch(`/api/family?familyId=${currentFamilyId}`);
      if (resFam.ok) {
        const data = await resFam.json();
        setFamily(data.family);
      }

      // 2. Load family documents
      const resDocs = await fetch(`/api/documents?familyId=${currentFamilyId}`);
      if (resDocs.ok) {
        const data = await resDocs.json();
        setDocuments(data.documents);
      }

      // 3. Load admin metrics
      const resMetrics = await fetch('/api/admin/metrics');
      if (resMetrics.ok) {
        const data = await resMetrics.json();
        setMetrics(data.metrics);
      }

      // 4. Load all families (for admin)
      const resAllFam = await fetch('/api/admin/families');
      if (resAllFam.ok) {
        const data = await resAllFam.json();
        setAllFamilies(data.families);
      }

      // 5. Load invite codes
      const resInv = await fetch('/api/admin/invite-codes');
      if (resInv.ok) {
        const data = await resInv.json();
        setInviteCodes(data.invite_codes);
      }

      // 6. Load audit logs
      const resLogs = await fetch('/api/admin/audit-logs');
      if (resLogs.ok) {
        const data = await resLogs.json();
        setAuditLogs(data.audit_logs);
      }
    } catch (err) {
      console.error('Error fetching data from server:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAppData();
  }, [currentFamilyId]);

  // Toggle todo task action
  const handleToggleAction = async (docId: string, actionId: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/action-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, familyId: currentFamilyId }),
      });
      if (res.ok) {
        setDocuments((prev) =>
          prev.map((doc) => {
            if (doc.id !== docId) return doc;
            return {
              ...doc,
              actions: doc.actions.map((act) =>
                act.id === actionId ? { ...act, completed: !act.completed } : act
              ),
            };
          })
        );
      }
    } catch (err) {
      console.error('Error toggling action:', err);
    }
  };

  // Submit feedback
  const handleSubmitFeedback = async (docId: string, feedback: 'up' | 'down', note?: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback, note, familyId: currentFamilyId }),
      });
      if (res.ok) {
        setDocuments((prev) =>
          prev.map((doc) => (doc.id === docId ? { ...doc, feedback } : doc))
        );
        loadAppData();
      }
    } catch (err) {
      console.error('Error submitting feedback:', err);
    }
  };

  // Rotate secret ICS Token
  const handleRotateIcsToken = async () => {
    try {
      const res = await fetch('/api/family/ics-token/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId: currentFamilyId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (family && data.ics_token) {
          setFamily({ ...family, ics_token: data.ics_token });
        }
      }
    } catch (err) {
      console.error('Error rotating token:', err);
    }
  };

  // Purge all family data
  const handleDeleteFamilyData = async () => {
    try {
      const res = await fetch('/api/family/delete-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId: currentFamilyId }),
      });
      if (res.ok) {
        setDocuments([]);
        if (family) {
          setFamily({ ...family, quota_used: 0 });
        }
        loadAppData();
      }
    } catch (err) {
      console.error('Error deleting family data:', err);
    }
  };

  // Toggle Urgent Reminder & Send immediate LINE notification
  const handleToggleUrgent = async (docId: string, reason?: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/toggle-urgent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId: currentFamilyId, reason }),
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments((prev) =>
          prev.map((d) => {
            if (d.id === docId) {
              return {
                ...d,
                is_urgent: data.is_urgent,
                urgent_notified_at: data.notified_at,
              };
            }
            return d;
          })
        );
        loadAppData();
        return data;
      }
    } catch (err) {
      console.error('Error toggling urgent:', err);
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between text-slate-900">
      <div>
        <Navigation
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          familyName={family?.family_name}
          quotaUsed={family?.quota_used}
          quotaLimit={family?.quota_limit}
          totalDocs={documents.length}
        />

        <main className="pb-16">
          {activeTab === 'family_liff' && family && (
            <FamilyLIFFView
              family={family}
              documents={documents}
              onToggleAction={handleToggleAction}
              onSubmitFeedback={handleSubmitFeedback}
              onToggleUrgent={handleToggleUrgent}
              onRotateIcsToken={handleRotateIcsToken}
              onDeleteFamilyData={handleDeleteFamilyData}
              onOpenPrivacy={() => setActiveTab('privacy_guide')}
            />
          )}

          {activeTab === 'doc_history' && (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <DocumentHistoryView
                documents={documents}
                onToggleAction={handleToggleAction}
                onSubmitFeedback={handleSubmitFeedback}
                onToggleUrgent={handleToggleUrgent}
                onOpenCalendar={() => setActiveTab('family_liff')}
                onOpenIcs={() => setActiveTab('family_liff')}
              />
            </div>
          )}

          {activeTab === 'line_simulator' && (
            <LineSimulatorView
              familyId={currentFamilyId}
              onRefreshData={loadAppData}
              onOpenPrivacy={() => setActiveTab('privacy_guide')}
            />
          )}

          {activeTab === 'admin_dashboard' && metrics && (
            <AdminLIFFView
              metrics={metrics}
              families={allFamilies}
              inviteCodes={inviteCodes}
              auditLogs={auditLogs}
              onRefresh={loadAppData}
            />
          )}

          {activeTab === 'privacy_guide' && <PrivacyAndGuideView />}
        </main>
      </div>

      {/* Footer conforming to Section 1.B & 1.D (quiet, unboxed metadata, zero pill, no decorative dots) */}
      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">Giấy Tờ Nhật</span>
            <span aria-hidden="true">·</span>
            <span>Bản thử nghiệm Beta 2026</span>
            <span aria-hidden="true">·</span>
            <span>Khu vực asia-northeast1 (Tokyo)</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveTab('privacy_guide')}
              className="hover:text-slate-800 transition-colors"
            >
              Chính sách bảo mật & Điều khoản
            </button>
            <span aria-hidden="true">·</span>
            <span>Hạn mức: 20 gia đình</span>
            <span aria-hidden="true">·</span>
            <span>Thời gian giữ dữ liệu: 90 ngày</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
