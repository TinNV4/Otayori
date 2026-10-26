import React, { useState } from 'react';
import {
  Shield,
  Key,
  Users,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  FileText,
  Clock,
  EyeOff,
  CheckCircle2,
  Lock,
  Unlock,
  Plus,
  RefreshCw,
  Send,
} from 'lucide-react';
import { AdminMetrics, AuditLog, Family, InviteCode } from '../types/index.ts';

interface AdminLIFFViewProps {
  metrics: AdminMetrics;
  families: Family[];
  inviteCodes: InviteCode[];
  auditLogs: AuditLog[];
  onRefresh: () => void;
}

export const AdminLIFFView: React.FC<AdminLIFFViewProps> = ({
  metrics,
  families,
  inviteCodes,
  auditLogs,
  onRefresh,
}) => {
  const [adminTab, setAdminTab] = useState<'metrics' | 'families' | 'invites' | 'audit'>('metrics');
  const [newCodeName, setNewCodeName] = useState('');
  const [newCodeQuota, setNewCodeQuota] = useState(50);
  const [newCodeMaxUses, setNewCodeMaxUses] = useState(20);
  const [newCodeNote, setNewCodeNote] = useState('');
  const [isCreatingCode, setIsCreatingCode] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  const triggerNotice = (msg: string) => {
    setActionSuccessMessage(msg);
    setTimeout(() => setActionSuccessMessage(null), 3000);
  };

  const handleCreateInviteCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCodeName.trim()) return;
    setIsCreatingCode(true);

    try {
      const res = await fetch('/api/admin/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newCodeName.trim().toUpperCase(),
          quota: newCodeQuota,
          maxUses: newCodeMaxUses,
          note: newCodeNote,
        }),
      });
      if (res.ok) {
        setNewCodeName('');
        setNewCodeNote('');
        triggerNotice('Đã tạo thành công mã mời mới!');
        onRefresh();
      }
    } catch (err) {
      console.error('Error creating invite code:', err);
    } finally {
      setIsCreatingCode(false);
    }
  };

  const handleUpdateFamilyQuota = async (familyId: string, currentQuota: number) => {
    const promptVal = window.prompt(`Nhập quota mới cho gia đình ${familyId} (hiện tại: ${currentQuota}):`, currentQuota.toString());
    if (!promptVal) return;
    const newQuota = parseInt(promptVal, 10);
    if (isNaN(newQuota) || newQuota < 1) return;

    try {
      const res = await fetch('/api/admin/quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId, newQuota }),
      });
      if (res.ok) {
        triggerNotice(`Đã cập nhật quota gia đình ${familyId} thành ${newQuota}`);
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleFamilySuspend = async (familyId: string) => {
    try {
      const res = await fetch('/api/admin/suspend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId }),
      });
      if (res.ok) {
        triggerNotice(`Đã đổi trạng thái gia đình ${familyId}`);
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Push quota calculation & 80% threshold alert
  const pushUsagePercent = Math.round((metrics.push_messages_used / metrics.push_messages_limit) * 100);
  const isPushWarning = pushUsagePercent >= 80;

  // Budget calculation ($20 cap)
  const budgetUsagePercent = Math.round((metrics.monthly_cost_usd / metrics.monthly_budget_usd) * 100);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Admin Notice Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-emerald-400 font-semibold">LINE Admin Portal</span>
            <span aria-hidden="true">·</span>
            <span>Chỉ dành cho Quản trị viên (LINE userId Admin)</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">Trung Tâm Quản Trị Thử Nghiệm Beta (20 Gia Đình)</h1>
          <p className="text-xs text-slate-300 mt-0.5">
            Giám sát hạn mức Anthropic, mã mời, phân loại và bảo mật riêng tư độc lập theo gia đình.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors self-start shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Làm mới dữ liệu</span>
        </button>
      </div>

      {actionSuccessMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionSuccessMessage}</span>
        </div>
      )}

      {/* Strict Zero-Document-View Audit Guarantee */}
      <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl flex items-start gap-3 text-xs text-amber-950">
        <EyeOff className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold block text-amber-900">
            🔒 Cam kết bảo mật nghiêm ngặt: TUYỆT ĐỐI KHÔNG có tính năng xem ảnh hay nội dung giấy tờ
          </span>
          <p className="text-amber-900/90 leading-relaxed">
            Để bảo vệ quyền riêng tư của 20 gia đình tham gia, giao diện Admin được thiết kế kỹ thuật cô lập 100%: không thể truy vấn ảnh chụp, họ tên học sinh, địa chỉ chi tiết hay nội dung văn bản. Admin chỉ xem được thống kê định lượng (số lượng, loại giấy, chi phí API, mã gia đình).
          </p>
        </div>
      </div>

      {/* Primary KPI Grid (4 Columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Beta Families Cap (Max 20) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Số gia đình thử nghiệm</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.total_families} <span className="text-sm font-normal text-slate-500">/ {metrics.max_beta_families} tối đa</span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-3">
            <div
              className="bg-emerald-600 h-full rounded-full"
              style={{ width: `${(metrics.total_families / metrics.max_beta_families) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-slate-500 block mt-2">
            {metrics.max_beta_families - metrics.total_families} suất trống còn lại
          </span>
        </div>

        {/* KPI 2: Anthropic Budget Guard ($20/month) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Chi phí Anthropic API</span>
            <DollarSign className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            ${metrics.monthly_cost_usd.toFixed(2)}{' '}
            <span className="text-sm font-normal text-slate-500">/ ${metrics.monthly_budget_usd}</span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-3">
            <div
              className={`h-full rounded-full ${budgetUsagePercent > 80 ? 'bg-rose-500' : 'bg-emerald-600'}`}
              style={{ width: `${Math.min(100, budgetUsagePercent)}%` }}
            />
          </div>
          <span className="text-[11px] text-slate-500 block mt-2">
            Đã dùng {budgetUsagePercent}% ngân sách $20/tháng
          </span>
        </div>

        {/* KPI 3: Accuracy Rate (Thumbs Up / Down) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Tỷ lệ phản hồi đúng (👍)</span>
            <TrendingUp className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.accuracy_rate}%
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs text-slate-600">
            <span className="text-emerald-700 font-semibold">{metrics.thumbs_up} Đúng</span>
            <span aria-hidden="true">·</span>
            <span className="text-rose-600 font-semibold">{metrics.thumbs_down} Sai / Sửa</span>
          </div>
          <span className="text-[11px] text-slate-500 block mt-1">
            Tổng cộng: {metrics.total_documents_processed} lượt phân tích
          </span>
        </div>

        {/* KPI 4: LINE Push Quota Warning (200/month) */}
        <div className={`bg-white rounded-2xl border p-5 shadow-xs ${isPushWarning ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Quota tin LINE Push</span>
            <Send className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {metrics.push_messages_used} <span className="text-sm font-normal text-slate-500">/ {metrics.push_messages_limit}</span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-3">
            <div
              className={`h-full rounded-full ${isPushWarning ? 'bg-amber-500' : 'bg-emerald-600'}`}
              style={{ width: `${(metrics.push_messages_used / metrics.push_messages_limit) * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] mt-2">
            <span className={`font-medium ${isPushWarning ? 'text-amber-800' : 'text-slate-500'}`}>
              {isPushWarning ? '⚠️ Đã vượt 80% quota!' : 'Ưu tiên Reply miễn phí'}
            </span>
            <span className="font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded text-[10px]">
              🚨 {metrics.urgent_docs_count || 0} tin khẩn
            </span>
          </div>
        </div>
      </div>

      {/* Admin Sub Navigation */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto text-xs">
        <button
          onClick={() => setAdminTab('metrics')}
          className={`px-3.5 py-2 font-medium rounded-lg whitespace-nowrap transition-colors ${
            adminTab === 'metrics' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Phân tích theo loại giấy ({metrics.total_documents_processed})
        </button>

        <button
          onClick={() => setAdminTab('families')}
          className={`px-3.5 py-2 font-medium rounded-lg whitespace-nowrap transition-colors ${
            adminTab === 'families' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Danh sách gia đình ({families.length})
        </button>

        <button
          onClick={() => setAdminTab('invites')}
          className={`px-3.5 py-2 font-medium rounded-lg whitespace-nowrap transition-colors ${
            adminTab === 'invites' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Quản lý mã mời ({inviteCodes.length})
        </button>

        <button
          onClick={() => setAdminTab('audit')}
          className={`px-3.5 py-2 font-medium rounded-lg whitespace-nowrap transition-colors ${
            adminTab === 'audit' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Nhật ký kiểm toán (Audit Logs)
        </button>
      </div>

      {/* TAB 1: BREAKDOWN BY DOCUMENT TYPE */}
      {adminTab === 'metrics' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Lượt xử lý theo từng loại giấy tờ Nhật</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tỷ lệ gọi Claude Haiku (tiết kiệm) so với Claude Sonnet (hành chính 役所)
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-500 block mb-1">お便り (Bản tin trường)</span>
              <span className="text-lg font-bold text-slate-900 tabular-nums">
                {metrics.docs_by_type.otayori || 0}
              </span>
              <span className="text-[10px] text-emerald-800 block mt-0.5">Model: Haiku</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-500 block mb-1">役所 (Giấy tờ UBND/Thuế)</span>
              <span className="text-lg font-bold text-slate-900 tabular-nums">
                {metrics.docs_by_type.yakusho || 0}
              </span>
              <span className="text-[10px] text-indigo-700 block mt-0.5">Model: Sonnet</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-500 block mb-1">献立表 (Thực đơn trường)</span>
              <span className="text-lg font-bold text-slate-900 tabular-nums">
                {metrics.docs_by_type.kondate || 0}
              </span>
              <span className="text-[10px] text-emerald-800 block mt-0.5">Model: Haiku</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-500 block mb-1">年間予定 (Lịch năm học)</span>
              <span className="text-lg font-bold text-slate-900 tabular-nums">
                {metrics.docs_by_type.nenkan_yotei || 0}
              </span>
              <span className="text-[10px] text-emerald-800 block mt-0.5">Model: Haiku (Multi)</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-500 block mb-1">提出書類 (Đơn nộp/Form)</span>
              <span className="text-lg font-bold text-slate-900 tabular-nums">
                {metrics.docs_by_type.form || 0}
              </span>
              <span className="text-[10px] text-indigo-700 block mt-0.5">Model: Sonnet</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-500 block mb-1">健診・病院 (Khám sức khỏe)</span>
              <span className="text-lg font-bold text-slate-900 tabular-nums">
                {metrics.docs_by_type.hospital || 0}
              </span>
              <span className="text-[10px] text-indigo-700 block mt-0.5">Model: Sonnet</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-500 block mb-1">回覧板 (Bản tin tổ dân phố)</span>
              <span className="text-lg font-bold text-slate-900 tabular-nums">
                {metrics.docs_by_type.kairanban || 0}
              </span>
              <span className="text-[10px] text-emerald-800 block mt-0.5">Model: Haiku</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-500 block mb-1">給与明細 (Phiếu lương/phí)</span>
              <span className="text-lg font-bold text-slate-900 tabular-nums">
                {metrics.docs_by_type.meisai || 0}
              </span>
              <span className="text-[10px] text-emerald-800 block mt-0.5">Model: Haiku</span>
            </div>

            <div className="p-3 bg-rose-50/70 rounded-xl border border-rose-200">
              <span className="text-rose-700 font-semibold block mb-1">🚨 Khẩn cấp (Urgent)</span>
              <span className="text-lg font-bold text-rose-950 tabular-nums">
                {metrics.urgent_docs_count || 0}
              </span>
              <span className="text-[10px] text-rose-800 block mt-0.5">Push LINE ngay</span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FAMILIES MANAGEMENT */}
      {adminTab === 'families' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Danh sách gia đình trong bản Beta</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Quản lý quota từng gia đình, tạm khóa hoặc kiểm tra ngày hoạt động gần nhất
              </p>
            </div>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {families.length}/20 gia đình
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-3.5 font-semibold">Tên gia đình / ID</th>
                  <th className="p-3.5 font-semibold">Mã mời</th>
                  <th className="p-3.5 font-semibold">Trạng thái</th>
                  <th className="p-3.5 font-semibold">Quota sử dụng</th>
                  <th className="p-3.5 font-semibold">Hoạt động gần nhất</th>
                  <th className="p-3.5 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {families.map((fam) => (
                  <tr key={fam.family_id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3.5">
                      <div className="font-semibold text-slate-900">{fam.family_name}</div>
                      <div className="font-mono text-[11px] text-slate-400">{fam.family_id}</div>
                    </td>
                    <td className="p-3.5 font-mono font-medium text-slate-700">
                      {fam.invite_code || 'Chưa kích hoạt'}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`text-[11px] font-semibold ${
                          fam.status === 'active'
                            ? 'text-emerald-700'
                            : fam.status === 'suspended'
                            ? 'text-rose-600'
                            : 'text-amber-700'
                        }`}
                      >
                        {fam.status === 'active'
                          ? 'Đang hoạt động'
                          : fam.status === 'suspended'
                          ? 'Đã tạm khóa'
                          : 'Chờ kích hoạt'}
                      </span>
                    </td>
                    <td className="p-3.5 tabular-nums">
                      <span className="font-semibold text-slate-900">{fam.quota_used}</span>
                      <span className="text-slate-500"> / {fam.quota_limit}</span>
                    </td>
                    <td className="p-3.5 text-slate-500 tabular-nums">
                      {new Date(fam.last_active).toLocaleString('vi-VN')}
                    </td>
                    <td className="p-3.5 text-right space-x-2">
                      <button
                        onClick={() => handleUpdateFamilyQuota(fam.family_id, fam.quota_limit)}
                        className="px-2.5 py-1 text-slate-700 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-100"
                      >
                        Sửa quota
                      </button>
                      <button
                        onClick={() => handleToggleFamilySuspend(fam.family_id)}
                        className={`px-2.5 py-1 rounded-lg border transition-colors ${
                          fam.status === 'suspended'
                            ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                            : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                        }`}
                      >
                        {fam.status === 'suspended' ? 'Mở khóa' : 'Tạm khóa'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: INVITE CODES MANAGER */}
      {adminTab === 'invites' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Create Code Form (5 Cols) */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 mb-1">Tạo mã mời gia đình mới</h2>
            <p className="text-xs text-slate-500 mb-4">
              Kiểm soát số lượng gia đình và quota cho từng đợt thử nghiệm.
            </p>

            <form onSubmit={handleCreateInviteCode} className="space-y-3.5 text-xs">
              <div>
                <label className="font-medium text-slate-700 block mb-1">Mã mời (In hoa, không dấu):</label>
                <input
                  type="text"
                  placeholder="VÍ DỤ: KANTO2026"
                  value={newCodeName}
                  onChange={(e) => setNewCodeName(e.target.value.toUpperCase())}
                  required
                  className="w-full p-2.5 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-slate-700 block mb-1">Quota (giấy/tháng):</label>
                  <input
                    type="number"
                    value={newCodeQuota}
                    onChange={(e) => setNewCodeQuota(parseInt(e.target.value, 10))}
                    min={10}
                    max={100}
                    className="w-full p-2.5 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>

                <div>
                  <label className="font-medium text-slate-700 block mb-1">Số gia đình tối đa:</label>
                  <input
                    type="number"
                    value={newCodeMaxUses}
                    onChange={(e) => setNewCodeMaxUses(parseInt(e.target.value, 10))}
                    min={1}
                    max={20}
                    className="w-full p-2.5 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="font-medium text-slate-700 block mb-1">Ghi chú nhóm thử nghiệm:</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Hội phụ huynh mầm non Edogawa"
                  value={newCodeNote}
                  onChange={(e) => setNewCodeNote(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-xl focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={isCreatingCode || !newCodeName}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors shadow-xs flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>{isCreatingCode ? 'Đang tạo...' : 'Tạo mã mời'}</span>
              </button>
            </form>
          </div>

          {/* Existing Codes List (7 Cols) */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 mb-1">Danh sách mã mời đang kích hoạt</h2>
            <p className="text-xs text-slate-500 mb-4">Các mã được chấp nhận khi bot gia nhập nhóm LINE</p>

            <div className="space-y-3">
              {inviteCodes.map((code) => (
                <div
                  key={code.code}
                  className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-mono font-bold text-slate-900 text-sm">{code.code}</div>
                    <div className="text-slate-500 mt-0.5">{code.note || 'Mã thử nghiệm'}</div>
                  </div>

                  <div className="text-right">
                    <div className="tabular-nums font-semibold text-slate-800">
                      {code.used_count} / {code.max_uses} gia đình
                    </div>
                    <div className="text-[11px] text-emerald-800">Quota: {code.quota_per_family} giấy/tháng</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: AUDIT LOGS TIMELINE */}
      {adminTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Nhật ký kiểm toán hệ thống (Audit Logs)</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Tất cả thao tác quản trị, xóa dữ liệu và thay đổi quota đều được ghi nhận minh bạch
              </p>
            </div>
            <span className="text-xs text-slate-400">Không lưu nội dung tài liệu</span>
          </div>

          <div className="space-y-3">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                <div className="flex items-center justify-between text-slate-500 mb-1">
                  <span className="font-mono font-semibold text-slate-800">{log.action}</span>
                  <span className="tabular-nums">{new Date(log.timestamp).toLocaleString('vi-VN')}</span>
                </div>
                <p className="text-slate-700 leading-relaxed">{log.details}</p>
                <div className="text-[10px] text-slate-400 mt-1">Admin ID: {log.admin_id}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
