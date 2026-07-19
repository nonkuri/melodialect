import type { ArrangementSettings, CompositionControls, MixerSettings, SongPart } from "../engine/types.js";

interface Props {
  arrangement: ArrangementSettings;
  mixer: MixerSettings;
  composition: CompositionControls;
  onArrangementChange: (value: ArrangementSettings) => void;
  onMixerChange: (value: MixerSettings) => void;
  onCompositionChange: (value: CompositionControls) => void;
}

const PARTS: Array<{ id: SongPart; label: string; timbres: Array<[string, string]> }> = [
  { id: "melody", label: "メロディ", timbres: [["flute", "フルート"], ["sine", "ソフト"], ["lead", "リード"]] },
  { id: "piano", label: "ピアノ", timbres: [["grand", "グランド"], ["electric", "エレピ"], ["organ", "オルガン"]] },
  { id: "guitar", label: "ギター", timbres: [["nylon", "ナイロン"], ["bright", "ブライト"]] },
  { id: "bass", label: "ベース", timbres: [["fingered", "フィンガー"], ["synthbass", "シンセ"]] },
  { id: "drums", label: "ドラム", timbres: [["electronic", "電子"], ["bright", "ブライト"]] },
];

function RangeRow(props: {
  label: string; value: number; min?: number; max?: number; step?: number;
  format?: (value: number) => string; onChange: (value: number) => void;
}) {
  const { label, value, min = 0, max = 1, step = 0.05, format, onChange } = props;
  return <label className="control-range">
    <span>{label}<output>{format ? format(value) : Math.round(value * 100)}</output></span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

export function ArrangementPanel(props: Props) {
  const { arrangement, mixer, composition, onArrangementChange, onMixerChange, onCompositionChange } = props;
  const updateArrangement = <K extends keyof ArrangementSettings>(key: K, value: ArrangementSettings[K]) =>
    onArrangementChange({ ...arrangement, [key]: value });
  const updateComposition = <K extends keyof CompositionControls>(key: K, value: CompositionControls[K]) =>
    onCompositionChange({ ...composition, [key]: value });

  return <aside className="p1-controls">
    <details open>
      <summary>伴奏アレンジ</summary>
      <div className="control-grid pattern-grid">
        <label>ピアノ<select value={arrangement.pianoPattern} onChange={(event) =>
          updateArrangement("pianoPattern", event.target.value as ArrangementSettings["pianoPattern"])}>
          <option value="block">ブロック</option><option value="arpeggio">アルペジオ</option>
          <option value="eighth">8分刻み</option><option value="ballad">バラード</option>
        </select></label>
        <label>ギター<select value={arrangement.guitarPattern} onChange={(event) =>
          updateArrangement("guitarPattern", event.target.value as ArrangementSettings["guitarPattern"])}>
          <option value="off">なし</option><option value="strum">ストラム</option>
          <option value="arpeggio">アルペジオ</option><option value="syncopated">シンコペーション</option>
        </select></label>
        <label>ドラム<select value={arrangement.drumPattern} onChange={(event) =>
          updateArrangement("drumPattern", event.target.value as ArrangementSettings["drumPattern"])}>
          <option value="off">なし</option><option value="basic">ベーシック</option>
          <option value="rock">ロック</option><option value="bossa">ボサ</option>
        </select></label>
      </div>
      <div className="control-grid">
        <RangeRow label="スウィング" value={arrangement.swing} onChange={(v) => updateArrangement("swing", v)} />
        <RangeRow label="ヒューマナイズ" value={arrangement.humanize} onChange={(v) => updateArrangement("humanize", v)} />
        <RangeRow label="ベロシティ" value={arrangement.velocityScale} min={0.5} max={1.5}
          format={(v) => v.toFixed(2)} onChange={(v) => updateArrangement("velocityScale", v)} />
      </div>
    </details>

    <details>
      <summary>ミキサーと音色</summary>
      <div className="mixer-table">
        {PARTS.map(({ id, label, timbres }) => {
          const part = mixer[id];
          return <div className="mixer-row" key={id}>
            <strong>{label}</strong>
            <button className={part.mute ? "active" : ""} title="ミュート"
              onClick={() => onMixerChange({ ...mixer, [id]: { ...part, mute: !part.mute } })}>M</button>
            <button className={part.solo ? "active" : ""} title="ソロ"
              onClick={() => onMixerChange({ ...mixer, [id]: { ...part, solo: !part.solo } })}>S</button>
            <label>Vol<input type="range" min="0" max="1.5" step="0.05" value={part.volume}
              onChange={(event) => onMixerChange({ ...mixer, [id]: { ...part, volume: Number(event.target.value) } })} /></label>
            <label>Pan<input type="range" min="-1" max="1" step="0.1" value={part.pan}
              onChange={(event) => onMixerChange({ ...mixer, [id]: { ...part, pan: Number(event.target.value) } })} /></label>
            <select aria-label={label + "の音色"} value={part.timbre} onChange={(event) =>
              onMixerChange({ ...mixer, [id]: { ...part, timbre: event.target.value } })}>
              {timbres.map(([value, name]) => <option value={value} key={value}>{name}</option>)}
            </select>
          </div>;
        })}
      </div>
    </details>

    <details>
      <summary>作曲パラメータ</summary>
      <div className="range-pair">
        <label>最低音<input type="number" min="36" max={composition.melodyHigh - 1} value={composition.melodyLow}
          onChange={(event) => updateComposition("melodyLow", Number(event.target.value))} /></label>
        <label>最高音<input type="number" min={composition.melodyLow + 1} max="96" value={composition.melodyHigh}
          onChange={(event) => updateComposition("melodyHigh", Number(event.target.value))} /></label>
      </div>
      <div className="control-grid composition-grid">
        <RangeRow label="音数密度" value={composition.density} onChange={(v) => updateComposition("density", v)} />
        <RangeRow label="和声複雑度" value={composition.harmonyComplexity} onChange={(v) => updateComposition("harmonyComplexity", v)} />
        <RangeRow label="緊張度" value={composition.tension} onChange={(v) => updateComposition("tension", v)} />
        <RangeRow label="跳躍" value={composition.leap} onChange={(v) => updateComposition("leap", v)} />
        <RangeRow label="反復" value={composition.repetition} onChange={(v) => updateComposition("repetition", v)} />
        <RangeRow label="シンコペーション" value={composition.syncopation} onChange={(v) => updateComposition("syncopation", v)} />
        <RangeRow label="明るさ" value={composition.brightness} onChange={(v) => updateComposition("brightness", v)} />
        <RangeRow label="穏やかさ" value={composition.calm} onChange={(v) => updateComposition("calm", v)} />
        <RangeRow label="意外性" value={composition.surprise} onChange={(v) => updateComposition("surprise", v)} />
      </div>
    </details>
  </aside>;
}
