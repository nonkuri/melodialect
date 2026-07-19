import { useMemo, useState } from "react";
import type {
  ArrangementSettings,
  CompositionControls,
  MasterSettings,
  MixerSettings,
  SongPart,
} from "../engine/types.js";

export interface LevelValue {
  peak: number;
  rms: number;
}

export interface MixerLevels {
  master: LevelValue;
  parts: Record<SongPart, LevelValue>;
  clipping: boolean;
}

interface Props {
  arrangement: ArrangementSettings;
  mixer: MixerSettings;
  master: MasterSettings;
  composition: CompositionControls;
  dirty: boolean;
  canCompare: boolean;
  comparisonSide: "before" | "after";
  levels?: MixerLevels;
  onArrangementChange: (value: ArrangementSettings) => void;
  onMixerChange: (value: MixerSettings, commit?: boolean) => void;
  onMasterChange: (value: MasterSettings, commit?: boolean) => void;
  onMixerPresetLoad: (mixer: MixerSettings, master: MasterSettings) => void;
  onCompositionChange: (value: CompositionControls) => void;
  onApply: () => void;
  onCancel: () => void;
  onReset: () => void;
  onCompare: () => void;
  onOpenSoundFonts: () => void;
}

const PARTS: Array<{ id: SongPart; label: string; timbres: Array<[string, string]> }> = [
  { id: "melody", label: "メロディ", timbres: [["flute", "フルート"], ["sine", "ソフト"], ["lead", "リード"]] },
  { id: "piano", label: "ピアノ", timbres: [["grand", "グランド"], ["electric", "エレピ"], ["organ", "オルガン"]] },
  { id: "guitar", label: "ギター", timbres: [["nylon", "ナイロン"], ["bright", "ブライト"]] },
  { id: "bass", label: "ベース", timbres: [["fingered", "フィンガー"], ["synthbass", "シンセ"]] },
  { id: "drums", label: "ドラム", timbres: [["electronic", "電子"], ["bright", "ブライト"]] },
];

const HELP: Partial<Record<keyof CompositionControls, string>> = {
  density: "メロディの音数。低くすると間が増え、高くすると音を分割します。",
  harmonyComplexity: "コード数、拡張和音、定型句の複雑さ。",
  tension: "借用和音や意外な進行へ向かう強さ。",
  leap: "旋律が隣接音ではなく跳躍する頻度。",
  repetition: "同音やモチーフを再利用する強さ。",
  syncopation: "音の開始を拍の裏へずらす強さ。",
  brightness: "メロディの音量感と明るい方向の傾向。",
  calm: "跳躍とアクセントを抑える度合い。",
  surprise: "変則構成や転調を選ぶ度合い。",
};

function RangeRow(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  onCommit?: () => void;
}) {
  const { label, value, min = 0, max = 1, step = 0.05, help, format, onChange, onCommit } = props;
  return (
    <label className="control-range" title={help}>
      <span>{label}{help && <button type="button" className="help-dot" aria-label={`${label}の説明`}>?</button>}<output>{format ? format(value) : Math.round(value * 100)}</output></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </label>
  );
}

function Meter({ value, warning = false }: { value: LevelValue; warning?: boolean }) {
  const peak = Math.max(0, Math.min(1, value.peak));
  const rms = Math.max(0, Math.min(1, value.rms));
  return (
    <span className={`level-meter${warning ? " clipping" : ""}`} title={`Peak ${(peak * 100).toFixed(0)}% / RMS ${(rms * 100).toFixed(0)}%`}>
      <i className="rms" style={{ width: `${rms * 100}%` }} />
      <i className="peak" style={{ left: `${peak * 100}%` }} />
    </span>
  );
}

interface StoredMixerPreset {
  name: string;
  mixer: MixerSettings;
  master: MasterSettings;
}

const MIXER_PRESETS_KEY = "melodialect.mixerPresets";

function loadMixerPresets(): StoredMixerPreset[] {
  try {
    const value = JSON.parse(localStorage.getItem(MIXER_PRESETS_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value as StoredMixerPreset[] : [];
  } catch {
    return [];
  }
}

export function ArrangementPanel(props: Props) {
  const {
    arrangement,
    mixer,
    master,
    composition,
    dirty,
    canCompare,
    comparisonSide,
    levels,
    onArrangementChange,
    onMixerChange,
    onMasterChange,
    onCompositionChange,
  } = props;
  const [presets, setPresets] = useState<StoredMixerPreset[]>(loadMixerPresets);
  const emptyLevels = useMemo(() => ({ peak: 0, rms: 0 }), []);
  const updateArrangement = <K extends keyof ArrangementSettings>(key: K, value: ArrangementSettings[K]) =>
    onArrangementChange({ ...arrangement, [key]: value });
  const updateComposition = <K extends keyof CompositionControls>(key: K, value: CompositionControls[K]) =>
    onCompositionChange({ ...composition, [key]: value });

  const savePreset = () => {
    const name = window.prompt("ミキサープリセット名", `ミックス ${presets.length + 1}`);
    if (!name) return;
    const next = [{ name, mixer: structuredClone(mixer), master: { ...master } }, ...presets].slice(0, 20);
    localStorage.setItem(MIXER_PRESETS_KEY, JSON.stringify(next));
    setPresets(next);
  };

  return (
    <aside className="p1-controls">
      <div className="parameter-staging">
        <span className="change-badge rebuild">再構築</span>
        <strong>編集中の値</strong>
        <span>{dirty ? "未適用の変更があります" : "適用済みと一致"}</span>
        <button className="primary" disabled={!dirty} onClick={props.onApply}>適用</button>
        <button disabled={!dirty} onClick={props.onCancel}>キャンセル</button>
        <button title="ダイアレクト推奨値へ戻す" onClick={props.onReset}>推奨値に戻す</button>
        <button disabled={!canCompare} className={comparisonSide === "before" ? "active" : ""} onClick={props.onCompare}>
          A/B: {comparisonSide === "before" ? "変更前" : "変更後"}
        </button>
      </div>

      <div className="parameter-sections">
        <details open>
        <summary>伴奏アレンジ <span className="change-badge rebuild">再構築</span></summary>
        <div className="control-grid pattern-grid">
          <label title="伴奏ノートを作り直します">ピアノ<select value={arrangement.pianoPattern} onChange={(event) =>
            updateArrangement("pianoPattern", event.target.value as ArrangementSettings["pianoPattern"])}>
            <option value="block">ブロック</option><option value="arpeggio">アルペジオ</option>
            <option value="eighth">8分刻み</option><option value="ballad">バラード</option>
            <option value="syncopated">シンコペーション</option><option value="voice-led">声部連結</option>
          </select></label>
          <label title="伴奏ノートを作り直します">ギター<select value={arrangement.guitarPattern} onChange={(event) =>
            updateArrangement("guitarPattern", event.target.value as ArrangementSettings["guitarPattern"])}>
            <option value="off">なし</option><option value="strum">ストラム</option>
            <option value="arpeggio">アルペジオ</option><option value="syncopated">シンコペーション</option>
            <option value="interlocking">インターロック</option>
          </select></label>
          <label title="伴奏ノートを作り直します">ドラム<select value={arrangement.drumPattern} onChange={(event) =>
            updateArrangement("drumPattern", event.target.value as ArrangementSettings["drumPattern"])}>
            <option value="off">なし</option><option value="basic">ベーシック</option>
            <option value="rock">ロック</option><option value="bossa">ボサ</option>
            <option value="shuffle">シャッフル</option><option value="interlock">インターロック</option>
          </select></label>
        </div>
        <div className="control-grid">
          <RangeRow label="スウィング" help="裏拍を遅らせて跳ねる感じにします。" value={arrangement.swing} onChange={(value) => updateArrangement("swing", value)} />
          <RangeRow label="ヒューマナイズ" help="タイミングと強弱へ決定的な揺らぎを加えます。" value={arrangement.humanize} onChange={(value) => updateArrangement("humanize", value)} />
          <RangeRow label="ベロシティ" help="伴奏ノートの強さをまとめて調整します。" value={arrangement.velocityScale} min={0.5} max={1.5}
            format={(value) => value.toFixed(2)} onChange={(value) => updateArrangement("velocityScale", value)} />
        </div>
        </details>

        <details open>
        <summary>ミキサーと音色 <span className="change-badge audio-only">音のみ</span></summary>
        <div className="master-strip">
          <strong>MASTER</strong>
          <RangeRow
            label="音量"
            value={master.volume}
            min={0}
            max={1.5}
            step={0.01}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(volume) => onMasterChange({ ...master, volume }, false)}
            onCommit={() => onMasterChange(master, true)}
          />
          <Meter value={levels?.master ?? emptyLevels} warning={levels?.clipping} />
          <label><input type="checkbox" checked={master.limiter} onChange={(event) =>
            onMasterChange({ ...master, limiter: event.target.checked }, true)} />ピーク保護</label>
          {levels?.clipping && <span className="clip-warning" role="alert">CLIP</span>}
        </div>
        <div className="mixer-presets">
          <button onClick={savePreset}>現在のミックスを保存</button>
          <select value="" onChange={(event) => {
            const preset = presets[Number(event.target.value)];
            if (preset) {
              props.onMixerPresetLoad(
                structuredClone(preset.mixer),
                { ...preset.master },
              );
            }
          }}>
            <option value="">プリセットを読込…</option>
            {presets.map((preset, index) => <option value={index} key={`${preset.name}-${index}`}>{preset.name}</option>)}
          </select>
          <button onClick={props.onOpenSoundFonts}>音源を追加 / 管理</button>
        </div>
        <div className="mixer-table">
          {PARTS.map(({ id, label, timbres }) => {
            const part = mixer[id];
            return (
              <div className="mixer-row" key={id}>
                <strong>{label}</strong>
                <button className={part.mute ? "active" : ""} title="ミュート"
                  onClick={() => onMixerChange({ ...mixer, [id]: { ...part, mute: !part.mute } }, true)}>M</button>
                <button className={part.solo ? "active" : ""} title="ソロ"
                  onClick={() => onMixerChange({ ...mixer, [id]: { ...part, solo: !part.solo } }, true)}>S</button>
                <label>Vol<input type="range" min="0" max="1.5" step="0.01" value={part.volume}
                  onChange={(event) => onMixerChange({ ...mixer, [id]: { ...part, volume: Number(event.target.value) } }, false)}
                  onPointerUp={() => onMixerChange(mixer, true)} /></label>
                <label>Pan<input type="range" min="-1" max="1" step="0.05" value={part.pan}
                  onChange={(event) => onMixerChange({ ...mixer, [id]: { ...part, pan: Number(event.target.value) } }, false)}
                  onPointerUp={() => onMixerChange(mixer, true)} /></label>
                <select aria-label={`${label}の内蔵音色`} value={part.timbre} onChange={(event) =>
                  onMixerChange({ ...mixer, [id]: { ...part, timbre: event.target.value, soundfont: undefined } }, true)}>
                  {timbres.map(([value, name]) => <option value={value} key={value}>{name}</option>)}
                </select>
                <button className="soundfont-assignment" onClick={props.onOpenSoundFonts} title="SoundFontプリセットを変更">
                  {part.soundfont?.presetName ?? "内蔵オシレーター"}
                </button>
                <Meter value={levels?.parts[id] ?? emptyLevels} />
              </div>
            );
          })}
        </div>
        </details>

        <details>
        <summary>作曲パラメータ <span className="change-badge rebuild">再構築</span></summary>
        <div className="range-pair">
          <label title="メロディを再構築します">最低音<input type="number" min="36" max={composition.melodyHigh - 1} value={composition.melodyLow}
            onChange={(event) => updateComposition("melodyLow", Number(event.target.value))} /></label>
          <label title="メロディを再構築します">最高音<input type="number" min={composition.melodyLow + 1} max="96" value={composition.melodyHigh}
            onChange={(event) => updateComposition("melodyHigh", Number(event.target.value))} /></label>
        </div>
        <div className="control-grid composition-grid">
          {([
            ["density", "音数密度"], ["harmonyComplexity", "和声複雑度"], ["tension", "緊張度"],
            ["leap", "跳躍"], ["repetition", "反復"], ["syncopation", "シンコペーション"],
            ["brightness", "明るさ"], ["calm", "穏やかさ"], ["surprise", "意外性"],
          ] as Array<[keyof CompositionControls, string]>).map(([key, label]) => (
            <RangeRow key={key} label={label} help={HELP[key]} value={composition[key] as number}
              onChange={(value) => updateComposition(key, value as never)} />
          ))}
        </div>
        </details>
      </div>
    </aside>
  );
}
