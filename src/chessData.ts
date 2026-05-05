import { Chess, Move } from "chess.js";
import type { PositionAnalysis } from "./stockfish";

export type GameSummary = {
  id: string;
  source: "chess.com" | "import";
  white: string;
  black: string;
  result: string;
  date: string;
  timeClass?: string;
  timeControl?: string;
  whiteElo?: number;
  blackElo?: number;
  pgn: string;
};

export type Ply = {
  index: number;
  moveNumber: number;
  color: "w" | "b";
  san: string;
  uci: string;
  beforeFen: string;
  afterFen: string;
};

export type ReviewedPly = Ply & {
  before?: PositionAnalysis;
  after?: PositionAnalysis;
  loss?: number;
  label?: string;
  idea?: string;
};

export const REVIEW_LABELS = ["Brilliant", "Great", "Best", "Good", "Ok", "Book", "Inaccuracy", "Mistake", "Miss", "Blunder"] as const;

export function parsePgn(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const headers = chess.header();
  const moves = chess.history({ verbose: true }) as Move[];
  const replay = new Chess();
  const plies: Ply[] = [];

  for (const move of moves) {
    const beforeFen = replay.fen();
    const played = replay.move(move.san);
    const afterFen = replay.fen();
    plies.push({
      index: plies.length,
      moveNumber: Math.ceil((plies.length + 1) / 2),
      color: move.color,
      san: played.san,
      uci: `${played.from}${played.to}${played.promotion ?? ""}`,
      beforeFen,
      afterFen
    });
  }

  return {
    headers,
    initialFen: new Chess().fen(),
    finalFen: chess.fen(),
    plies
  };
}

export function gameSummaryFromPgn(pgn: string, source: GameSummary["source"] = "import", fallbackId?: string): GameSummary {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const headers = chess.header();
  return {
    id: fallbackId ?? crypto.randomUUID(),
    source,
    white: headers.White ?? "White",
    black: headers.Black ?? "Black",
    result: headers.Result ?? "*",
    date: headers.Date ?? "",
    timeControl: headers.TimeControl ?? undefined,
    whiteElo: parseOptionalRating(headers.WhiteElo),
    blackElo: parseOptionalRating(headers.BlackElo),
    pgn
  };
}

function parseOptionalRating(value?: string | null) {
  if (!value) return undefined;
  const rating = Number(value);
  return Number.isFinite(rating) ? rating : undefined;
}

export function toDisplayEval(cp?: number) {
  if (cp === undefined || !Number.isFinite(cp)) return "0.00";
  if (Math.abs(cp) > 90000) return cp > 0 ? "M" : "-M";
  return (cp / 100).toFixed(2);
}

export function classifyMove(ply: Ply, loss: number, bestMove?: string, evalGain = 0) {
  const playedBest = bestMove === ply.uci;

  if (ply.index < 12 && loss < 20) return "Book";
  if (evalGain > 180 && loss < 35 && !playedBest) return "Brilliant";
  if (!playedBest && evalGain > 80 && loss < 30) return "Great";
  if (loss < 18) return "Best";
  if (loss < 55) return "Good";
  if (loss < 100) return "Ok";
  if (loss < 180) return "Inaccuracy";
  if (loss < 320) return evalGain < -80 ? "Miss" : "Mistake";
  return "Blunder";
}

export function moveIdea(line?: string[]) {
  if (!line?.length) return "No principal variation was returned for this move.";
  const first = line[0];
  const continuation = line.slice(1, 5).join(" ");
  if (!continuation) return `Stockfish wants ${first}.`;
  return `Stockfish starts with ${first}, aiming for the line ${continuation}.`;
}

export function explainMove(review?: ReviewedPly) {
  if (!review?.before?.lines.length || review.loss === undefined) {
    return "Run analysis to compare this move against Stockfish's top choices.";
  }

  const best = review.before.lines[0];
  const bestMove = best.pv[0] ?? review.before.bestMove ?? "the engine move";
  if (["Best", "Book", "Brilliant", "Great"].includes(review.label ?? "")) {
    return `This matches the engine preference. The main point is ${moveIdea(best.pv)}`;
  }

  const swing = (review.loss / 100).toFixed(2);
  return `${review.san} gives up about ${swing} pawns compared with ${bestMove}. ${moveIdea(best.pv)}`;
}
