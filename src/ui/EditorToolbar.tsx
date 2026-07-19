import { useEffect, useState } from "react";
import type { Song } from "../engine/types.js";
import type { ChordSelection, NoteSelection, RegenerationTarget } from "./editor.js";

export function EditorToolbar({
  song,
  sectionIndex,
  noteSelection,
  chordSelection,
  sectionLocked,
  selectionLocked,
  entityLocked,
  onRegenerate,
  onToggleSectionLock,
  onMoveNote,
  onQuantize,
  onDeleteNote,
  onToggleSelectionLock,
  onToggleEntityLock,
  onReplaceChord,
  onInsertChord,
  onDeleteChord,
}: {
  song: Song;
  sectionIndex: number;
  noteSelection: NoteSelection | null;
  chordSelection: ChordSelection | null;
  sectionLocked: boolean;
  selectionLocked: boolean;
  entityLocked: boolean;
  onRegenerate: (target: RegenerationTarget) => void;
  onToggleSectionLock: () => void;
  onMoveNote: (semitones: number) => void;
  onQuantize: () => void;
  onDeleteNote: () => void;
  onToggleSelectionLock: () => void;
  onToggleEntityLock: () => void;
  onReplaceChord: (symbol: string) => void;
  onInsertChord: (symbol: string) => void;
  onDeleteChord: () => void;
}) {
  const section = song.sections[sectionIndex];
  const selectedChord = chordSelection
    ? song.sections[chordSelection.sectionIndex]?.chords[chordSelection.chordIndex]
    : undefined;
  const [symbol, setSymbol] = useState(selectedChord?.symbol ?? "I");
  useEffect(() => setSymbol(selectedChord?.symbol ?? "I"), [selectedChord?.symbol]);

  return (
    <div className="editor-toolbar">
      <strong>{section ? `${section.plan.type} ${sectionIndex + 1}` : "セクション未選択"}</strong>
      <button onClick={onToggleSectionLock}>{sectionLocked ? "🔒 セクション" : "🔓 セクション"}</button>
      <span className="toolbar-separator" />
      <span>再生成</span>
      {(["all", "melody", "chords", "accompaniment"] as RegenerationTarget[]).map((target) => (
        <button key={target} disabled={sectionLocked} onClick={() => onRegenerate(target)}>
          {{ all: "全体", melody: "メロディ", chords: "コード", accompaniment: "伴奏" }[target]}
        </button>
      ))}

      {noteSelection && (
        <>
          <span className="toolbar-separator" />
          <span>ノート</span>
          <button onClick={() => onMoveNote(-12)}>-12</button>
          <button onClick={() => onMoveNote(-1)}>-1</button>
          <button onClick={() => onMoveNote(1)}>+1</button>
          <button onClick={() => onMoveNote(12)}>+12</button>
          <button onClick={onQuantize}>1/16整列</button>
          <button onClick={onDeleteNote}>削除</button>
          <button onClick={onToggleSelectionLock}>{selectionLocked ? "🔒 小節" : "🔓 小節"}</button>
          <button onClick={onToggleEntityLock}>{entityLocked ? "🔒 ノート" : "🔓 ノート"}</button>
        </>
      )}

      {chordSelection && (
        <>
          <span className="toolbar-separator" />
          <span>コード</span>
          <input
            className="chord-input"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onReplaceChord(symbol);
            }}
          />
          <button onClick={() => onReplaceChord(symbol)}>置換</button>
          <button onClick={() => onInsertChord(symbol)}>挿入</button>
          <button onClick={onDeleteChord}>削除</button>
          <button onClick={onToggleSelectionLock}>{selectionLocked ? "🔒 小節" : "🔓 小節"}</button>
          <button onClick={onToggleEntityLock}>{entityLocked ? "🔒 コード" : "🔓 コード"}</button>
        </>
      )}
    </div>
  );
}
