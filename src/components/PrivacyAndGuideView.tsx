import React, { useState } from 'react';
import { AlertTriangle, Camera, Database, Eye, FlaskConical, Globe, LucideIcon, MessageCircle, ShieldCheck, Timer } from 'lucide-react';

/**
 * Public privacy & terms page (linked from the bot's welcome message, no login).
 * Written for families: plain language, describes what the app actually does — no operator/infra details.
 */
const UPDATED = '19/11/2026';

const Section: React.FC<{ icon: LucideIcon; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <section className="rounded-card border border-line bg-surface p-4">
    <h2 className="flex items-center gap-2.5 text-headline font-semibold">
      <span className="flex h-8 w-8 items-center justify-center rounded-control bg-sunken text-ink-2"><Icon className="h-[18px] w-[18px]" /></span>
      {title}
    </h2>
    <div className="mt-3 space-y-2 text-subhead text-ink-2 [&_b]:font-semibold [&_b]:text-ink">{children}</div>
  </section>
);

const Vi: React.FC = () => (
  <>
    <Section icon={Camera} title="Ảnh giấy tờ">
      <p>Ảnh bạn gửi chỉ được dùng để đọc nội dung và <b>không được lưu lại</b>. Sau khi đọc xong (vài chục giây), ảnh bị bỏ khỏi bộ nhớ máy chủ.</p>
      <p>Khi dùng “Chỉ dịch”, ảnh được giữ tạm tối đa 10 phút (chỉ trong bộ nhớ) để bạn bấm “Đọc &amp; thêm lịch” mà không phải gửi lại.</p>
    </Section>

    <Section icon={MessageCircle} title="Tin nhắn trong nhóm">
      <p>Bot chỉ phân tích tin nhắn khi bạn <b>tag tên bot</b> (hoặc nhắn riêng với bot). Để hiểu ngữ cảnh, bot giữ tạm <b>khoảng 10 tin gần nhất</b> của nhóm trong bộ nhớ (không ghi xuống ổ đĩa, tự mất sau 24 giờ hoặc khi máy chủ khởi động lại).</p>
      <p>Khi được tag, các tin đó được gửi cho AI <b>không kèm tên hay tài khoản LINE</b> (chỉ ghi “Người A”, “Người B”…). Chỉ những mục bạn bấm <b>Thêm vào lịch</b> mới được lưu.</p>
    </Section>

    <Section icon={Database} title="Thông tin được lưu">
      <ul className="list-disc pl-5 space-y-1">
        <li>Nội dung đã đọc: tóm tắt, việc cần làm, hạn, sự kiện, đồ cần chuẩn bị.</li>
        <li>Mã nhóm LINE và mã người dùng LINE của thành viên đã nhắn trong nhóm — để chỉ người trong nhóm mới xem được trang gia đình.</li>
        <li>Đánh giá 👍/👎 và số giấy đã dùng trong tháng.</li>
        <li>Chỉ khi bạn tự điền ở tab “Chính sách”: loại visa, ngày hết hạn visa, nơi ở, có con nhỏ hay không — dùng để chọn tin phù hợp và nhắc hạn. Chỉ bạn xem được, không hiện trong nhóm. Xóa bất cứ lúc nào ngay trong tab đó.</li>
      </ul>
      <p><b>Bản dịch</b> (“Chỉ dịch”) <b>không được lưu</b>.</p>
      <p>Nội dung tin nhắn trong nhóm <b>không được lưu</b>, trừ các mục lịch bạn đã xác nhận.</p>
      <p>Không thu thập tên thật, số điện thoại, địa chỉ hay danh bạ.</p>
    </Section>

    <Section icon={Timer} title="Thời gian lưu & cách xóa">
      <ul className="list-disc pl-5 space-y-1">
        <li>Nội dung đã đọc <b>tự xóa sau 90 ngày</b>.</li>
        <li>Gõ <b>xóa dữ liệu</b> trong LINE (hoặc Cài đặt → Xóa toàn bộ dữ liệu) để xóa ngay mọi thứ của gia đình. Link lịch cũ cũng ngừng hoạt động.</li>
        <li>Nếu xóa bot khỏi nhóm, dữ liệu của nhóm bị xóa sau 7 ngày (thêm lại trong 7 ngày thì vẫn giữ).</li>
      </ul>
    </Section>

    <Section icon={Eye} title="Ai xem được">
      <ul className="list-disc pl-5 space-y-1">
        <li>Thành viên trong nhóm LINE của gia đình.</li>
        <li><b>Link lịch</b>: ai có link đều xem được lịch, nên đừng chia sẻ ra ngoài. Lỡ lộ thì vào app → Lịch → “Đổi link lịch”.</li>
        <li>Người vận hành bản thử nghiệm chỉ thấy <b>số liệu tổng</b> (số giấy, loại giấy, chi phí, 👍/👎), <b>không xem được nội dung</b> giấy tờ hay lịch của gia đình.</li>
      </ul>
    </Section>

    <Section icon={Globe} title="Dữ liệu được xử lý ở đâu">
      <ul className="list-disc pl-5 space-y-1">
        <li><b>Google Cloud tại Tokyo (Nhật Bản)</b>: máy chủ và nơi lưu nội dung đã đọc.</li>
        <li><b>Anthropic (Mỹ)</b>: AI Claude đọc ảnh và dịch. Dữ liệu gửi qua API không được dùng để huấn luyện AI; Anthropic có thể lưu tạm theo chính sách của họ để chống lạm dụng.</li>
        <li><b>LINE</b>: tin nhắn và ảnh đi qua LINE như mọi cuộc trò chuyện khác.</li>
      </ul>
    </Section>

    <Section icon={AlertTriangle} title="Lưu ý khi dùng">
      <ul className="list-disc pl-5 space-y-1">
        <li>AI có thể đọc sai, nhất là ngày tháng, ảnh mờ hoặc chữ viết tay. <b>Luôn đối chiếu với giấy gốc</b> trước khi nộp tiền, nộp giấy hay đi khám.</li>
        <li>Giấy y tế, thuế, pháp lý: bot chỉ giải thích nội dung, không phải lời khuyên chuyên môn. Hãy hỏi trực tiếp nơi phát hành.</li>
        <li>Ngày có dấu <b>(?)</b> là ngày bot không chắc chắn.</li>
      </ul>
    </Section>

    <Section icon={FlaskConical} title="Bản thử nghiệm (Beta)">
      <p>Miễn phí trong thời gian thử nghiệm, giới hạn số gia đình và số giấy mỗi tháng. Tính năng có thể thay đổi hoặc tạm dừng. Mọi góp ý xin gửi cho người đã mời bạn tham gia.</p>
    </Section>
  </>
);

const Ja: React.FC = () => (
  <>
    <Section icon={Camera} title="画像について">
      <p>送信された画像は内容の読み取りにのみ使用し、<b>保存しません</b>。「翻訳のみ」では、再送不要で読み取りに切り替えられるよう最大10分間メモリ上に一時保持します。</p>
    </Section>
    <Section icon={MessageCircle} title="グループのメッセージ">
      <p>ボットがメッセージを解析するのは、ボットをメンション（タグ）した時、または1対1のトークのみです。文脈把握のため、直近約10件をメモリ上に一時保持します（ディスクには保存せず、24時間で消去）。AIには名前やLINEアカウントを含めずに送信し、「カレンダーに追加」を押した項目のみ保存します。</p>
    </Section>
    <Section icon={Database} title="保存する情報と期間">
      <p>読み取り結果（要約・やること・期限・予定）、LINEのグループID・ユーザーID、評価（👍/👎）、月間利用数を保存します。翻訳結果は保存しません。</p>
      <p>読み取り結果は<b>90日後に自動削除</b>されます。LINEで「xóa dữ liệu」と送るか、設定画面から即時に全削除できます。ボットをグループから削除した場合、7日後に削除されます。</p>
    </Section>
    <Section icon={Eye} title="閲覧できる人">
      <p>LINEグループのメンバーのみ。カレンダーのリンクを知っている人は予定を閲覧できるため、共有しないでください。運営者は件数などの統計のみ確認でき、内容は閲覧できません。</p>
    </Section>
    <Section icon={Globe} title="処理場所（越境移転）">
      <p>Google Cloud（東京）でサーバー処理・保存を行い、画像の読み取りと翻訳には Anthropic社（米国）の Claude API を使用します。API経由のデータはAIの学習に使用されません。</p>
    </Section>
    <Section icon={AlertTriangle} title="ご注意">
      <p>AIは誤読することがあります。提出・支払い・受診の前に必ず原本をご確認ください。医療・税務・法律に関する助言ではありません。</p>
    </Section>
  </>
);

export const PrivacyAndGuideView: React.FC = () => {
  const [lang, setLang] = useState<'vi' | 'ja'>('vi');
  return (
    <div className="mx-auto max-w-md space-y-3 px-4 py-6">
      <header className="px-1 pb-1">
        <h1 className="text-display font-bold tracking-tight">Quyền riêng tư</h1>
        <p className="mt-1 text-footnote text-ink-2">Trợ lý giấy tờ Nhật · bản Beta · cập nhật {UPDATED}</p>
        <div className="mt-4 inline-flex rounded-control bg-line/60 p-0.5" role="tablist">
          {(['vi', 'ja'] as const).map((l) => (
            <button
              key={l}
              role="tab"
              aria-selected={lang === l}
              onClick={() => setLang(l)}
              className={`h-9 rounded-[8px] px-4 text-footnote font-semibold ${lang === l ? 'bg-surface text-ink shadow-sm' : 'text-ink-2'}`}
            >
              {l === 'vi' ? 'Tiếng Việt' : '日本語'}
            </button>
          ))}
        </div>
      </header>

      <div className="flex gap-3 rounded-card bg-brand-50 p-4 text-subhead text-brand-700">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          {lang === 'vi'
            ? <><b>Không lưu ảnh</b> · nội dung <b>tự xóa sau 90 ngày</b> · <b>xóa ngay</b> bất cứ lúc nào bằng “xóa dữ liệu” · người vận hành <b>không xem được</b> nội dung giấy tờ.</>
            : <><b>画像は保存しません</b>・内容は<b>90日で自動削除</b>・いつでも<b>即時削除</b>可能・運営者は内容を<b>閲覧できません</b>。</>}
        </p>
      </div>

      {lang === 'vi' ? <Vi /> : <Ja />}
    </div>
  );
};
