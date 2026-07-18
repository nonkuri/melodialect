import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "../engine/types.js";
import { generateSong } from "../engine/song.js";
import { parseForm } from "../engine/structure.js";
import { dialects, shortName } from "../dialects/index.js";
import { SongPlayer } from "../audio/player.js";
import { downloadMidi } from "../export/download.js";
import { downloadWav } from "../export/wav.js";
import { downloadSunoText } from "../export/text.js";
import { generateLyrics } from "../engine/lyrics.js";
import { SettingsPanel, type Settings } from "./SettingsPanel.js";
import { PianoRoll } from "./PianoRoll.js";
import { ScoreView } from "./ScoreView.js";

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

function buildSong(settings: Settings): Song {
  const dialect = dialects[settings.dialectId];
  if (!dialect) throw new Error(`unknown dialect: ${settings.dialectId}`);
  const entries = parseForm(settings.form).map((entry, i) => ({
    ...entry,
    dialectName: settings.sectionDialects[i] || undefined,
  }));
  return generateSong({
    dialect,
    seed: settings.seed,
    keyName: settings.keyName,
    bpm: settings.bpm,
    form: entries,
    resolveDialect: (name) => dialects[name],
  });
}

export function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const d = dialects["paul"]!;
    return {
      dialectId: d.id,
      keyName: d.defaults.key,
      bpm: d.defaults.bpm,
      seed: 42,
      form: "v,c,v,c",
      sectionDialects: ["", "", "", ""],
    };
  });
  const [song, setSong] = useState<Song>(() => buildSong(settings));
  const [playing, setPlaying] = useState(false);
  const [playheadBeat, setPlayheadBeat] = useState<number | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [view, setView] = useState<"roll" | "score">("roll");
  const [showLyrics, setShowLyrics] = useState(false);
  const [renderingWav, setRenderingWav] = useState(false);

  const playerRef = useRef<SongPlayer>(null);
  if (playerRef.current === null) playerRef.current = new SongPlayer();
  const player = playerRef.current;

  const regenerate = useCallback(() => {
    player.stop();
    setPlaying(false);
    setPlayheadBeat(null);
    setSong(buildSong(settings));
  }, [settings, player]);

  const togglePlay = useCallback(() => {
    if (player.isPlaying) {
      player.stop();
      setPlaying(false);
      setPlayheadBeat(null);
    } else {
      player.play(song, () => {
        setPlaying(false);
        setPlayheadBeat(null);
      });
      setPlaying(true);
    }
  }, [player, song]);

  // 再生ヘッドの追従
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setPlayheadBeat(player.positionBeats);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, player]);

  useEffect(() => () => player.stop(), [player]);

  const annotationRows = useMemo(
    () =>
      song.sections.flatMap((section, i) =>
        section.annotations.map((a, j) => ({
          key: `${i}-${j}`,
          section: SECTION_LABELS[section.plan.type] ?? section.plan.type,
          bar: section.startBar + a.bar + 1,
          ruleId: a.ruleId,
          text: a.text,
        })),
      ),
    [song],
  );

  const mainDialectId = song.dialectId;
  const lyrics = useMemo(() => generateLyrics(song), [song]);

  const saveWav = useCallback(async () => {
    setRenderingWav(true);
    try {
      await downloadWav(song);
    } finally {
      setRenderingWav(false);
    }
  }, [song]);

  return (
    <div className="app">
      <header className="header">
        <h1>Melodialect</h1>
        <span className="tagline">作曲家の「音楽的方言」をルールベースで再現</span>
        <div className="view-toggle">
          <button
            className={view === "roll" ? "active" : ""}
            onClick={() => setView("roll")}
          >
            ピアノロール
          </button>
          <button
            className={view === "score" ? "active" : ""}
            onClick={() => setView("score")}
          >
            譜面
          </button>
        </div>
        <div className="header-actions">
          <button className="primary" onClick={regenerate}>
            ♪ 生成
          </button>
          <button onClick={togglePlay}>{playing ? "■ 停止" : "▶ 再生"}</button>
          <button onClick={() => downloadMidi(song)}>MIDI 保存</button>
          <button onClick={saveWav} disabled={renderingWav}>
            {renderingWav ? "書き出し中…" : "WAV 保存"}
          </button>
          <button
            onClick={() => downloadSunoText(song, dialects[settings.dialectId])}
            title="Suno 等に貼り付けるスタイル+仮歌詞+コード進行のテキスト"
          >
            テキスト出力
          </button>
        </div>
      </header>

      <div className="body">
        <SettingsPanel settings={settings} onChange={setSettings} />

        <main className="main">
          {view === "roll" ? (
            <PianoRoll song={song} playheadBeat={playheadBeat} />
          ) : (
            <>
              <label className="lyrics-toggle">
                <input
                  type="checkbox"
                  checked={showLyrics}
                  onChange={(e) => setShowLyrics(e.target.checked)}
                />
                仮歌詞を表示
              </label>
              <ScoreView song={song} lyrics={showLyrics ? lyrics : undefined} />
            </>
          )}

          <div className="annotations">
            <button className="link" onClick={() => setShowAnnotations((v) => !v)}>
              {showAnnotations ? "▼" : "▶"} 生成根拠の解説 ({annotationRows.length})
            </button>
            {showAnnotations && (
              <ul>
                {annotationRows.map((r) => (
                  <li key={r.key}>
                    <span className="annotation-loc">
                      {r.section} / {r.bar} 小節目
                    </span>
                    <span className={`annotation-tag tag-${r.ruleId}`}>{r.ruleId}</span>
                    {r.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
      </div>

      <footer className="timeline">
        {song.sections.map((section, i) => {
          const d = dialects[section.dialectId];
          const isGuest = section.dialectId !== mainDialectId;
          return (
            <div
              key={i}
              className={`timeline-block block-${section.plan.type}`}
              style={{ flexGrow: section.plan.bars }}
            >
              {SECTION_LABELS[section.plan.type] ?? section.plan.type}
              <small>
                {section.plan.bars} 小節
                {isGuest && d ? ` · ${shortName(d)}` : ""}
              </small>
            </div>
          );
        })}
      </footer>
    </div>
  );
}
