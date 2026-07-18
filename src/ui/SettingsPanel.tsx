import { useState } from "react";
import type { SectionType } from "../engine/types.js";
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
  seed: number;
  meterName: string;
  form: string;
  /** 合作モード (§4.2): 構成の各セクションに割り当てるダイアレクト id。"" はメイン */
  sectionDialects: string[];
}

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

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
      <label>
        ダイアレクト
        <select
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
        拍子
        <select value={settings.meterName} onChange={(e) => set("meterName", e.target.value)}>
          {Object.keys(METERS).map((m) => (
            <option key={m} value={m}>
              {m}
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
