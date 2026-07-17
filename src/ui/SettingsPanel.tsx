import type { Dialect } from "../engine/types.js";
import { dialects } from "../dialects/index.js";

export interface Settings {
  dialectId: string;
  keyName: string;
  bpm: number;
  seed: number;
  form: string;
}

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const FORM_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Verse-Chorus ×2", value: "v,c,v,c" },
  { label: "V-C-V-C-B-C", value: "v,c,v,c,b,c" },
  { label: "Verse ×2", value: "v,v" },
  { label: "Chorus のみ", value: "c" },
];

/** 左ペインの設定パネル (§5)。 */
export function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
}) {
  const uniqueDialects = Object.values(dialects).filter(
    (d, i, arr) => arr.findIndex((x) => x.id === d.id) === i,
  );
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <aside className="settings">
      <label>
        ダイアレクト
        <select
          value={settings.dialectId}
          onChange={(e) => {
            const d: Dialect | undefined = dialects[e.target.value];
            onChange({
              ...settings,
              dialectId: e.target.value,
              ...(d ? { keyName: d.defaults.key, bpm: d.defaults.bpm } : {}),
            });
          }}
        >
          {uniqueDialects.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        キー
        <select value={settings.keyName} onChange={(e) => set("keyName", e.target.value)}>
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label>
        テンポ (BPM)
        <input
          type="number"
          min={40}
          max={200}
          value={settings.bpm}
          onChange={(e) => set("bpm", Number(e.target.value))}
        />
      </label>

      <label>
        構成
        <select value={settings.form} onChange={(e) => set("form", e.target.value)}>
          {FORM_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        シード
        <div className="seed-row">
          <input
            type="number"
            value={settings.seed}
            onChange={(e) => set("seed", Number(e.target.value))}
          />
          <button
            type="button"
            title="ランダムなシードにする"
            onClick={() => set("seed", Math.floor(Math.random() * 1_000_000))}
          >
            🎲
          </button>
        </div>
      </label>
    </aside>
  );
}
