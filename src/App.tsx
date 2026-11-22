import React, { useState, useEffect } from 'react';
import { FamilyApp, UploadOutcome } from './components/mobile/FamilyApp.tsx';
import { prepareFile } from './lib/images.ts';
import { LineSimulatorView } from './components/LineSimulatorView.tsx';
import { AdminLIFFView } from './components/AdminLIFFView.tsx';
import { PrivacyAndGuideView } from './components/PrivacyAndGuideView.tsx';
import { ExtractedDocument, Family, AdminMetrics, InviteCode, AuditLog, MeResponse, MonthlyUsage, Translation } from './types/index.ts';
import { apiFetch, initAuth } from './lib/api.ts';
import { Loader2, Users, WifiOff } from 'lucide-react';
import { AppBar, Button, EmptyState } from './components/ui/kit.tsx';

type Screen = 'family' | 'admin' | 'simulator' | 'privacy';

const SubPage: React.FC<{ title: string; onBack: () => void; children: React.ReactNode }> = ({ title, onBack, children }) => (
  <div className="min-h-[100dvh] bg-canvas">
    <AppBar title={title} back={{ onClick: onBack }} />
    {children}
  </div>
);

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const deepDocId = params.get('doc');
  const deepTab = params.get('tab');
  const deepAdmin = params.get('admin'); // from the admin LINE notification
  // 'family' = mobile app; the others are full-screen sub-pages with a back button.
  const [screen, setScreen] = useState<Screen>('family');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentFamilyId, setCurrentFamilyId] = useState<string | null>(params.get('familyId'));
  const [family, setFamily] = useState<Family | null>(null);
  const [documents, setDocuments] = useState<ExtractedDocument[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [usage, setUsage] = useState<MonthlyUsage | null>(null);
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
      if (data.is_admin && (deepAdmin || !data.families.length)) setScreen('admin');
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
        if (m.ok) {
          const j = await m.json();
          setMetrics(j.metrics);
          setUsage(j.usage || null);
        }
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

  const handleToggleDigest = async (on: boolean) => {
    const res = await apiFetch(`/api/family${famQs}`, { method: 'PATCH', body: withFamily({ daily_digest: on }) });
    if (res.ok) setFamily((await res.json()).family);
  };

  const handleRename = async (name: string) => {
    const res = await apiFetch(`/api/family${famQs}`, { method: 'PATCH', body: withFamily({ family_name: name }) });
    if (res.ok) setFamily((await res.json()).family);
  };

  const handleUpload = async (files: File[]): Promise<UploadOutcome> => {
    try {
      const pages = await Promise.all(files.map(prepareFile));
      const res = await apiFetch('/api/documents/upload', { method: 'POST', body: withFamily({ pages }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || `Lỗi ${res.status}. Thử lại sau nhé.` };
      const doc: ExtractedDocument = data.document;
      setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
      if (data.result === 'new') loadAppData(); // quota counter
      return { ok: true, result: data.result, added: data.added, document: doc };
    } catch (err) {
      return { ok: false, error: String((err as Error).message || err) };
    }
  };

  const handleTranslate = async (files: File[]) => {
    try {
      const pages = await Promise.all(files.map(prepareFile));
      const res = await apiFetch('/api/translate', { method: 'POST', body: withFamily({ pages }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false as const, error: data.error || `Lỗi ${res.status}. Thử lại sau nhé.` };
      return { ok: true as const, translation: data.translation as Translation };
    } catch (err) {
      return { ok: false as const, error: String((err as Error).message || err) };
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center gap-2 text-subhead text-ink-2" role="status">
        <Loader2 className="h-5 w-5 animate-spin" /> Đang tải…
      </div>
    );
  }
  if (authError || !me) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState icon={WifiOff} title="Không đăng nhập được" body="Vui lòng mở trang này từ LINE (menu của bot → Trang gia đình)." />
        {authError && <p className="mt-3 text-center text-caption text-ink-3">{authError}</p>}
      </div>
    );
  }

  if (screen === 'privacy') {
    return <SubPage title="Quyền riêng tư" onBack={() => setScreen('family')}><PrivacyAndGuideView /></SubPage>;
  }
  if (screen === 'admin' && me.is_admin) {
    return (
      <SubPage title="Quản trị" onBack={() => setScreen('family')}>
        {metrics ? <AdminLIFFView initialTab={deepAdmin === 'policy' ? 'policy' : undefined} metrics={metrics} usage={usage} families={allFamilies} inviteCodes={inviteCodes} auditLogs={auditLogs} onRefresh={loadAppData} /> : <p className="p-6 text-subhead text-ink-2">Đang tải…</p>}
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
      <div className="mx-auto max-w-md">
        <EmptyState
          icon={Users}
          title="Chưa tìm thấy gia đình của bạn"
          body="Thêm bot vào nhóm LINE gia đình, bấm “Đồng ý”, nhập mã mời và gửi ít nhất 1 tin nhắn trong nhóm. Sau đó mở lại trang này."
          action={
            <div className="flex flex-col gap-2">
              {me.dev_mode && <Button onClick={() => setScreen('simulator')}>Mở LINE Test Lab</Button>}
              {me.is_admin && <Button variant="secondary" onClick={() => setScreen('admin')}>Quản trị</Button>}
            </div>
          }
        />
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
      initialTab={deepTab === 'calendar' ? 'calendar' : deepTab === 'policy' ? 'policy' : undefined}
      onToggleAction={handleToggleAction}
      onFeedback={(id, v) => handleSubmitFeedback(id, v)}
      onEditDate={handleEditDate}
      onDeleteDocument={handleDeleteDocument}
      onRename={handleRename}
      onToggleDigest={handleToggleDigest}
      onRotateIcsToken={handleRotateIcsToken}
      onDeleteFamilyData={handleDeleteFamilyData}
      onOpenPrivacy={() => setScreen('privacy')}
      onOpenAdmin={() => setScreen('admin')}
      onOpenSimulator={() => setScreen('simulator')}
      onUpload={handleUpload}
      onTranslate={handleTranslate}
    />
  );
}
