import { useEffect, useState } from "react";
import type { Song } from "../engine/types.js";
import type {
  ChordRefreshPart,
  ChordSelection,
  NoteSelection,
  RegenerationTarget,
} from "./editor.js";

const PALETTE_MAJOR = ["I", "ii", "iii", "IV", "V7", "vi", "vii°", "♭VII", "iv", "I△7", "IV△7", "ii7"];
const PALETTE_MINOR = ["i", "ii°", "III", "iv", "V7", "VI", "VII", "♭II", "i△7", "iv7", "III△7"];

export function EditorToolbar({
  song,
  sectionIndex,
  noteSelections,
  chordSelections,
  sectionLocked,
  selectionLocked,
  entityLocked,
  refreshParts,
  onRefreshPartsChange,
  onRegenerate,
  onToggleSectionLock,
  onMoveNotes,
  onQuantize,
  onDeleteNotes,
  onToggleSelectionLock,
  onToggleEntityLock,
  onReplaceChord,
  onInsertChord,
  onDeleteChords,
  onTransposeChords,
  onOpenHarmonyDesign,
}: {
  song: Song;
  sectionIndex: number;
  noteSelections: NoteSelection[];
  chordSelections: ChordSelection[];
  sectionLocked: boolean;
  selectionLocked: boolean;
  entityLocked: boolean;
  refreshParts: ChordRefreshPart[];
  onRefreshPartsChange: (parts: ChordRefreshPart[]) => void;
  onRegenerate: (target: RegenerationTarget) => void;
  onToggleSectionLock: () => void;
  onMoveNotes: (semitones: number) => void;
  onQuantize: () => void;
  onDeleteNotes: () => void;
  onToggleSelectionLock: () => void;
  onToggleEntityLock: () => void;
  onReplaceChord: (symbol: string) => void;
  onInsertChord: (symbol: string) => void;
  onDeleteChords: () => void;
  onTransposeChords: (semitones: number) => void;
  onOpenHarmonyDesign: () => void;
}) {
  const section = song.sections[sectionIndex];
  const primaryChord = chordSelections[0];
  const selectedChord = primaryChord
    ? song.sections[primaryChord.sectionIndex]?.chords[primaryChord.chordIndex]
    : undefined;
  const [symbol, setSymbol] = useState(selectedChord?.symbol ?? "I");
  const [showPalette, setShowPalette] = useState(false);
  useEffect(() => setSymbol(selectedChord?.symbol ?? "I"), [selectedChord?.symbol]);
  const palette = (section?.key.mode ?? song.key.mode) === "minor" ? PALETTE_MINOR : PALETTE_MAJOR;

  const toggleRefresh = (part: ChordRefreshPart) => {
    onRefreshPartsChange(refreshParts.includes(part)
      ? refreshParts.filter((item) => item !== part)
      : [...refreshParts, part]);
  };

  return (
    <div className="editor-toolbar">
      <strong>{section ? `${section.plan.type} ${sectionIndex + 1}` : "セクション未選択"}</strong>
      <button onClick={onToggleSectionLock}>{sectionLocked ? "🔒 セクション" : "🔓 セクション"}</button>
      <span className="toolbar-separator" />
      <span>再生成</span>
      {(["all", "melody", "chords", "bass", "accompaniment"] as RegenerationTarget[]).map((target) => (
        <button key={target} disabled={sectionLocked} onClick={() => onRegenerate(target)}>
          {{ all: "全体", melody: "メロディ", chords: "コード", bass: "ベース", accompaniment: "伴奏" }[target]}
        </button>
      ))}
      <span className="toolbar-separator" />
      <button type="button" onClick={onOpenHarmonyDesign}>コード進行…</button>

      {noteSelections.length > 0 && (
        <>
          <span className="toolbar-separator" />
          <span>ノート {noteSelections.length}件</span>
          <button onClick={() => onMoveNotes(-12)}>-12</button>
          <button onClick={() => onMoveNotes(-1)}>-1</button>
          <button onClick={() => onMoveNotes(1)}>+1</button>
          <button onClick={() => onMoveNotes(12)}>+12</button>
          <button onClick={onQuantize}>グリッド整列</button>
          <button onClick={onDeleteNotes}>削除</button>
          <button onClick={onToggleSelectionLock}>{selectionLocked ? "🔒 小節" : "🔓 小節"}</button>
          {noteSelections.length === 1 && <button onClick={onToggleEntityLock}>{entityLocked ? "🔒 ノート" : "🔓 ノート"}</button>}
        </>
      )}

      {chordSelections.length > 0 && (
        <>
          <span className="toolbar-separator" />
          <span>コード {chordSelections.length}件</span>
          {chordSelections.length === 1 && (
            <>
              <input className="chord-input" value={symbol} onChange={(event) => setSymbol(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") onReplaceChord(symbol); }} />
              <button onClick={() => onReplaceChord(symbol)}>置換</button>
              <button onClick={() => onInsertChord(symbol)}>挿入</button>
              <button className={showPalette ? "active" : ""} onClick={() => setShowPalette((value) => !value)}>候補</button>
            </>
          )}
          <button onClick={() => onTransposeChords(-1)}>実音 -1</button>
          <button onClick={() => onTransposeChords(1)}>実音 +1</button>
          <button onClick={onDeleteChords}>削除</button>
          <button onClick={onToggleSelectionLock}>{selectionLocked ? "🔒 小節" : "🔓 小節"}</button>
          {chordSelections.length === 1 && <button onClick={onToggleEntityLock}>{entityLocked ? "🔒 コード" : "🔓 コード"}</button>}
          <div className="refresh-parts" title="コード変更後に作り直す伴奏パート">
            更新:
            {(["piano", "guitar", "bass", "drums"] as ChordRefreshPart[]).map((part) => (
              <label key={part}><input type="checkbox" checked={refreshParts.includes(part)} onChange={() => toggleRefresh(part)} />
                {{ piano: "P", guitar: "G", bass: "B", drums: "D" }[part]}</label>
            ))}
          </div>
        </>
      )}
      {showPalette && chordSelections.length === 1 && (
        <div className="chord-palette">
          {palette.map((candidate) => <button key={candidate} onClick={() => { setSymbol(candidate); onReplaceChord(candidate); }}>{candidate}</button>)}
        </div>
      )}
    </div>
  );
}
