import type { SectionControl, SectionType } from "../engine/types.js";
import { dialects, shortName } from "../dialects/index.js";

interface Props {
  sections: SectionControl[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onChange: (sections: SectionControl[]) => void;
}

const TYPES: Array<[SectionType, string]> = [
  ["intro", "Intro"], ["verse", "Verse"], ["chorus", "Chorus"],
  ["bridge", "Bridge"], ["outro", "Outro"],
];

export function StructureEditor({ sections, selectedIndex, onSelect, onChange }: Props) {
  const selected = sections[selectedIndex];
  const replace = (patch: Partial<SectionControl>) => {
    if (!selected) return;
    onChange(sections.map((section, index) => index === selectedIndex ? { ...section, ...patch } : section));
  };
  const add = () => {
    const base = selected ?? sections.at(-1);
    const section: SectionControl = {
      id: "section-" + Date.now().toString(36), type: "verse",
      dialectId: base?.dialectId ?? "chromatic", bars: base?.bars ?? 8,
      transpose: 0, bpm: base?.bpm ?? 120,
    };
    onChange([...sections, section]);
    onSelect(sections.length);
  };
  const duplicate = () => {
    if (!selected) return;
    const copy = { ...selected, id: "section-" + Date.now().toString(36) };
    const next = [...sections];
    next.splice(selectedIndex + 1, 0, copy);
    onChange(next);
    onSelect(selectedIndex + 1);
  };
  const remove = () => {
    if (sections.length <= 1) return;
    onChange(sections.filter((_, index) => index !== selectedIndex));
    onSelect(Math.max(0, selectedIndex - 1));
  };

  return <div className="structure-editor">
    <strong>構成</strong>
    {selected && <>
      <label>種類<select value={selected.type} onChange={(event) => replace({ type: event.target.value as SectionType })}>
        {TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select></label>
      <label>ダイアレクト<select value={selected.dialectId} onChange={(event) => replace({ dialectId: event.target.value })}>
        {Object.values(dialects).map((dialect) => <option value={dialect.id} key={dialect.id}>{shortName(dialect)}</option>)}
      </select></label>
      <label>小節<input type="number" min="1" max="32" value={selected.bars}
        onChange={(event) => replace({ bars: Math.max(1, Number(event.target.value)) })} /></label>
      <label>移調<input type="number" min="-12" max="12" value={selected.transpose}
        onChange={(event) => replace({ transpose: Number(event.target.value) })} /></label>
      <label>BPM<input type="number" min="40" max="240" value={selected.bpm}
        onChange={(event) => replace({ bpm: Number(event.target.value) })} /></label>
    </>}
    <button onClick={add}>＋追加</button>
    <button disabled={!selected} onClick={duplicate}>複製</button>
    <button disabled={sections.length <= 1} onClick={remove}>削除</button>
    <span className="structure-hint">下のブロックはドラッグで並べ替え</span>
  </div>;
}
