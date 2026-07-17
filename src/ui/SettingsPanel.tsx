import type { SectionType } from "../engine/types.js";
import { parseForm } from "../engine/structure.js";
import { dialects, dialectList, shortName } from "../dialects/index.js";

export interface Settings {
  dialectId: string;
  keyName: string;
  bpm: number;
  seed: number;
  form: string;
  /** 合作モード (§4.2): 構成の各セクションに割り当てるダイアレクト id。"" はメイン */
  sectionDialects: string[];
}

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const FORM_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Verse-Chorus ×2", value: "v,c,v,c" },
  { label: "V-C-V-C-B-C", value: "v,c,v,c,b,c" },
  { label: "Verse ×2", value: "v,v" },
  { label: "Chorus のみ", value: "c" },
];

const SECTION_LABELS: Record<SectionType, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

/** 左ペインの設定パネル (§5)。 */
export function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
}) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  const formSections = parseForm(settings.form);

  return (
    <aside className="settings">
      <label>
        ダイアレクト
        <select
          value={settings.dialectId}
          onChange={(e) => {
            const d = dialects[e.target.value];
            onChange({
              ...settings,
              dialectId: e.target.value,
              ...(d ? { keyName: d.defaults.key, bpm: d.defaults.bpm } : {}),
            });
          }}
        >
          {dialectList.map((d) => (
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
        <select
          value={settings.form}
          onChange={(e) =>
            onChange({
              ...settings,
              form: e.target.value,
              sectionDialects: parseForm(e.target.value).map(() => ""),
            })
          }
        >
          {FORM_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <div className="cowrite">
        <span className="cowrite-title">セクション別ダイアレクト (合作モード)</span>
        {formSections.map((entry, i) => (
          <label key={i} className="cowrite-row">
            <span>{SECTION_LABELS[entry.type]}</span>
            <select
              value={settings.sectionDialects[i] ?? ""}
              onChange={(e) => {
                const next = formSections.map((_, j) => settings.sectionDialects[j] ?? "");
                next[i] = e.target.value;
                set("sectionDialects", next);
              }}
            >
              <option value="">メインと同じ</option>
              {dialectList.map((d) => (
                <option key={d.id} value={d.id}>
                  {shortName(d)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

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
