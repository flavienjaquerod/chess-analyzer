import type { GameSummary } from "./chessData";

type ChessComArchive = {
  archives: string[];
};

type ChessComGame = {
  url: string;
  pgn?: string;
  white: { username: string };
  black: { username: string };
  end_time?: number;
  time_class?: string;
  time_control?: string;
};

type ChessComMonth = {
  games: ChessComGame[];
};

export async function fetchChessComGames(username: string, maxGames: number) {
  const clean = username.trim().replace(/^@/, "").toLowerCase();
  if (!clean) throw new Error("Enter a Chess.com username.");

  await chessComJsonp(`https://api.chess.com/pub/player/${encodeURIComponent(clean)}`, `Chess.com username "${clean}" was not found.`);

  const archiveData = await chessComJsonp<ChessComArchive>(
    `https://api.chess.com/pub/player/${encodeURIComponent(clean)}/games/archives`,
    `No public Chess.com games were found for "${clean}".`
  );
  if (!Array.isArray(archiveData.archives) || archiveData.archives.length === 0) {
    throw new Error(`No public Chess.com games were found for "${clean}".`);
  }

  const archives = archiveData.archives.slice().reverse();
  const games: GameSummary[] = [];

  for (const archiveUrl of archives) {
    if (games.length >= maxGames) break;
    const month = await chessComJsonp<ChessComMonth>(archiveUrl);
    for (const game of month.games.slice().reverse()) {
      if (!game.pgn) continue;
      games.push({
        id: game.url,
        source: "chess.com",
        white: game.white.username,
        black: game.black.username,
        result: readResult(game.pgn),
        date: game.end_time ? new Date(game.end_time * 1000).toISOString().slice(0, 10) : "",
        timeClass: game.time_class,
        timeControl: game.time_control,
        whiteElo: readRating(game.pgn, "WhiteElo"),
        blackElo: readRating(game.pgn, "BlackElo"),
        pgn: game.pgn
      });

      if (games.length >= maxGames) break;
    }
  }

  if (!games.length) {
    throw new Error(`No public Chess.com games with PGN were found for "${clean}".`);
  }

  return games;
}

function chessComJsonp<T>(url: string, loadError = "Could not load Chess.com public game data.") {
  return new Promise<T>((resolve, reject) => {
    const callback = `__chessReview_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const separator = url.includes("?") ? "&" : "?";
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Chess.com did not respond. Try again in a moment."));
    }, 15000);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[callback];
    }

    (window as unknown as Record<string, (data: T) => void>)[callback] = (data: T) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(loadError));
    };

    script.src = `${url}${separator}callback=${encodeURIComponent(callback)}`;
    document.body.appendChild(script);
  });
}

function readResult(pgn: string) {
  return /\[Result "([^"]+)"\]/.exec(pgn)?.[1] ?? "*";
}

function readRating(pgn: string, tag: string) {
  const rating = Number(new RegExp(`\\[${tag} "([^"]+)"\\]`).exec(pgn)?.[1]);
  return Number.isFinite(rating) ? rating : undefined;
}
