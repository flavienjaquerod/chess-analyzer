const http = require("node:http");
const initStockfish = require("stockfish");
const { Chess } = require("chess.js");

const PORT = Number(process.env.PORT || 8787);
const ENGINE = process.env.STOCKFISH_ENGINE || "lite-single";
const MAX_DEPTH = 23;
const MAX_MULTIPV = 5;

let enginePromise;
let searchQueue = Promise.resolve();
let currentSearch = null;

function sideToMove(fen) {
  return fen.split(" ")[1];
}

function scoreToWhite(scoreCp, mate, fen) {
  const raw = mate !== null ? (mate > 0 ? 100000 - mate : -100000 - mate) : scoreCp ?? 0;
  return sideToMove(fen) === "w" ? raw : -raw;
}

function parseInfo(line, fen) {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return null;

  const tokens = line.split(/\s+/);
  const depthIdx = tokens.indexOf("depth");
  const multipvIdx = tokens.indexOf("multipv");
  const scoreIdx = tokens.indexOf("score");
  const pvIdx = tokens.indexOf("pv");

  if (depthIdx < 0 || scoreIdx < 0 || pvIdx < 0) return null;

  const depth = Number(tokens[depthIdx + 1]);
  const multipv = multipvIdx >= 0 ? Number(tokens[multipvIdx + 1]) : 1;
  const scoreType = tokens[scoreIdx + 1];
  const scoreValue = Number(tokens[scoreIdx + 2]);
  const scoreCp = scoreType === "cp" ? scoreValue : null;
  const mate = scoreType === "mate" ? scoreValue : null;
  const pv = tokens.slice(pvIdx + 1);

  return {
    multipv,
    depth,
    scoreCp,
    mate,
    whiteScoreCp: scoreToWhite(scoreCp, mate, fen),
    pv
  };
}

async function getEngine() {
  if (!enginePromise) {
    enginePromise = initStockfish(ENGINE).then((engine) => {
      engine.listener = (line) => {
        if (!currentSearch) return;

        const text = String(line);
        const parsed = parseInfo(text, currentSearch.fen);
        if (parsed) {
          const previous = currentSearch.latest.get(parsed.multipv);
          if (!previous || parsed.depth >= previous.depth) {
            currentSearch.latest.set(parsed.multipv, parsed);
          }
        }

        if (text.startsWith("bestmove ")) {
          finishSearch(text.split(/\s+/)[1] || null);
        }
      };

      engine.sendCommand("uci");
      engine.sendCommand("setoption name Hash value 64");
      return engine;
    });
  }

  return enginePromise;
}

function finishSearch(bestMove) {
  if (!currentSearch) return;

  const search = currentSearch;
  clearTimeout(search.timer);
  currentSearch = null;

  const lines = [...search.latest.values()].sort((a, b) => a.multipv - b.multipv);
  if (!lines.length) {
    search.reject(new Error("Stockfish returned no analysis for this position."));
    return;
  }

  search.resolve({
    fen: search.fen,
    bestMove: bestMove || lines[0].pv[0] || null,
    lines
  });
}

function analyzeFen(fen, depth, multiPv) {
  searchQueue = searchQueue.catch(() => undefined).then(async () => {
    const terminal = terminalAnalysis(fen);
    if (terminal) return terminal;

    const engine = await getEngine();

    return new Promise((resolve, reject) => {
      const safeDepth = clamp(Number(depth) || 12, 1, MAX_DEPTH);
      const safeMultiPv = clamp(Number(multiPv) || 3, 1, MAX_MULTIPV);
      const timer = setTimeout(() => {
        if (!currentSearch) return;

        engine.sendCommand("stop");
        const search = currentSearch;
        currentSearch = null;
        const lines = [...search.latest.values()].sort((a, b) => a.multipv - b.multipv);

        if (lines.length) {
          resolve({ fen: search.fen, bestMove: lines[0].pv[0] || null, lines });
        } else {
          reject(new Error(`Stockfish timed out at depth ${safeDepth}. Try a lower depth.`));
        }
      }, Math.max(10000, safeDepth * 3500));

      currentSearch = {
        fen,
        latest: new Map(),
        resolve,
        reject,
        timer
      };

      engine.sendCommand(`setoption name MultiPV value ${safeMultiPv}`);
      engine.sendCommand(`position fen ${fen}`);
      engine.sendCommand(`go depth ${safeDepth}`);
    });
  });

  return searchQueue;
}

function terminalAnalysis(fen) {
  const chess = new Chess(fen);
  if (!chess.isGameOver()) return null;

  let whiteScoreCp = 0;
  let mate = null;
  if (chess.isCheckmate()) {
    const whiteToMove = sideToMove(fen) === "w";
    whiteScoreCp = whiteToMove ? -100000 : 100000;
    mate = whiteToMove ? -1 : 1;
  }

  return {
    fen,
    bestMove: null,
    lines: [
      {
        multipv: 1,
        depth: 0,
        scoreCp: chess.isCheckmate() ? null : 0,
        mate,
        whiteScoreCp,
        pv: []
      }
    ]
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, engine: ENGINE });
    return;
  }

  if (req.method === "POST" && req.url === "/analyze") {
    try {
      const body = await readJson(req);
      if (!body.fen || typeof body.fen !== "string") {
        sendJson(res, 400, { error: "Missing FEN." });
        return;
      }

      const analysis = await analyzeFen(body.fen, body.depth, body.multiPv);
      sendJson(res, 200, analysis);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Analysis failed." });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found." });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Stockfish analysis server listening on http://127.0.0.1:${PORT}`);
});
