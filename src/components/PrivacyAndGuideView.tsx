import React, { useState } from 'react';

/**
 * Public privacy & terms page (linked from the bot's welcome message, no login).
 * Written for families: plain language, describes what the app actually does — no operator/infra details.
 */
const UPDATED = '28/10/2026';

const Section: React.FC<{ icon: string; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <section className="bg-white rounded-2xl border border-slate-200 p-5">
    <h2 className="text-[17px] font-bold text-slate-900 flex items-center gap-2">
      <span className="text-xl">{icon}</span>
      {title}
    </h2>
    <div className="mt-3 text-[15px] leading-relaxed text-slate-700 space-y-2">{children}</div>
  </section>
);

const Vi: React.FC = () => (
  <>
    <Section icon="📸" title="Ảnh giấy tờ">
      <p>Ảnh bạn gửi chỉ được dùng để đọc nội dung và <b>không được lưu lại</b>. Sau khi đọc xong (vài chục giây), ảnh bị bỏ khỏi bộ nhớ máy chủ.</p>
      <p>Khi dùng “Chỉ dịch”, ảnh được giữ tạm tối đa 10 phút (chỉ trong bộ nhớ) để bạn bấm “Đọc &amp; thêm lịch” mà không phải gửi lại.</p>
    </Section>

    <Section icon="🗂️" title="Thông tin được lưu">
      <ul className="list-disc pl-5 space-y-1">
        <li>Nội dung đã đọc: tóm tắt, việc cần làm, hạn, sự kiện, đồ cần chuẩn bị.</li>
        <li>Mã nhóm LINE và mã người dùng LINE của thành viên đã nhắn trong nhóm — để chỉ người trong nhóm mới xem được trang gia đình.</li>
        <li>Đánh giá 👍/👎 và số giấy đã dùng trong tháng.</li>
        <li>Nếu bạn đặt <b>khu vực</b> để tra rác: chỉ <b>tên thành phố và khu (町丁目)</b>. Tọa độ và số nhà <b>không được lưu</b> (vị trí LINE chỉ dùng để đọc tên thành phố rồi bỏ).</li>
      </ul>
      <p><b>Bản dịch</b> (“Chỉ dịch”) <b>không được lưu</b>.</p>
      <p>Không thu thập tên thật, số điện thoại, địa chỉ nhà hay danh bạ. Câu hỏi phân loại rác (ảnh/tên món) không gắn với tên bạn; món chưa có trong dữ liệu chỉ được ghi lại bằng tên món và thành phố.</p>
    </Section>

    <Section icon="⏳" title="Thời gian lưu & cách xóa">
      <ul className="list-disc pl-5 space-y-1">
        <li>Nội dung đã đọc <b>tự xóa sau 90 ngày</b>.</li>
        <li>Gõ <b>xóa dữ liệu</b> trong LINE (hoặc Cài đặt → Xóa toàn bộ dữ liệu) để xóa ngay mọi thứ của gia đình. Link lịch cũ cũng ngừng hoạt động.</li>
        <li>Nếu xóa bot khỏi nhóm, dữ liệu của nhóm bị xóa sau 7 ngày (thêm lại trong 7 ngày thì vẫn giữ).</li>
      </ul>
    </Section>

    <Section icon="👀" title="Ai xem được">
      <ul className="list-disc pl-5 space-y-1">
        <li>Thành viên trong nhóm LINE của gia đình.</li>
        <li><b>Link lịch</b>: ai có link đều xem được lịch, nên đừng chia sẻ ra ngoài. Lỡ lộ thì vào app → Lịch → “Đổi link lịch”.</li>
        <li>Người vận hành bản thử nghiệm chỉ thấy <b>số liệu tổng</b> (số giấy, loại giấy, chi phí, 👍/👎), <b>không xem được nội dung</b> giấy tờ hay lịch của gia đình.</li>
      </ul>
    </Section>

    <Section icon="🌏" title="Dữ liệu được xử lý ở đâu">
      <ul className="list-disc pl-5 space-y-1">
        <li><b>Google Cloud tại Tokyo (Nhật Bản)</b>: máy chủ và nơi lưu nội dung đã đọc.</li>
        <li><b>Anthropic (Mỹ)</b>: AI Claude đọc ảnh và dịch. Dữ liệu gửi qua API không được dùng để huấn luyện AI; Anthropic có thể lưu tạm theo chính sách của họ để chống lạm dụng.</li>
        <li><b>LINE</b>: tin nhắn và ảnh đi qua LINE như mọi cuộc trò chuyện khác.</li>
      </ul>
    </Section>

    <Section icon="⚠️" title="Lưu ý khi dùng">
      <ul className="list-disc pl-5 space-y-1">
        <li>AI có thể đọc sai, nhất là ngày tháng, ảnh mờ hoặc chữ viết tay. <b>Luôn đối chiếu với giấy gốc</b> trước khi nộp tiền, nộp giấy hay đi khám.</li>
        <li>Giấy y tế, thuế, pháp lý: bot chỉ giải thích nội dung, không phải lời khuyên chuyên môn. Hãy hỏi trực tiếp nơi phát hành.</li>
        <li>Ngày có dấu <b>(?)</b> là ngày bot không chắc chắn.</li>
      </ul>
    </Section>

    <Section icon="🧪" title="Bản thử nghiệm (Beta)">
      <p>Miễn phí trong thời gian thử nghiệm, giới hạn số gia đình và số giấy mỗi tháng. Tính năng có thể thay đổi hoặc tạm dừng. Mọi góp ý xin gửi cho người đã mời bạn tham gia.</p>
    </Section>
  </>
);

const Ja: React.FC = () => (
  <>
    <Section icon="📸" title="画像について">
      <p>送信された画像は内容の読み取りにのみ使用し、<b>保存しません</b>。「翻訳のみ」では、再送不要で読み取りに切り替えられるよう最大10分間メモリ上に一時保持します。</p>
    </Section>
    <Section icon="🗂️" title="保存する情報と期間">
      <p>読み取り結果（要約・やること・期限・予定）、LINEのグループID・ユーザーID、評価（👍/👎）、月間利用数を保存します。翻訳結果は保存しません。</p>
      <p>読み取り結果は<b>90日後に自動削除</b>されます。LINEで「xóa dữ liệu」と送るか、設定画面から即時に全削除できます。ボットをグループから削除した場合、7日後に削除されます。</p>
    </Section>
    <Section icon="👀" title="閲覧できる人">
      <p>LINEグループのメンバーのみ。カレンダーのリンクを知っている人は予定を閲覧できるため、共有しないでください。運営者は件数などの統計のみ確認でき、内容は閲覧できません。</p>
    </Section>
    <Section icon="🌏" title="処理場所（越境移転）">
      <p>Google Cloud（東京）でサーバー処理・保存を行い、画像の読み取りと翻訳には Anthropic社（米国）の Claude API を使用します。API経由のデータはAIの学習に使用されません。</p>
    </Section>
    <Section icon="⚠️" title="ご注意">
      <p>AIは誤読することがあります。提出・支払い・受診の前に必ず原本をご確認ください。医療・税務・法律に関する助言ではありません。</p>
    </Section>
  </>
);

export const PrivacyAndGuideView: React.FC = () => {
  const [lang, setLang] = useState<'vi' | 'ja'>('vi');
  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-4">
      <header className="px-1">
        <h1 className="text-[22px] font-bold text-slate-900">🔒 Quyền riêng tư</h1>
        <p className="text-[14px] text-slate-500 mt-1">Trợ lý giấy tờ Nhật · bản Beta · cập nhật {UPDATED}</p>
        <div className="mt-3 inline-flex p-1 bg-slate-100 rounded-xl text-[14px]">
          {(['vi', 'ja'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`px-4 h-9 rounded-lg font-semibold ${lang === l ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              {l === 'vi' ? 'Tiếng Việt' : '日本語'}
            </button>
          ))}
        </div>
      </header>

      <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-[15px] text-emerald-900 leading-relaxed">
        {lang === 'vi'
          ? <>Tóm tắt: <b>không lưu ảnh</b> · nội dung <b>tự xóa sau 90 ngày</b> · <b>xóa ngay</b> bất cứ lúc nào bằng “xóa dữ liệu” · người vận hành <b>không xem được</b> nội dung giấy tờ.</>
          : <>概要：<b>画像は保存しません</b>・内容は<b>90日で自動削除</b>・いつでも<b>即時削除</b>可能・運営者は内容を<b>閲覧できません</b>。</>}
      </div>

      {lang === 'vi' ? <Vi /> : <Ja />}
    </div>
  );
};
