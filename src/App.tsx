import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { Arrow, BoardPosition, Piece, Square } from "react-chessboard/dist/chessboard/types";
import { Chess } from "chess.js";
import {
  AlertCircle,
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  FileUp,
  Flame,
  Loader2,
  Moon,
  Play,
  Search,
  Star,
  Sun,
  ThumbsUp,
  Timer,
  UploadCloud,
  XOctagon,
  Zap
} from "lucide-react";
import { fetchChessComGames } from "./chessCom";
import {
  REVIEW_LABELS,
  ReviewedPly,
  classifyMove,
  explainMove,
  gameSummaryFromPgn,
  moveIdea,
  parsePgn,
  toDisplayEval,
  type GameSummary
} from "./chessData";
import { StockfishClient, type PositionAnalysis } from "./stockfish";

const SAMPLE_PGN = `[Event "Example"]
[Site "Local"]
[Date "2026.05.05"]
[Round "-"]
[White "White"]
[Black "Black"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 1-0`;

const EDIT_PIECES: Piece[] = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];
const START_FEN = new Chess().fen();

export function App() {
  const [username, setUsername] = useState("");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameFilter, setGameFilter] = useState("all");
  const [selected, setSelected] = useState<GameSummary | null>(() => gameSummaryFromPgn(SAMPLE_PGN, "import", "sample"));
  const [pgnText, setPgnText] = useState("");
  const [currentPly, setCurrentPly] = useState(0);
  const [reviews, setReviews] = useState<ReviewedPly[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [depth, setDepth] = useState(12);
  const [exploreFen, setExploreFen] = useState<string | null>(null);
  const [exploreAnalysis, setExploreAnalysis] = useState<PositionAnalysis | null>(null);
  const [positionAnalyzing, setPositionAnalyzing] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [retryingMove, setRetryingMove] = useState<ReviewedPly | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [hoveredBestMove, setHoveredBestMove] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editBoard, setEditBoard] = useState<BoardPosition>(() => boardPositionFromFen(START_FEN));
  const [editTurn, setEditTurn] = useState<"w" | "b">("w");
  const [editTool, setEditTool] = useState<Piece | "erase">("wP");
  const engineRef = useRef<StockfishClient | null>(null);
  const analysisCacheRef = useRef(new Map<string, PositionAnalysis>());

  const parsed = useMemo(() => {
    if (!selected) return null;
    try {
      return parsePgn(selected.pgn);
    } catch {
      return null;
    }
  }, [selected]);

  useEffect(() => {
    setCurrentPly(0);
    setReviews([]);
    setExploreFen(null);
    setExploreAnalysis(null);
    setRetryingMove(null);
    setSelectedSquare(null);
    setHoveredBestMove(null);
  }, [selected?.id]);

  useEffect(() => {
    return () => engineRef.current?.dispose();
  }, []);

  const gamePosition = useMemo(() => {
    if (!parsed) return "start";
    if (currentPly === 0) return parsed.initialFen;
    return parsed.plies[currentPly - 1]?.afterFen ?? parsed.finalFen;
  }, [parsed, currentPly]);

  const editFen = useMemo(() => fenFromBoardPosition(editBoard, editTurn), [editBoard, editTurn]);
  const position = exploreFen ?? gamePosition;
  const displayedPosition = editMode ? editFen : position;
  const boardPosition = editMode ? editBoard : displayedPosition;
  const activeReview = currentPly > 0 ? reviews[currentPly - 1] : undefined;
  const nextReview = currentPly < reviews.length ? reviews[currentPly] : undefined;
  const currentAnalysis = editMode ? exploreAnalysis : exploreAnalysis ?? nextReview?.before ?? activeReview?.after;
  const evalNow = currentAnalysis?.lines[0]?.whiteScoreCp;
  const arrows = useMemo(() => bestMoveArrows(currentAnalysis, hoveredBestMove), [currentAnalysis, hoveredBestMove]);
  const legalTargets = useMemo(
    () => (editMode ? editMoveTargets(editBoard, selectedSquare, editTurn) : legalMoveTargets(position, selectedSquare)),
    [editMode, editBoard, editTurn, position, selectedSquare]
  );
  const checkmateSquare = useMemo(() => checkmateKingSquare(displayedPosition), [displayedPosition]);
  const boardHighlights = useMemo(
    () => squareHighlights(editMode ? undefined : activeReview, selectedSquare, legalTargets, checkmateSquare),
    [editMode, activeReview, selectedSquare, legalTargets, checkmateSquare]
  );
  const recap = useMemo(() => reviewRecap(reviews), [reviews]);
  const playerRecap = useMemo(() => reviewRecapByColor(reviews), [reviews]);
  const playerRatings = useMemo(() => playerPerformance(reviews, selected), [reviews, selected]);
  const playerAccuracies = useMemo(() => playerAccuracyScores(reviews), [reviews]);
  const phaseBreakdown = useMemo(() => phaseRatings(reviews, selected), [reviews, selected]);
  const gameReport = useMemo(() => buildGameReport(reviews, selected), [reviews, selected]);
  const selectedTempo = selected ? formatTimeControl(selected) : "";
  const opening = useMemo(() => detectOpening(parsed?.plies ?? []), [parsed]);
  const evalPoints = useMemo(() => evaluationPoints(parsed?.plies.length ?? 0, reviews), [parsed?.plies.length, reviews]);
  const boardSize = useBoardSize();
  const visibleGames = useMemo(() => {
    if (gameFilter === "all") return games;
    return games.filter((game) => game.timeClass?.toLowerCase() === gameFilter);
  }, [gameFilter, games]);

  useEffect(() => {
    setHoveredBestMove(null);
  }, [displayedPosition, currentAnalysis]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (!parsed) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPly(Math.max(0, currentPly - 1));
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToPly(Math.min(parsed.plies.length, currentPly + 1));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPly, parsed]);

  function goToPly(ply: number) {
    setExploreFen(null);
    setExploreAnalysis(null);
    setRetryingMove(null);
    setSelectedSquare(null);
    setCurrentPly(ply);
  }

  function getEngine() {
    const engine = engineRef.current ?? new StockfishClient();
    engineRef.current = engine;
    return engine;
  }

  async function analyzeFen(fen: string) {
    const key = `${fen}|${depth}|3`;
    const cached = analysisCacheRef.current.get(key);
    if (cached) return cached;

    const result = await getEngine().analyze(fen, depth, 3);
    analysisCacheRef.current.set(key, result);
    return result;
  }

  async function loadChessComGames() {
    setError("");
    setLoadingGames(true);
    try {
      const loaded = await fetchChessComGames(username, 24);
      setGames(loaded);
      if (loaded[0]) setSelected(loaded[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch Chess.com games.");
    } finally {
      setLoadingGames(false);
    }
  }

  function importPgn() {
    setError("");
    try {
      const game = gameSummaryFromPgn(pgnText.trim(), "import");
      setSelected(game);
      setGames((existing) => [game, ...existing.filter((item) => item.id !== game.id)]);
      setPgnText("");
    } catch {
      setError("That PGN could not be parsed.");
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setPgnText(text);
  }

  async function analyzeGame() {
    if (!parsed) return;
    setError("");
    setAnalyzing(true);
    setReviews([]);

    try {
      const positions = [...new Set([...parsed.plies.map((ply) => ply.beforeFen), parsed.finalFen])];
      const analysisByFen = new Map<string, PositionAnalysis>();

      for (let i = 0; i < positions.length; i += 1) {
        setProgress(`${i + 1}/${positions.length}`);
        const result = await analyzeFen(positions[i]);
        analysisByFen.set(positions[i], result);
      }

      const reviewed = parsed.plies.map((ply) => {
        const before = analysisByFen.get(ply.beforeFen);
        const after = analysisByFen.get(ply.afterFen);
        const bestBefore = before?.lines[0]?.whiteScoreCp;
        const evalAfter = after?.lines[0]?.whiteScoreCp;
        const evalBefore = before?.lines[0]?.whiteScoreCp;
        const rawLoss =
          bestBefore === undefined || evalAfter === undefined
            ? undefined
            : ply.color === "w"
              ? bestBefore - evalAfter
              : evalAfter - bestBefore;
        const loss = rawLoss === undefined ? undefined : Math.max(0, rawLoss);
        const evalGain =
          evalBefore === undefined || evalAfter === undefined
            ? 0
            : ply.color === "w"
              ? evalAfter - evalBefore
              : evalBefore - evalAfter;

        return {
          ...ply,
          before,
          after,
          loss,
          label: loss === undefined ? undefined : classifyMove(ply, loss, before?.lines[0]?.pv[0], evalGain),
          idea: moveIdea(before?.lines[0]?.pv)
        };
      });

      setReviews(reviewed);
      setProgress("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stockfish analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeCurrentPosition(fen = editMode ? editFen : position, target: "game" | "explore" = editMode || exploreFen ? "explore" : "game") {
    if (!fen || fen === "start") return;
    setError("");
    const validationError = validateFenForAnalysis(fen);
    if (validationError) {
      setError(validationError);
      return;
    }
    setPositionAnalyzing(true);
    try {
      const result = await analyzeFen(fen);
      if (target === "explore") {
        setExploreAnalysis(result);
      } else {
        setExploreAnalysis(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stockfish analysis failed.");
    } finally {
      setPositionAnalyzing(false);
    }
  }

  function onPieceDrop(sourceSquare: string, targetSquare: string) {
    if (editMode) {
      setEditBoard((board) => moveEditPiece(board, sourceSquare as Square, targetSquare as Square));
      setExploreAnalysis(null);
      setSelectedSquare(null);
      return true;
    }

    if (!position || position === "start") return false;

    const chess = new Chess(position);
    const move = chess.move({
      from: sourceSquare,
      to: targetSquare,
      promotion: "q"
    });

    if (!move) return false;

    const fen = chess.fen();
    setExploreFen(fen);
    setExploreAnalysis(null);
    setSelectedSquare(null);
    void analyzeCurrentPosition(fen, "explore");
    return true;
  }

  function playEngineMove(uci?: string) {
    if (!uci || !position || position === "start") return;

    const chess = new Chess(position);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || "q"
    });

    if (!move) return;

    const fen = chess.fen();
    setExploreFen(fen);
    setExploreAnalysis(null);
    setSelectedSquare(null);
    void analyzeCurrentPosition(fen, "explore");
  }

  function onSquareClick(square: Square) {
    if (editMode) {
      if (selectedSquare) {
        const selectedPiece = editBoard[selectedSquare];
        const clickedPiece = editBoard[square];

        if (selectedPiece === "wK" || selectedPiece === "bK") {
          if (clickedPiece === `${selectedPiece[0]}R` && canCastleEditor(editBoard, selectedSquare, square)) {
            setEditBoard((board) => moveEditPiece(board, selectedSquare, square));
            setExploreAnalysis(null);
            setSelectedSquare(null);
            return;
          }
        }

        if (clickedPiece && clickedPiece[0] === editTurn && square !== selectedSquare) {
          setSelectedSquare(square);
          return;
        }

        if (editMoveTargets(editBoard, selectedSquare, editTurn).includes(square)) {
          setEditBoard((board) => moveEditPiece(board, selectedSquare, square));
          setExploreAnalysis(null);
          setSelectedSquare(null);
          return;
        }

        setSelectedSquare(null);
        return;
      }

      const preview = editBoard[square];
      if (preview && preview[0] === editTurn) {
        setSelectedSquare(square);
        return;
      }

      setEditBoard((board) => applyEditTool(board, square, editTool));
      setExploreAnalysis(null);
      setSelectedSquare(null);
      return;
    }

    if (!position || position === "start") return;
    const chess = new Chess(position);

    if (selectedSquare) {
      const piece = chess.get(square);
      if (piece && piece.color === chess.turn() && square !== selectedSquare) {
        setSelectedSquare(square);
        return;
      }

      const move = tryMove(chess, selectedSquare, square);

      if (move) {
        const fen = chess.fen();
        setExploreFen(fen);
        setExploreAnalysis(null);
        setSelectedSquare(null);
        void analyzeCurrentPosition(fen, "explore");
        return;
      }

      setSelectedSquare(null);
      return;
    }

    const piece = chess.get(square);
    setSelectedSquare(piece && piece.color === chess.turn() ? square : null);
  }

  function retryMove(review?: ReviewedPly) {
    if (!review) return;
    setRetryingMove(review);
    setExploreFen(review.beforeFen);
    setExploreAnalysis(review.before ?? null);
  }

  function jumpToNextBad(direction: 1 | -1) {
    const badMoves = reviews
      .filter((review) => ["Mistake", "Miss", "Blunder"].includes(review.label ?? ""))
      .map((review) => review.index);
    if (!badMoves.length) return;
    const target =
      direction > 0
        ? badMoves.find((index) => index + 1 > currentPly) ?? badMoves[0]
        : [...badMoves].reverse().find((index) => index + 1 < currentPly) ?? badMoves[badMoves.length - 1];
    goToPly(target + 1);
  }

  function enterEditMode() {
    setEditBoard(boardPositionFromFen(displayedPosition === "start" ? START_FEN : displayedPosition));
    setEditTurn(turnFromFen(displayedPosition === "start" ? START_FEN : displayedPosition));
    setEditMode(true);
    setExploreFen(null);
    setExploreAnalysis(null);
    setSelectedSquare(null);
    setHoveredBestMove(null);
  }

  function exitEditMode() {
    setEditMode(false);
    setExploreAnalysis(null);
    setSelectedSquare(null);
    setHoveredBestMove(null);
  }

  return (
    <main className={`app-shell ${darkMode ? "dark" : ""}`}>
      <section className="topbar">
        <div>
          <p className="eyebrow">Stockfish review</p>
          <h1>Chess Review</h1>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle dark mode">
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
              <div className="status-pill">
                <Clock size={15} />
                <span>{selectedTempo || "Game"}</span>
              </div>
              <div className="status-pill">
                <BarChart3 size={16} />
                <span>{reviews.length ? "Analyzed" : "Ready"}</span>
              </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel">
            <h2>Fetch Games</h2>
            <div className="input-row">
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void loadChessComGames();
                }}
                placeholder="Chess.com username"
              />
              <button onClick={loadChessComGames} disabled={loadingGames}>
                {loadingGames ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Import PGN</h2>
            <textarea value={pgnText} onChange={(event) => setPgnText(event.target.value)} placeholder="Paste PGN here" />
            <div className="button-row">
              <label className="file-button">
                <FileUp size={17} />
                <input type="file" accept=".pgn,.txt" onChange={importFile} />
              </label>
              <button onClick={importPgn} disabled={!pgnText.trim()}>
                <UploadCloud size={17} />
                Import
              </button>
            </div>
          </div>

          <div className="panel editor-panel">
            <div className="panel-title-row">
              <h2>Board Editor</h2>
              <button className="small-button" onClick={editMode ? exitEditMode : enterEditMode}>
                {editMode ? "Done" : "Edit"}
              </button>
            </div>
            {editMode && (
              <>
                <div className="turn-toggle" aria-label="Side to move">
                  <button
                    className={editTurn === "w" ? "active" : ""}
                    onClick={() => {
                      setEditTurn("w");
                      setExploreAnalysis(null);
                    }}
                  >
                    White
                  </button>
                  <button
                    className={editTurn === "b" ? "active" : ""}
                    onClick={() => {
                      setEditTurn("b");
                      setExploreAnalysis(null);
                    }}
                  >
                    Black
                  </button>
                </div>
                <div className="piece-palette">
                  {EDIT_PIECES.map((piece) => (
                    <button
                      key={piece}
                      className={editTool === piece ? "active" : ""}
                      onClick={() => setEditTool(piece)}
                      aria-label={`Place ${piece}`}
                    >
                      {pieceSymbol(piece)}
                    </button>
                  ))}
                  <button className={editTool === "erase" ? "active" : ""} onClick={() => setEditTool("erase")} aria-label="Erase piece">
                    ×
                  </button>
                </div>
                <div className="button-row editor-actions">
                  <button
                    onClick={() => {
                      setEditBoard(boardPositionFromFen(START_FEN));
                      setExploreAnalysis(null);
                    }}
                  >
                    Start
                  </button>
                  <button
                    onClick={() => {
                      setEditBoard({});
                      setExploreAnalysis(null);
                    }}
                  >
                    Clear
                  </button>
                  <button onClick={() => void analyzeCurrentPosition(editFen, "explore")} disabled={positionAnalyzing}>
                    {positionAnalyzing ? <Loader2 className="spin" size={16} /> : <BarChart3 size={16} />}
                    Analyze
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="panel game-list">
            <div className="panel-title-row">
              <h2>Games</h2>
              <select value={gameFilter} onChange={(event) => setGameFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="daily">Daily</option>
                <option value="rapid">Rapid</option>
                <option value="blitz">Blitz</option>
                <option value="bullet">Bullet</option>
              </select>
            </div>
            {[selected, ...visibleGames.filter((game) => game.id !== selected?.id)].filter(Boolean).map((game) => (
              <button
                key={game!.id}
                className={`game-item ${game!.id === selected?.id ? "active" : ""}`}
                onClick={() => setSelected(game!)}
              >
                <span className="game-title">
                  <GameIcon game={game!} />
                  <span>{game!.white} vs {game!.black}</span>
                </span>
                <small>
                  <CalendarDays size={13} />
                  {game!.date || game!.source} · {formatTimeControl(game!)} · {game!.result}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <section className="board-area">
          <div className="board-wrap">
            <Chessboard
              position={boardPosition}
              boardWidth={boardSize}
              arePiecesDraggable
              dropOffBoardAction={editMode ? "trash" : "snapback"}
              onPieceDrop={onPieceDrop}
              onPieceDropOffBoard={(sourceSquare) => {
                if (!editMode) return;
                setEditBoard((board) => {
                  const next = { ...board };
                  delete next[sourceSquare];
                  return next;
                });
                setExploreAnalysis(null);
                setSelectedSquare(null);
              }}
              onPieceClick={(_, square) => onSquareClick(square)}
              onSquareClick={onSquareClick}
              customArrows={arrows}
              customSquareStyles={boardHighlights}
              customDarkSquareStyle={{ backgroundColor: "#779556" }}
              customLightSquareStyle={{ backgroundColor: "#ebecd0" }}
            />
          </div>
          <EvalGraph points={evalPoints} currentPly={currentPly} onSelectPly={goToPly} />
        </section>

        <section className="review-strip">
          <div className="move-controls">
            <button onClick={() => goToPly(0)} disabled={!currentPly && !exploreFen}>Start</button>
            <button onClick={() => jumpToNextBad(-1)} disabled={!reviews.length}>Prev Miss</button>
            <button onClick={() => goToPly(Math.max(0, currentPly - 1))} disabled={!currentPly}>
              <ChevronLeft size={18} />
            </button>
            <span>{currentPly}/{parsed?.plies.length ?? 0}</span>
            <button onClick={() => goToPly(Math.min(parsed?.plies.length ?? 0, currentPly + 1))} disabled={!parsed || currentPly >= parsed.plies.length}>
              <ChevronRight size={18} />
            </button>
            <button onClick={() => jumpToNextBad(1)} disabled={!reviews.length}>Next Miss</button>
            <button onClick={() => goToPly(parsed?.plies.length ?? 0)} disabled={!parsed || currentPly >= parsed.plies.length}>End</button>
          </div>
          <div className="board-meta">
            <span><Clock size={15} />{selectedTempo || "Imported game"}</span>
            <span>{selected?.date || "No date"} · {selected?.result ?? "*"}</span>
          </div>

          <div className="panel board-moves">
            <h2>Moves</h2>
            <div className="move-grid">
              {parsed?.plies.map((ply, index) => (
                <button
                  key={`${ply.index}-${ply.uci}`}
                  className={`move-pill ${currentPly === index + 1 && !exploreFen ? "active" : ""} ${reviews[index]?.label?.toLowerCase() ?? ""}`}
                  onClick={() => goToPly(index + 1)}
                >
                  <span>{ply.color === "w" ? `${ply.moveNumber}.` : ""}</span>
                  <strong>{ply.san}</strong>
                  {ply.clock && <small>{formatMoveClock(ply.clock)}</small>}
                  {reviews[index]?.label && <CategoryIcon label={reviews[index].label} size={13} />}
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="analysis">
          <div className="panel">
            <div className="analysis-header">
              <div>
                <h2>
                  <PlayerName name={selected?.white ?? "White"} color="white" result={selected?.result} />
                  <span className="versus"> vs </span>
                  <PlayerName name={selected?.black ?? "Black"} color="black" result={selected?.result} />
                </h2>
                <p>{opening.eco} · {opening.name}</p>
              </div>
              <div className="eval-box">{toDisplayEval(evalNow)}</div>
            </div>

            {reviews.length > 0 && (
              <div className="recap-table">
                <div className="rating-row">
                  <div>
                    <span>{selected?.white ?? "White"}</span>
                    <strong className="rating-score">
                      {playerRatings.w}
                      <em>{playerAccuracies.w}%</em>
                    </strong>
                  </div>
                  <div>
                    <span>{selected?.black ?? "Black"}</span>
                    <strong className="rating-score">
                      {playerRatings.b}
                      <em>{playerAccuracies.b}%</em>
                    </strong>
                  </div>
                </div>
                <details className="phase-details">
                  <summary>Game phases</summary>
                  <div className="phase-table">
                    {(["opening", "middlegame", "endgame"] as const).map((phase) => (
                      <div key={phase}>
                        <span>{titleCase(phase)}</span>
                        <strong>{phaseBreakdown.w[phase]}</strong>
                        <strong>{phaseBreakdown.b[phase]}</strong>
                      </div>
                    ))}
                  </div>
                </details>
                <div className="recap-head">
                  <span></span>
                  <strong>{selected?.white ?? "White"}</strong>
                  <strong>{selected?.black ?? "Black"}</strong>
                </div>
                {REVIEW_LABELS.map((label) => (
                  <div className={`recap-row ${label.toLowerCase()}`} key={label}>
                    <span><CategoryIcon label={label} size={14} />{label}</span>
                    <strong>{playerRecap.w[label] ?? 0}</strong>
                    <strong>{playerRecap.b[label] ?? 0}</strong>
                  </div>
                ))}
              </div>
            )}

            <div className="depth-row">
              <label>Depth {depth}</label>
              <input type="range" min="8" max="23" value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
            </div>
            <button className="primary" onClick={analyzeGame} disabled={!parsed || analyzing}>
              {analyzing ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {analyzing ? `Analyzing ${progress}` : "Analyze Game"}
            </button>

            <button className="secondary" onClick={() => analyzeCurrentPosition()} disabled={positionAnalyzing || (!parsed && !editMode)}>
              {positionAnalyzing ? <Loader2 className="spin" size={18} /> : <BarChart3 size={18} />}
              {positionAnalyzing ? "Analyzing Position" : "Analyze Position"}
            </button>

            {exploreFen && !editMode && (
              <button className="link-button" onClick={() => goToPly(currentPly)}>
                Return to game position
              </button>
            )}

            {error && (
              <p className="error">
                <AlertCircle size={16} />
                {error}
              </p>
            )}
          </div>

          <div className="panel">
            <h2>Best Moves</h2>
            {(currentAnalysis?.lines ?? []).slice(0, 3).map((line) => (
              <button
                className="line-row"
                key={line.multipv}
                onClick={() => playEngineMove(line.pv[0])}
                onMouseEnter={() => setHoveredBestMove(line.pv[0] ?? null)}
                onMouseLeave={() => setHoveredBestMove(null)}
                disabled={!line.pv[0]}
              >
                <span className="piece-badge">{pieceSymbolForMove(position, line.pv[0])}</span>
                <strong>{line.pv[0] ?? "..."}</strong>
                <span>{toDisplayEval(line.whiteScoreCp)}</span>
                <small>{line.pv.slice(1, 6).join(" ")}</small>
              </button>
            ))}
            {!currentAnalysis?.lines.length && <p className="muted">Run analysis to see Stockfish's top 3 lines. Drag a move on the board to explore your own line.</p>}
          </div>

          <div className="panel">
            <h2>{editMode ? "Edited Position" : exploreFen ? "Exploration Line" : activeReview ? `${activeReview.moveNumber}${activeReview.color === "b" ? "..." : "."} ${activeReview.san}` : "Current Position"}</h2>
            <div className={`classification ${!exploreFen ? activeReview?.label?.toLowerCase() ?? "" : ""}`}>
              {!editMode && !exploreFen && activeReview?.label && <CategoryIcon label={activeReview.label} size={15} />}
              {editMode ? "Editor" : exploreFen ? "Custom" : activeReview?.label ?? "Not analyzed"}
            </div>
            <p className="coach">{editMode ? "Set up any legal position, choose whose turn it is, then run Stockfish analysis." : exploreFen ? "You are off the game line. Use Analyze Position or make more moves to keep exploring with Stockfish." : explainMove(activeReview)}</p>
            {!exploreFen && activeReview && ["Mistake", "Miss", "Blunder"].includes(activeReview.label ?? "") && (
              <button className="secondary retry-button" onClick={() => retryMove(activeReview)}>
                Retry this move
              </button>
            )}
            {retryingMove && (
              <p className="retry-note">
                Retrying {retryingMove.moveNumber}{retryingMove.color === "b" ? "..." : "."} {retryingMove.san}. Make a move on the board.
              </p>
            )}
          </div>

          {reviews.length > 0 && (
            <div className="panel report-panel">
              <h2>Game Report</h2>
              <p>{gameReport.summary}</p>
              <div className="report-columns">
                <div>
                  <strong>{selected?.white ?? "White"}</strong>
                  <span>{gameReport.white}</span>
                </div>
                <div>
                  <strong>{selected?.black ?? "Black"}</strong>
                  <span>{gameReport.black}</span>
                </div>
              </div>
              {gameReport.keyMoments.length > 0 && (
                <div className="key-moments">
                  {gameReport.keyMoments.map((moment) => (
                    <button key={`${moment.index}-${moment.san}`} onClick={() => goToPly(moment.index + 1)}>
                      <CategoryIcon label={moment.label} size={14} />
                      <span>{moment.moveNumber}{moment.color === "b" ? "..." : "."} {moment.san}</span>
                      <strong>{moment.label}</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function tryMove(chess: Chess, from: Square, to: Square) {
  try {
    return chess.move({
      from,
      to,
      promotion: "q"
    });
  } catch {
    return null;
  }
}

function boardPositionFromFen(fen: string): BoardPosition {
  const board: BoardPosition = {};
  const placement = fen.split(" ")[0] ?? "";
  const rows = placement.split("/");

  rows.forEach((row, rowIndex) => {
    let fileIndex = 0;
    for (const char of row) {
      if (/\d/.test(char)) {
        fileIndex += Number(char);
        continue;
      }

      const square = `${"abcdefgh"[fileIndex]}${8 - rowIndex}` as Square;
      const piece = pieceFromFenChar(char);
      if (piece) board[square] = piece;
      fileIndex += 1;
    }
  });

  return board;
}

function fenFromBoardPosition(board: BoardPosition, turn: "w" | "b") {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = "";
    let empty = 0;
    for (const file of "abcdefgh") {
      const piece = board[`${file}${rank}` as Square];
      if (!piece) {
        empty += 1;
        continue;
      }

      if (empty) {
        row += String(empty);
        empty = 0;
      }
      row += fenCharFromPiece(piece);
    }
    rows.push(row + (empty ? String(empty) : ""));
  }

  return `${rows.join("/")} ${turn} - - 0 1`;
}

function applyEditTool(board: BoardPosition, square: Square, tool: Piece | "erase") {
  const next = { ...board };
  if (tool === "erase") {
    delete next[square];
  } else {
    next[square] = tool;
  }
  return next;
}

function moveEditPiece(board: BoardPosition, from: Square, to: Square) {
  const piece = board[from];
  if (!piece) return board;
  if ((piece === "wK" || piece === "bK") && board[to] === `${piece[0]}R` && canCastleEditor(board, from, to)) {
    return castleEditorBoard(board, from, to, piece);
  }
  const next = { ...board, [to]: piece };
  delete next[from];
  return next;
}

function editMoveTargets(board: BoardPosition, square: Square | null, turn: "w" | "b") {
  if (!square) return [];
  const piece = board[square];
  if (!piece || piece[0] !== turn) return [];

  const { file, rank } = squareParts(square);
  const color = piece[0] as "w" | "b";
  const type = piece[1];
  const targets: Square[] = [];
  const add = (target: Square) => {
    const occupant = board[target];
    if (!occupant || occupant[0] !== color) targets.push(target);
  };
  const addStep = (df: number, dr: number) => {
    const target = squareFromParts(file + df, rank + dr);
    if (target) add(target);
  };
  const addRay = (df: number, dr: number) => {
    let nextFile = file + df;
    let nextRank = rank + dr;
    while (true) {
      const target = squareFromParts(nextFile, nextRank);
      if (!target) break;
      const occupant = board[target];
      if (occupant) {
        if (occupant[0] !== color) targets.push(target);
        break;
      }
      targets.push(target);
      nextFile += df;
      nextRank += dr;
    }
  };

  if (type === "P") {
    const direction = color === "w" ? 1 : -1;
    const one = squareFromParts(file, rank + direction);
    if (one && !board[one]) {
      targets.push(one);
      const startRank = color === "w" ? 2 : 7;
      const two = squareFromParts(file, rank + direction * 2);
      if (rank === startRank && two && !board[two]) targets.push(two);
    }
    for (const df of [-1, 1]) {
      const target = squareFromParts(file + df, rank + direction);
      if (target && board[target] && board[target]?.[0] !== color) targets.push(target);
    }
  }

  if (type === "N") {
    for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
      addStep(df, dr);
    }
  }

  if (type === "B" || type === "Q") {
    for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) addRay(df, dr);
  }

  if (type === "R" || type === "Q") {
    for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) addRay(df, dr);
  }

  if (type === "K") {
    for (const [df, dr] of [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]]) {
      addStep(df, dr);
    }
    for (const rookSquare of sameRankRooks(board, square, color)) {
      if (canCastleEditor(board, square, rookSquare)) targets.push(rookSquare);
    }
  }

  return targets;
}

function sameRankRooks(board: BoardPosition, kingSquare: Square, color: "w" | "b") {
  const { rank } = squareParts(kingSquare);
  return Object.entries(board)
    .filter((entry): entry is [Square, Piece] => Boolean(entry[1]))
    .filter(([square, piece]) => piece === `${color}R` && squareParts(square).rank === rank)
    .map(([square]) => square);
}

function canCastleEditor(board: BoardPosition, kingSquare: Square, rookSquare: Square) {
  const king = board[kingSquare];
  const rook = board[rookSquare];
  if (!king || !rook || king[1] !== "K" || rook !== `${king[0]}R`) return false;
  const kingParts = squareParts(kingSquare);
  const rookParts = squareParts(rookSquare);
  if (kingParts.rank !== rookParts.rank) return false;
  const step = rookParts.file > kingParts.file ? 1 : -1;
  for (let file = kingParts.file + step; file !== rookParts.file; file += step) {
    const between = squareFromParts(file, kingParts.rank);
    if (between && board[between]) return false;
  }
  return true;
}

function castleEditorBoard(board: BoardPosition, kingSquare: Square, rookSquare: Square, king: Piece) {
  const next = { ...board };
  const { rank, file: kingFile } = squareParts(kingSquare);
  const rookFile = squareParts(rookSquare).file;
  const kingTarget = squareFromParts(rookFile > kingFile ? 6 : 2, rank);
  const rookTarget = squareFromParts(rookFile > kingFile ? 5 : 3, rank);
  if (!kingTarget || !rookTarget) return board;
  delete next[kingSquare];
  delete next[rookSquare];
  next[kingTarget] = king;
  next[rookTarget] = `${king[0]}R` as Piece;
  return next;
}

function squareParts(square: Square) {
  return {
    file: "abcdefgh".indexOf(square[0]),
    rank: Number(square[1])
  };
}

function squareFromParts(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${"abcdefgh"[file]}${rank}` as Square;
}

function turnFromFen(fen: string): "w" | "b" {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

function validateFenForAnalysis(fen: string) {
  const board = boardPositionFromFen(fen);
  const pieces = Object.values(board);
  if (!pieces.includes("wK") || !pieces.includes("bK")) return "Add both kings before analyzing an edited position.";
  try {
    new Chess(fen);
    return "";
  } catch {
    return "This edited position is not legal enough for Stockfish. Check the kings and side to move.";
  }
}

function pieceFromFenChar(char: string): Piece | null {
  const color = char === char.toUpperCase() ? "w" : "b";
  const type = char.toUpperCase();
  if (!["K", "Q", "R", "B", "N", "P"].includes(type)) return null;
  return `${color}${type}` as Piece;
}

function fenCharFromPiece(piece: Piece) {
  const type = piece[1];
  return piece[0] === "w" ? type : type.toLowerCase();
}

function pieceSymbol(piece: Piece) {
  const symbols: Record<Piece, string> = {
    wP: "♙",
    wN: "♘",
    wB: "♗",
    wR: "♖",
    wQ: "♕",
    wK: "♔",
    bP: "♟",
    bN: "♞",
    bB: "♝",
    bR: "♜",
    bQ: "♛",
    bK: "♚"
  };
  return symbols[piece];
}

function bestMoveArrows(analysis?: PositionAnalysis | null, hoveredMove?: string | null): Arrow[] {
  const colors = ["#2f9e44", "#f08c00", "#1971c2"];
  return (analysis?.lines ?? [])
    .slice(0, 3)
    .flatMap((line, index) => {
      const move = line.pv[0];
      if (!move || move.length < 4) return [];
      const from = move.slice(0, 2) as Square;
      const to = move.slice(2, 4) as Square;
      if (move === hoveredMove) {
        return [[from, to, `${colors[index]}ff`] as Arrow];
      }
      return [[from, to, `${colors[index]}88`] as Arrow];
    });
}

function reviewRecap(reviews: ReviewedPly[]) {
  return reviews.reduce<Record<string, number>>((counts, review) => {
    if (review.label) counts[review.label] = (counts[review.label] ?? 0) + 1;
    return counts;
  }, {});
}

function reviewRecapByColor(reviews: ReviewedPly[]) {
  return reviews.reduce<{ w: Record<string, number>; b: Record<string, number> }>(
    (counts, review) => {
      if (review.label) counts[review.color][review.label] = (counts[review.color][review.label] ?? 0) + 1;
      return counts;
    },
    { w: {}, b: {} }
  );
}

function playerPerformance(reviews: ReviewedPly[], selected: GameSummary | null) {
  return {
    w: performanceEloFor(reviews.filter((review) => review.color === "w"), selected?.whiteElo),
    b: performanceEloFor(reviews.filter((review) => review.color === "b"), selected?.blackElo)
  };
}

function playerAccuracyScores(reviews: ReviewedPly[]) {
  return {
    w: accuracyPercent(reviews.filter((review) => review.color === "w")),
    b: accuracyPercent(reviews.filter((review) => review.color === "b"))
  };
}

function accuracyPercent(reviews: ReviewedPly[]) {
  const losses = reviews.map((review) => review.loss).filter((loss): loss is number => loss !== undefined);
  if (!losses.length) return 0;
  return Math.round(moveAccuracy(losses));
}

function phaseRatings(reviews: ReviewedPly[], selected: GameSummary | null) {
  const total = reviews.length;
  const phases = {
    opening: reviews.filter((review) => review.index < 16),
    middlegame: reviews.filter((review) => review.index >= 16 && review.index < Math.max(16, total - 16)),
    endgame: reviews.filter((review) => review.index >= Math.max(16, total - 16))
  };
  return {
    w: {
      opening: performanceEloFor(phases.opening.filter((review) => review.color === "w"), selected?.whiteElo),
      middlegame: performanceEloFor(phases.middlegame.filter((review) => review.color === "w"), selected?.whiteElo),
      endgame: performanceEloFor(phases.endgame.filter((review) => review.color === "w"), selected?.whiteElo)
    },
    b: {
      opening: performanceEloFor(phases.opening.filter((review) => review.color === "b"), selected?.blackElo),
      middlegame: performanceEloFor(phases.middlegame.filter((review) => review.color === "b"), selected?.blackElo),
      endgame: performanceEloFor(phases.endgame.filter((review) => review.color === "b"), selected?.blackElo)
    }
  };
}

function performanceEloFor(reviews: ReviewedPly[], baseRating?: number) {
  const losses = reviews.map((review) => review.loss).filter((loss): loss is number => loss !== undefined);
  if (!losses.length) return 0;
  const accuracy = moveAccuracy(losses);
  const baseline = baseRating ?? ratingFromAccuracy(accuracy);
  const expected = expectedAccuracyForRating(baseline);
  const badMoves = reviews.filter((review) => ["Mistake", "Blunder"].includes(review.label ?? "")).length;
  const brilliants = reviews.filter((review) => review.label === "Brilliant").length;
  const raw = baseline + (accuracy - expected) * 34 + brilliants * 35 - badMoves * 18;
  return Math.round(Math.max(400, Math.min(2800, raw)) / 10) * 10;
}

function moveAccuracy(losses: number[]) {
  const scores = losses.map((loss) => 100 * Math.exp(-Math.min(loss, 700) / 140));
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function expectedAccuracyForRating(rating: number) {
  return 50 + 42 * (1 - Math.exp(-Math.max(100, rating) / 1750));
}

function ratingFromAccuracy(accuracy: number) {
  return 400 + Math.pow(Math.max(0, Math.min(100, accuracy)) / 100, 2.15) * 2300;
}

function buildGameReport(reviews: ReviewedPly[], selected: GameSummary | null) {
  const ratings = playerPerformance(reviews, selected);
  const whiteBad = reviews.filter((review) => review.color === "w" && ["Mistake", "Blunder"].includes(review.label ?? "")).length;
  const blackBad = reviews.filter((review) => review.color === "b" && ["Mistake", "Blunder"].includes(review.label ?? "")).length;
  const whiteBest = reviews.filter((review) => review.color === "w" && ["Brilliant", "Great", "Best"].includes(review.label ?? "")).length;
  const blackBest = reviews.filter((review) => review.color === "b" && ["Brilliant", "Great", "Best"].includes(review.label ?? "")).length;
  const keyMoments = reviews
    .filter((review) => ["Brilliant", "Great", "Mistake", "Blunder"].includes(review.label ?? ""))
    .sort((a, b) => (b.loss ?? 0) - (a.loss ?? 0))
    .slice(0, 4);

  const leader =
    Math.abs(ratings.w - ratings.b) < 4
      ? "Both players had a comparable level of precision."
      : ratings.w > ratings.b
        ? `${selected?.white ?? "White"} was more precise overall.`
        : `${selected?.black ?? "Black"} was more precise overall.`;

  return {
    summary: `${leader} The review found ${whiteBad + blackBad} major missed chances and ${whiteBest + blackBest} high-quality moves.`,
    white: playerReportText(ratings.w, whiteBad, whiteBest),
    black: playerReportText(ratings.b, blackBad, blackBest),
    keyMoments
  };
}

function playerReportText(rating: number, badMoves: number, bestMoves: number) {
  if (rating >= 2200) return `Excellent control with ${bestMoves} strong moves and very few serious errors.`;
  if (rating >= 1700) return `Solid game. ${badMoves ? `${badMoves} major mistake${badMoves > 1 ? "s" : ""} should be reviewed.` : "No major tactical collapse stood out."}`;
  if (rating >= 1100) return `Uneven execution. The key improvement is reducing the ${badMoves} costly mistake${badMoves === 1 ? "" : "s"}.`;
  return `This game had several tactical problems. Start by reviewing the largest eval swings and the first blunder.`;
}

function squareHighlights(
  review?: ReviewedPly,
  selectedSquare?: Square | null,
  legalTargets: Square[] = [],
  checkmateSquare?: Square | null
) {
  const styles: Partial<Record<Square, Record<string, string | number>>> = {};

  if (review?.uci.length && review.uci.length >= 4) {
    const color = labelColor(review.label);
    styles[review.uci.slice(2, 4) as Square] = {
      backgroundColor: color,
      backgroundImage: `url("${categoryBadgeDataUri(review.label)}")`,
      backgroundPosition: "4px 4px",
      backgroundRepeat: "no-repeat",
      backgroundSize: "18px 18px"
    };
  }

  if (selectedSquare) {
    styles[selectedSquare] = {
      ...(styles[selectedSquare] ?? {}),
      boxShadow: "inset 0 0 0 4px rgba(255, 255, 255, 0.72)"
    };
  }

  for (const square of legalTargets) {
    styles[square] = {
      ...(styles[square] ?? {}),
      backgroundImage: `${styles[square]?.backgroundImage ? `${styles[square]?.backgroundImage}, ` : ""}radial-gradient(circle, rgba(31, 111, 80, 0.42) 18%, transparent 20%)`
    };
  }

  if (checkmateSquare) {
    styles[checkmateSquare] = {
      ...(styles[checkmateSquare] ?? {}),
      animation: "matePulse 0.9s ease-in-out infinite",
      backgroundColor: "rgba(224, 49, 49, 0.62)",
      boxShadow: "inset 0 0 0 5px rgba(255, 255, 255, 0.78), 0 0 22px rgba(224, 49, 49, 0.9)"
    };
  }

  return styles;
}

function checkmateKingSquare(fen: string) {
  if (!fen || fen === "start") return null;
  try {
    const chess = new Chess(fen);
    if (!chess.isCheckmate()) return null;
    const matedColor = chess.turn();
    for (const file of "abcdefgh") {
      for (let rank = 1; rank <= 8; rank += 1) {
        const square = `${file}${rank}` as Square;
        const piece = chess.get(square);
        if (piece?.type === "k" && piece.color === matedColor) return square;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function legalMoveTargets(fen: string, square: Square | null) {
  if (!square || !fen || fen === "start") return [];
  try {
    return new Chess(fen).moves({ square, verbose: true }).map((move) => move.to as Square);
  } catch {
    return [];
  }
}

function labelColor(label?: string) {
  switch (label) {
    case "Brilliant":
      return "rgba(173, 232, 244, 0.48)";
    case "Great":
      return "rgba(51, 154, 240, 0.46)";
    case "Best":
      return "rgba(25, 113, 50, 0.44)";
    case "Good":
      return "rgba(116, 184, 22, 0.42)";
    case "Ok":
      return "rgba(178, 242, 187, 0.44)";
    case "Book":
      return "rgba(176, 104, 35, 0.44)";
    case "Inaccuracy":
      return "rgba(255, 224, 102, 0.48)";
    case "Mistake":
      return "rgba(247, 103, 7, 0.48)";
    case "Miss":
      return "rgba(156, 84, 213, 0.48)";
    case "Blunder":
      return "rgba(224, 49, 49, 0.5)";
    default:
      return "rgba(47, 158, 68, 0.6)";
  }
}

function categoryBadgeDataUri(label?: string) {
  const icon = categoryGlyph(label);
  const color = labelColor(label).replace(/0\.\d+\)/, "1)");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'><circle cx='11' cy='11' r='10' fill='white' stroke='${color}' stroke-width='2'/><text x='11' y='15' text-anchor='middle' font-size='12' font-family='Arial' font-weight='700' fill='${color}'>${icon}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function categoryGlyph(label?: string) {
  switch (label) {
    case "Brilliant":
      return "!!";
    case "Great":
      return "!";
    case "Best":
      return "★";
    case "Good":
      return "✓";
    case "Ok":
      return "○";
    case "Book":
      return "📖";
    case "Inaccuracy":
      return "?!";
    case "Mistake":
      return "?";
    case "Miss":
      return "↯";
    case "Blunder":
      return "??";
    default:
      return "";
  }
}

function evaluationPoints(totalPlies: number, reviews: ReviewedPly[]) {
  const points: Array<{ ply: number; value: number; label?: string }> = [{ ply: 0, value: reviews[0]?.before?.lines[0]?.whiteScoreCp ?? 0 }];
  for (let index = 0; index < totalPlies; index += 1) {
    points.push({
      ply: index + 1,
      value: reviews[index]?.after?.lines[0]?.whiteScoreCp ?? points[points.length - 1].value,
      label: reviews[index]?.label
    });
  }
  return points;
}

function EvalGraph({
  points,
  currentPly,
  onSelectPly
}: {
  points: Array<{ ply: number; value: number; label?: string }>;
  currentPly: number;
  onSelectPly: (ply: number) => void;
}) {
  const width = 760;
  const height = 124;
  const clamped = points.map((point) => ({ ...point, value: Math.max(-600, Math.min(600, point.value)) }));
  const maxPly = Math.max(1, clamped[clamped.length - 1]?.ply ?? 1);
  const currentX = (currentPly / maxPly) * width;
  const markers = clamped.filter((point) => point.label && !["Book", "Ok"].includes(point.label));

  return (
    <div className="eval-graph">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Evaluation graph"
        shapeRendering="geometricPrecision"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          onSelectPly(Math.round((x / rect.width) * maxPly));
        }}
      >
        <defs>
          <clipPath id="evalGraphClip">
            <rect x="0" y="0" width={width} height={height} rx="14" />
          </clipPath>
        </defs>
        <g clipPath="url(#evalGraphClip)">
          {clamped.slice(1).map((point, index) => {
            const previous = clamped[index];
            const x = (previous.ply / maxPly) * width;
            const nextX = (point.ply / maxPly) * width;
            const segmentWidth = Math.max(1, nextX - x) + 0.75;
            const whiteHeight = whiteShare(point.value) * height;
            return (
              <g key={point.ply}>
                <rect x={Math.max(0, x - 0.35)} y="0" width={segmentWidth} height={height - whiteHeight} className="graph-black" />
                <rect x={Math.max(0, x - 0.35)} y={height - whiteHeight} width={segmentWidth} height={whiteHeight} className="graph-white" />
              </g>
            );
          })}
          <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="graph-zero" />
        </g>
        {markers.map((point) => (
          <circle
            key={`${point.ply}-${point.label}`}
            cx={(point.ply / maxPly) * width}
            cy={height - whiteShare(point.value) * height}
            r="5.5"
            fill={solidLabelColor(point.label)}
            stroke="var(--panel)"
            strokeWidth="2"
          />
        ))}
        <line x1={currentX} y1="4" x2={currentX} y2={height - 4} className="graph-current" />
      </svg>
    </div>
  );
}

function whiteShare(cp: number) {
  return Math.max(0.05, Math.min(0.95, 0.5 + cp / 1200));
}

function solidLabelColor(label?: string) {
  switch (label) {
    case "Brilliant":
      return "#ade8f4";
    case "Great":
      return "#339af0";
    case "Best":
      return "#145c32";
    case "Good":
      return "#2f9e44";
    case "Ok":
      return "#b2f2bb";
    case "Book":
      return "#b06823";
    case "Inaccuracy":
      return "#ffe066";
    case "Mistake":
      return "#f76707";
    case "Miss":
      return "#9c54d5";
    case "Blunder":
      return "#e03131";
    default:
      return "#1f6f50";
  }
}

function detectOpening(plies: ReviewedPly[] | Array<{ san: string }>) {
  const line = plies.slice(0, 8).map((ply) => ply.san.replace(/[+#?!]+/g, "")).join(" ");
  const openings = [
    { eco: "C60", name: "Ruy Lopez", pattern: "e4 e5 Nf3 Nc6 Bb5" },
    { eco: "C50", name: "Italian Game", pattern: "e4 e5 Nf3 Nc6 Bc4" },
    { eco: "B20", name: "Sicilian Defense", pattern: "e4 c5" },
    { eco: "B01", name: "Scandinavian Defense", pattern: "e4 d5" },
    { eco: "C00", name: "French Defense", pattern: "e4 e6" },
    { eco: "B10", name: "Caro-Kann Defense", pattern: "e4 c6" },
    { eco: "D00", name: "Queen's Pawn Game", pattern: "d4 d5" },
    { eco: "D06", name: "Queen's Gambit", pattern: "d4 d5 c4" },
    { eco: "A40", name: "Indian Defense", pattern: "d4 Nf6" },
    { eco: "A00", name: "Flank Opening", pattern: "Nf3" }
  ];
  return openings.find((opening) => line.startsWith(opening.pattern)) ?? { eco: "ECO", name: "Unclassified Opening" };
}

function PlayerName({ name, color, result }: { name: string; color: "white" | "black"; result?: string }) {
  const won = (color === "white" && result === "1-0") || (color === "black" && result === "0-1");
  return (
    <span className={`player-name ${won ? "winner" : ""}`}>
      <span className={`color-dot ${color}`}></span>
      {name}
    </span>
  );
}

function useBoardSize() {
  const [size, setSize] = useState(() => Math.min(720, Math.max(420, window.innerWidth - 720)));

  useEffect(() => {
    function update() {
      const isDesktop = window.innerWidth >= 1280;
      const availableWidth = isDesktop ? window.innerWidth - 900 : window.innerWidth - 40;
      const availableHeight = isDesktop ? window.innerHeight - 110 : window.innerHeight - 260;
      setSize(Math.floor(Math.max(360, Math.min(780, availableWidth, availableHeight))));
    }

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return size;
}

function CategoryIcon({ label, size = 16 }: { label?: string; size?: number }) {
  switch (label) {
    case "Brilliant":
      return <Award size={size} />;
    case "Great":
      return <Zap size={size} />;
    case "Best":
      return <Star size={size} />;
    case "Good":
      return <ThumbsUp size={size} />;
    case "Ok":
      return <CheckCircle2 size={size} />;
    case "Book":
      return <BookOpen size={size} />;
    case "Inaccuracy":
      return <AlertCircle size={size} />;
    case "Mistake":
      return <Flame size={size} />;
    case "Miss":
      return <AlertCircle size={size} />;
    case "Blunder":
      return <XOctagon size={size} />;
    default:
      return <Circle size={size} />;
  }
}

function GameIcon({ game }: { game: GameSummary }) {
  const timeClass = game.timeClass?.toLowerCase() ?? "";
  if (timeClass.includes("bullet")) return <Zap size={15} />;
  if (timeClass.includes("blitz")) return <Timer size={15} />;
  if (timeClass.includes("rapid")) return <Clock size={15} />;
  if (timeClass.includes("daily")) return <CalendarDays size={15} />;
  return game.source === "chess.com" ? <Circle size={15} /> : <UploadCloud size={15} />;
}

function formatTimeControl(game: GameSummary) {
  const label = game.timeClass ? titleCase(game.timeClass) : game.source === "chess.com" ? "Chess.com" : "Import";
  if (!game.timeControl) return label;
  return `${label} ${formatClock(game.timeControl)}`;
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatClock(value: string) {
  const [base, increment] = value.split("+");
  if (!base || Number.isNaN(Number(base))) return value;
  const minutes = Math.floor(Number(base) / 60);
  const seconds = Number(base) % 60;
  const main = minutes ? `${minutes}${seconds ? `:${String(seconds).padStart(2, "0")}` : ""}` : `${seconds}s`;
  return increment ? `${main}+${increment}` : main;
}

function formatMoveClock(value: string) {
  const parts = value.split(":");
  if (parts.length <= 2) return value;
  const [hours, minutes, seconds] = parts;
  return hours === "0" ? `${minutes}:${seconds.padStart(2, "0")}` : value;
}

function pieceSymbolForMove(fen: string, uci?: string) {
  if (!uci || uci.length < 2 || !fen || fen === "start") return "";
  try {
    const piece = new Chess(fen).get(uci.slice(0, 2) as Square);
    if (!piece) return "";
    const symbols: Record<string, string> = {
      wp: "♙",
      wn: "♘",
      wb: "♗",
      wr: "♖",
      wq: "♕",
      wk: "♔",
      bp: "♟",
      bn: "♞",
      bb: "♝",
      br: "♜",
      bq: "♛",
      bk: "♚"
    };
    return symbols[`${piece.color}${piece.type}`] ?? "";
  } catch {
    return "";
  }
}
