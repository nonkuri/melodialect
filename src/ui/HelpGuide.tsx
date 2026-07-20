export function HelpGuide({
  onboarding = false,
  onClose,
  onStartSample,
}: {
  onboarding?: boolean;
  onClose: () => void;
  onStartSample?: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal help-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-guide-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="help-guide-title">{onboarding ? "最初の1曲" : "Melodialect の使い方"}</h2>
            <p>生成結果を安全に試し、比較してから保存できます。</p>
          </div>
          <button onClick={onClose} aria-label="閉じる">×</button>
        </header>
        <ol className="guide-steps">
          <li><strong>曲の土台を選ぶ</strong><span>左側でダイアレクト、キー、構成を選び「全体生成」。</span></li>
          <li><strong>編曲を試す</strong><span>伴奏・作曲パラメーターは下書きです。「適用」するまで曲を上書きしません。</span></li>
          <li><strong>A/Bで聴き比べる</strong><span>適用前と適用後を同じ再生位置から切り替えられます。</span></li>
          <li><strong>まとめて直す</strong><span>ピアノロールで範囲選択し、移調・クオンタイズ・コピーを使います。</span></li>
          <li><strong>退避して書き出す</strong><span>プロジェクト一覧で保存世代を確認し、MIDI・WAV・MusicXMLへ出力します。</span></li>
        </ol>
        <div className="help-legend">
          <span><b className="change-badge rebuild">再構築</b> ノートやコードが変わる設定</span>
          <span><b className="change-badge audio-only">音のみ</b> 生成済みノートを変えない設定</span>
        </div>
        <p className="privacy-note">
          楽曲・設定・取り込んだSF2は端末内だけで処理され、Melodialectのサーバーへ送信されません。
        </p>
        <p className="privacy-note">
          アプリ本体のキャッシュ、プロジェクト、ユーザー音源は別データです。更新やアプリキャッシュ修復では作品と音源を削除しません。ブラウザの「サイトデータを削除」はすべて消去するため、先にプロジェクト一覧から全曲バックアップを保存してください。
        </p>
        <footer>
          <a href="./docs/USER_GUIDE.md" target="_blank" rel="noreferrer">詳しいユーザーガイド</a>
          {onboarding && onStartSample && <button type="button" onClick={onStartSample}>サンプル曲を開く</button>}
          <button className="primary" onClick={onClose}>はじめる</button>
        </footer>
      </section>
    </div>
  );
}
