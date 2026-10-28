import React, { useState, useEffect } from 'react';
import { FamilyApp } from './components/mobile/FamilyApp.tsx';
import { LineSimulatorView } from './components/LineSimulatorView.tsx';
import { AdminLIFFView } from './components/AdminLIFFView.tsx';
import { PrivacyAndGuideView } from './components/PrivacyAndGuideView.tsx';
import { ExtractedDocument, Family, AdminMetrics, InviteCode, AuditLog, MeResponse } from './types/index.ts';
import { apiFetch, initAuth } from './lib/api.ts';
import { ChevronLeft } from 'lucide-react';

type Screen = 'family' | 'admin' | 'simulator' | 'privacy';

const SubPage: React.FC<{ title: string; onBack: () => void; children: React.ReactNode }> = ({ title, onBack, children }) => (
  <div className="min-h-[100dvh] bg-slate-50">
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 h-14 flex items-center px-2">
      <button onClick={onBack} className="h-11 px-2 flex items-center gap-1 text-[16px] text-emerald-700 font-medium">
        <ChevronLeft className="w-6 h-6" /> Quay lại
      </button>
      <div className="flex-1 text-center text-[16px] font-semibold text-slate-900 pr-20">{title}</div>
    </header>
    {children}
  </div>
);

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const deepDocId = params.get('doc');
  const deepTab = params.get('tab');
  // 'family' = mobile app; the others are full-screen sub-pages with a back button.
  const [screen, setScreen] = useState<Screen>('family');
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
      if (!data.families.length && data.is_admin) setScreen('admin');
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
      if (data.ics_token) loadAppData(); // refresh ics_url + calendar_page_url
    }
  };

  const handleDeleteFamilyData = async () => {
    const res = await apiFetch('/api/family/delete-all', { method: 'POST', body: withFamily() });
    if (res.ok) {
      setDocuments([]);
      loadAppData();
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    const res = await apiFetch(`/api/documents/${docId}${famQs}`, { method: 'DELETE' });
    if (res.ok) setDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleRename = async (name: string) => {
    const res = await apiFetch(`/api/family${famQs}`, { method: 'PATCH', body: withFamily({ family_name: name }) });
    if (res.ok) setFamily((await res.json()).family);
  };

  if (isLoading) {
    return <div className="min-h-[100dvh] flex items-center justify-center text-[15px] text-slate-500">Đang tải…</div>;
  }
  if (authError || !me) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center text-[16px] text-slate-600">
        Không đăng nhập được. Vui lòng mở trang này từ LINE.
        {authError && <div className="mt-2 text-xs text-slate-400">{authError}</div>}
      </div>
    );
  }

  if (screen === 'privacy') {
    return <SubPage title="Quyền riêng tư" onBack={() => setScreen('family')}><PrivacyAndGuideView /></SubPage>;
  }
  if (screen === 'admin' && me.is_admin) {
    return (
      <SubPage title="Quản trị" onBack={() => setScreen('family')}>
        {metrics ? <AdminLIFFView metrics={metrics} families={allFamilies} inviteCodes={inviteCodes} auditLogs={auditLogs} onRefresh={loadAppData} /> : <p className="p-6 text-slate-500">Đang tải…</p>}
      </SubPage>
    );
  }
  if (screen === 'simulator' && me.dev_mode) {
    return (
      <SubPage title="LINE Test Lab" onBack={() => { setScreen('family'); loadAppData(); }}>
        <LineSimulatorView
          onRefreshData={async () => {
            const res = await apiFetch('/api/me');
            if (!res.ok) return;
            const data: MeResponse = await res.json();
            if (!currentFamilyId && data.families[0]) setCurrentFamilyId(data.families[0].family_id);
            setMe(data);
          }}
        />
      </SubPage>
    );
  }

  if (!family) {
    return (
      <div className="min-h-[100dvh] max-w-md mx-auto flex flex-col items-center justify-center px-8 text-center">
        <div className="text-5xl">📮</div>
        <p className="mt-4 text-[18px] font-semibold text-slate-900">Chưa tìm thấy gia đình của bạn</p>
        <p className="mt-2 text-[15px] text-slate-500">
          Thêm bot vào nhóm LINE gia đình, bấm “Đồng ý”, nhập mã mời và gửi ít nhất 1 tin nhắn trong nhóm. Sau đó mở lại trang này.
        </p>
        {me.dev_mode && <button onClick={() => setScreen('simulator')} className="mt-6 h-12 px-5 rounded-2xl bg-emerald-600 text-white font-semibold">Mở LINE Test Lab</button>}
        {me.is_admin && <button onClick={() => setScreen('admin')} className="mt-3 h-12 px-5 rounded-2xl border border-slate-200 font-semibold">Quản trị</button>}
      </div>
    );
  }

  return (
    <FamilyApp
      family={family}
      documents={documents}
      isAdmin={me.is_admin}
      devMode={me.dev_mode}
      initialDocId={deepDocId}
      initialTab={deepTab === 'calendar' ? 'calendar' : undefined}
      onToggleAction={handleToggleAction}
      onFeedback={(id, v) => handleSubmitFeedback(id, v)}
      onEditDate={handleEditDate}
      onDeleteDocument={handleDeleteDocument}
      onRename={handleRename}
      onRotateIcsToken={handleRotateIcsToken}
      onDeleteFamilyData={handleDeleteFamilyData}
      onOpenPrivacy={() => setScreen('privacy')}
      onOpenAdmin={() => setScreen('admin')}
      onOpenSimulator={() => setScreen('simulator')}
    />
  );
}
