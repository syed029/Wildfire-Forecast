// ESN runner: spawns a worker and ensures deterministic seeding per series
export class ESNRunner {
  constructor(workerUrl) {
    this.workerUrl = workerUrl;
  }

  /**
   * Fit and predict y for a given series key.
   * @param {string} key   - unique series key (use "S:CA" or "C:CA|06037")
   * @param {number[]} y   - history values
   * @param {object} hyper - hyperparameters
   * @returns {Promise<{yfit:number[], yhat:number[], H:number}>}
   */
  fitPredict(key, y, hyper) {
    const seed = hash32(key + "|" + JSON.stringify(hyper || {})); // stable across reloads
    return this._call({ fn: "fit_predict", key, y, hyper, seed });
  }

  _call(payload) {
    return new Promise((resolve, reject) => {
      const w = new Worker(this.workerUrl, { type: "module" });
      w.onmessage = (e) => { w.terminate(); resolve(e.data || {}); };
      w.onerror   = (e) => { w.terminate(); reject(e.message || String(e?.error || e)); };
      w.postMessage(payload);
    });
  }
}

// Simple fast 32-bit string hash (FNV-1a-like)
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
