import React, { useState, useEffect } from 'react';
import { Navigation, ActiveTab } from './components/Navigation.tsx';
import { FamilyLIFFView } from './components/FamilyLIFFView.tsx';
import { DocumentHistoryView } from './components/DocumentHistoryView.tsx';
import { LineSimulatorView } from './components/LineSimulatorView.tsx';
import { AdminLIFFView } from './components/AdminLIFFView.tsx';
import { PrivacyAndGuideView } from './components/PrivacyAndGuideView.tsx';
import { ExtractedDocument, Family, AdminMetrics, InviteCode, AuditLog, MeResponse } from './types/index.ts';
import { apiFetch, initAuth } from './lib/api.ts';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const deepDocId = params.get('doc');
  const deepTab = params.get('tab');
  const [activeTab, setActiveTab] = useState<ActiveTab>(deepTab === 'privacy' ? 'privacy_guide' : 'family_liff');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentFamilyId, setCurrentFamilyId] = useState<string | null>(params.get('familyId'));
  const [family, setFamily] = useState<Family | null>(null);
  const [documents, setDocuments] = useState<ExtractedDocument[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [allFamilies, setAllFamilies] = useState<Family[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const famQs = currentFamilyId ? `?familyId=${encodeURIComponent(currentFamilyId)}` : '';
  const withFamily = (body: object = {}) => JSON.stringify({ ...body, familyId: currentFamilyId });

  const loadMe = async () => {
    try {
      await initAuth();
      const res = await apiFetch('/api/me');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MeResponse = await res.json();
      setMe(data);
      if (!currentFamilyId && data.families[0]) setCurrentFamilyId(data.families[0].family_id);
      if (!data.families.length && data.is_admin && !deepTab) setActiveTab('admin_dashboard');
    } catch (err) {
      setAuthError(String((err as Error).message || err));
    } finally {
      setIsLoading(false);
    }
  };

  const loadAppData = async () => {
    if (!me) return;
    try {
      if (currentFamilyId) {
        const [resFam, resDocs] = await Promise.all([apiFetch(`/api/family${famQs}`), apiFetch(`/api/documents${famQs}`)]);
        if (resFam.ok) setFamily((await resFam.json()).family);
        if (resDocs.ok) setDocuments((await resDocs.json()).documents);
      }
      if (me.is_admin) {
        const [m, f, i, l] = await Promise.all([
          apiFetch('/api/admin/metrics'), apiFetch('/api/admin/families'), apiFetch('/api/admin/invite-codes'), apiFetch('/api/admin/audit-logs'),
        ]);
        if (m.ok) setMetrics((await m.json()).metrics);
        if (f.ok) setAllFamilies((await f.json()).families);
        if (i.ok) setInviteCodes((await i.json()).invite_codes);
        if (l.ok) setAuditLogs((await l.json()).audit_logs);
      }
    } catch (err) {
      console.error('Error fetching data from server:', err);
    }
  };

  useEffect(() => {
    loadMe();
  }, []);

  useEffect(() => {
    loadAppData();
  }, [me, currentFamilyId]);

  const handleToggleAction = async (docId: string, actionId: string) => {
    const res = await apiFetch(`/api/documents/${docId}/action-toggle`, { method: 'POST', body: withFamily({ actionId }) });
    if (res.ok) {
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id !== docId
            ? doc
            : { ...doc, actions: doc.actions.map((act) => (act.id === actionId ? { ...act, completed: !act.completed } : act)) }
        )
      );
    }
  };

  const handleSubmitFeedback = async (docId: string, feedback: 'up' | 'down', note?: string) => {
    const res = await apiFetch(`/api/documents/${docId}/feedback`, { method: 'POST', body: withFamily({ feedback, note }) });
    if (res.ok) setDocuments((prev) => prev.map((doc) => (doc.id === docId ? { ...doc, feedback } : doc)));
  };

  const handleEditDate = async (docId: string, patch: object) => {
    const res = await apiFetch(`/api/documents/${docId}${famQs}`, { method: 'PATCH', body: withFamily(patch) });
    if (!res.ok) return null;
    const { document } = await res.json();
    setDocuments((prev) => prev.map((d) => (d.id === docId ? document : d)));
    return document as ExtractedDocument;
  };

  const handleRotateIcsToken = async () => {
    const res = await apiFetch('/api/family/ics-token/rotate', { method: 'POST', body: withFamily() });
    if (res.ok) {
      const data = await res.json();
      if (family && data.ics_token) setFamily({ ...family, ics_token: data.ics_token, ics_url: data.ics_url });
    }
  };

  const handleDeleteFamilyData = async () => {
    const res = await apiFetch('/api/family/delete-all', { method: 'POST', body: withFamily() });
    if (res.ok) {
      setDocuments([]);
      loadAppData();
    }
  };

  const handleToggleUrgent = async (docId: string, reason?: string) => {
    const res = await apiFetch(`/api/documents/${docId}/toggle-urgent`, { method: 'POST', body: withFamily({ reason }) });
    if (!res.ok) return null;
    const data = await res.json();
    setDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, is_urgent: data.is_urgent, urgent_notified_at: data.notified_at } : d)));
    return data;
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Đang tải…</div>;
  }
  if (authError || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-sm text-slate-600">
        Không đăng nhập được. Vui lòng mở trang này từ LINE.{authError && <div className="mt-2 text-xs text-slate-400">{authError}</div>}
      </div>
    );
  }

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
          showSimulator={me.dev_mode}
          showAdmin={me.is_admin}
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
              onEditDate={handleEditDate}
              initialDocId={deepDocId}
              initialSubTab={deepTab === 'calendar' ? 'ics' : undefined}
            />
          )}

          {(activeTab === 'family_liff' || activeTab === 'doc_history') && !family && (
            <div className="max-w-xl mx-auto px-4 py-16 text-center text-sm text-slate-600 space-y-3">
              <div className="text-3xl">📮</div>
              <p className="font-semibold text-slate-900">Chưa tìm thấy gia đình của bạn</p>
              <p>Thêm bot vào nhóm LINE gia đình, bấm "Đồng ý", nhập mã mời và gửi ít nhất một tin nhắn trong nhóm. Sau đó mở lại trang này từ LINE.</p>
              {me.families.length > 1 && <p>Bạn đang ở nhiều nhóm — chọn nhóm trong link bot gửi.</p>}
            </div>
          )}

          {activeTab === 'doc_history' && family && (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <DocumentHistoryView
                documents={documents}
                onToggleAction={handleToggleAction}
                onSubmitFeedback={handleSubmitFeedback}
                onToggleUrgent={handleToggleUrgent}
                onOpenCalendar={() => setActiveTab('family_liff')}
                onOpenIcs={() => setActiveTab('family_liff')}
                onEditDate={handleEditDate}
              />
            </div>
          )}

          {activeTab === 'line_simulator' && me.dev_mode && (
            <LineSimulatorView
              onRefreshData={async () => {
                const res = await apiFetch('/api/me');
                if (res.ok) {
                  const data: MeResponse = await res.json();
                  if (!currentFamilyId && data.families[0]) setCurrentFamilyId(data.families[0].family_id);
                  setMe(data);
                }
              }}
            />
          )}

          {activeTab === 'admin_dashboard' && me.is_admin && metrics && (
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
            <span>Beta: tối đa {metrics?.max_beta_families ?? 20} gia đình</span>
            <span aria-hidden="true">·</span>
            <span>Thời gian giữ dữ liệu: 90 ngày</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
