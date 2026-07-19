import { useState } from "react";
import type { EndingMode, Mode, SectionType } from "../engine/types.js";
import { parseForm } from "../engine/structure.js";
import { METERS } from "../engine/meter.js";
import { dialects, dialectList, shortName } from "../dialects/index.js";
import {
  STANDARD_FORMS,
  loadCustomForms,
  saveCustomForms,
  validateForm,
} from "./formPresets.js";

export interface Settings {
  dialectId: string;
  keyName: string;
  bpm: number;
  mode?: Mode;
  seed: number;
  meterName: string;
  form: string;
  /** 合作モード (§4.2): 構成の各セクションに割り当てるダイアレクト id。"" はメイン */
  sectionDialects: string[];
  /** 終わり方 (§4.2): final = 終止+コーダ、loop = リピート用の半終止 */
  ending: EndingMode;
}

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const SECTION_LABELS: Record<SectionType, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

/** 左ペインの設定パネル (§5)。 */
export function SettingsPanel({
  settings,
  onChange,
  onManageDialects,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  onManageDialects?: () => void;
}) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  const [customForms, setCustomForms] = useState<string[]>(() => loadCustomForms());
  const [draftForm, setDraftForm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const formSections = parseForm(settings.form);
  const isCustomSelected = customForms.includes(settings.form);

  const selectForm = (value: string) => {
    onChange({
      ...settings,
      form: value,
      sectionDialects: parseForm(value).map(() => ""),
    });
  };

  const addCustomForm = () => {
    const normalized = validateForm(draftForm);
    if (!normalized) {
      setFormError("形式が不正です (例: i,v,c,b,c,o)");
      return;
    }
    setFormError(null);
    setDraftForm("");
    if (!customForms.includes(normalized)) {
      const next = [...customForms, normalized];
      setCustomForms(next);
      saveCustomForms(next);
    }
    selectForm(normalized);
  };

  const removeCustomForm = (value: string) => {
    const next = customForms.filter((f) => f !== value);
    setCustomForms(next);
    saveCustomForms(next);
    if (settings.form === value) selectForm(STANDARD_FORMS[0]!.value);
  };

  return (
    <aside className="settings">
      <div className="panel-heading">
        <strong>曲の土台</strong>
        <span className="change-badge rebuild">全体生成で反映</span>
        <button type="button" onClick={() => {
          const dialect = dialects[settings.dialectId];
          if (!dialect) return;
          onChange({
            ...settings,
            keyName: dialect.defaults.key,
            bpm: dialect.defaults.bpm,
            mode: dialect.defaults.mode,
            meterName: dialect.defaults.meter ?? "4/4",
          });
        }}>推奨値へ戻す</button>
      </div>
      <div className="settings-field" title="ダイアレクト変更は次の全体生成でノートとコードへ反映されます">
        <span className="settings-field-heading">
          <span>ダイアレクト</span>
          {onManageDialects && <button type="button" className="link" onClick={onManageDialects}>管理</button>}
        </span>
        <select
          aria-label="ダイアレクト"
          value={settings.dialectId}
          onChange={(e) => {
            const d = dialects[e.target.value];
            onChange({
              ...settings,
              dialectId: e.target.value,
              ...(d
                ? {
                    keyName: d.defaults.key,
                    bpm: d.defaults.bpm,
                    mode: d.defaults.mode,
                    meterName: d.defaults.meter ?? "4/4",
                  }
                : {}),
            });
          }}
        >
          {dialectList.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <label title="次の全体生成で調と全ノートを再構築します">
        キー
        <select value={settings.keyName} onChange={(e) => set("keyName", e.target.value)}>
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label title="次の全体生成で長調・短調の和声と旋律を再構築します">
        調性
        <select
          value={settings.mode}
          onChange={(e) => set("mode", e.target.value as Mode)}
        >
          <option value="major">メジャー</option>
          <option value="minor">マイナー</option>
        </select>
      </label>

      <label title="次の全体生成で小節の拍数を変更します">
        拍子
        <select value={settings.meterName} onChange={(e) => set("meterName", e.target.value)}>
          {Object.keys(METERS).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label title="次の全体生成でテンポを反映します。セクション別BPMは構成バーで変更できます">
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
        <select value={settings.form} onChange={(e) => selectForm(e.target.value)}>
          <optgroup label="標準">
            {STANDARD_FORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </optgroup>
          {customForms.length > 0 && (
            <optgroup label="カスタム">
              {customForms.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <div className="custom-form">
        <span className="custom-form-title">カスタム構成を追加</span>
        <div className="seed-row">
          <input
            type="text"
            placeholder="例: i,v,c,b,c,o"
            value={draftForm}
            onChange={(e) => setDraftForm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCustomForm();
            }}
          />
          <button type="button" onClick={addCustomForm}>
            追加
          </button>
        </div>
        {formError && <span className="form-error">{formError}</span>}
        {isCustomSelected && (
          <button
            type="button"
            className="link"
            onClick={() => removeCustomForm(settings.form)}
          >
            選択中のカスタム構成を削除
          </button>
        )}
      </div>

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

      <label className="ending-toggle">
        <input
          type="checkbox"
          checked={settings.ending === "loop"}
          onChange={(e) => set("ending", e.target.checked ? "loop" : "final")}
        />
        ループモード (終止せず曲頭へ戻る。再生もリピート)
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
