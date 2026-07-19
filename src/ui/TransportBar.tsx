export interface TransportState {
  positionBeat: number;
  loopRange: boolean;
  rangeStartBar: number;
  rangeEndBar: number;
  metronome: boolean;
  countIn: boolean;
}

export function TransportBar({
  transport,
  playing,
  totalBars,
  barBeats,
  onChange,
  onPlayPause,
  onStop,
}: {
  transport: TransportState;
  playing: boolean;
  totalBars: number;
  barBeats: number;
  onChange: (next: TransportState) => void;
  onPlayPause: () => void;
  onStop: () => void;
}) {
  const totalBeats = totalBars * barBeats;
  const positionBar = Math.min(totalBars, transport.positionBeat / barBeats);
  return (
    <div className="transport-bar">
      <button className="primary" onClick={onPlayPause}>
        {playing ? "Ⅱ 一時停止" : "▶ 再生"}
      </button>
      <button onClick={onStop}>■ 停止</button>
      <span className="transport-position">
        {Math.floor(positionBar) + 1} 小節 / {totalBars}
      </span>
      <input
        className="transport-slider"
        aria-label="再生位置"
        type="range"
        min={0}
        max={Math.max(0.25, totalBeats)}
        step={0.25}
        value={Math.min(transport.positionBeat, totalBeats)}
        onChange={(event) =>
          onChange({ ...transport, positionBeat: Number(event.target.value) })
        }
      />
      <label>
        <input
          type="checkbox"
          checked={transport.loopRange}
          onChange={(event) => onChange({ ...transport, loopRange: event.target.checked })}
        />
        範囲ループ
      </label>
      <label>
        開始
        <input
          type="number"
          min={1}
          max={totalBars}
          value={transport.rangeStartBar + 1}
          onChange={(event) =>
            onChange({
              ...transport,
              rangeStartBar: Math.max(0, Number(event.target.value) - 1),
            })
          }
        />
      </label>
      <label>
        終了
        <input
          type="number"
          min={1}
          max={totalBars}
          value={transport.rangeEndBar}
          onChange={(event) =>
            onChange({
              ...transport,
              rangeEndBar: Math.min(totalBars, Number(event.target.value)),
            })
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={transport.metronome}
          onChange={(event) => onChange({ ...transport, metronome: event.target.checked })}
        />
        メトロノーム
      </label>
      <label>
        <input
          type="checkbox"
          checked={transport.countIn}
          onChange={(event) => onChange({ ...transport, countIn: event.target.checked })}
        />
        1小節カウント
      </label>
    </div>
  );
}
