export type EngineLine = {
  multipv: number;
  depth: number;
  scoreCp: number | null;
  mate: number | null;
  whiteScoreCp: number;
  pv: string[];
};

export type PositionAnalysis = {
  fen: string;
  lines: EngineLine[];
  bestMove: string | null;
};

const ANALYSIS_API = import.meta.env.VITE_ANALYSIS_API ?? "http://127.0.0.1:8787";

export class StockfishClient {
  private queue: Promise<unknown> = Promise.resolve();

  analyze(fen: string, depth: number, multiPv = 3) {
    this.queue = this.queue.catch(() => undefined).then(() => this.search(fen, depth, multiPv));
    return this.queue as Promise<PositionAnalysis>;
  }

  dispose() {}

  private async search(fen: string, depth: number, multiPv: number) {
    const response = await fetch(`${ANALYSIS_API}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fen, depth, multiPv })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? `Analysis server returned ${response.status}.`);
    }

    if (!payload?.lines?.length) {
      throw new Error("Analysis server returned no engine lines.");
    }

    return payload as PositionAnalysis;
  }
}
