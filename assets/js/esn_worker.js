// Minimal ESN implementation with deterministic seeded RNG
// Trains one-step-ahead (fit) and generates multi-step forecast (yhat)

self.onmessage = (e) => {
  const { fn } = e.data || {};
  if (fn === "fit_predict") return fitPredict(e.data).then(postResult).catch(postErr);
};

// ---------- Seeded RNG (sfc32) ----------
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    var t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    d = (d + 1) | 0;
    t = (t + d) | 0;
    return (t >>> 0) / 4294967296;
  };
}
function splitSeed(u32) {
  let a = (u32 ^ 0x9e3779b9) >>> 0;
  let b = Math.imul(u32, 0x85ebca6b) >>> 0;
  let c = Math.imul(u32, 0xc2b2ae35) >>> 0;
  let d = (u32 ^ 0x27d4eb2f) >>> 0;
  return [a, b, c, d];
}

// ---------- Math helpers ----------
const tanh = (x) => Math.tanh(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const EPS = 1e-12;

// ---------- Scaling (identity | log1p) ----------
function scaleForward(y, scale) {
  if (scale === "log1p") return y.map(v => Math.log1p(Math.max(0, v || 0)));
  return y.slice();
}
function scaleInverse(z, scale) {
  if (scale === "log1p") return z.map(v => Math.max(0, Math.expm1(v)));
  return z.slice();
}

// ---------- Ridge regression via normal equations (X^T X + λI)β = X^T y ----------
function ridgeSolve(X, y, ridge) {
  const n = X.length, k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Float64Array(k));
  const Xty = new Float64Array(k);

  for (let i = 0; i < n; i++) {
    const xi = X[i];
    const yi = y[i];
    for (let c = 0; c < k; c++) {
      Xty[c] += xi[c] * yi;
      const xic = xi[c];
      for (let d = c; d < k; d++) XtX[c][d] += xic * xi[d];
    }
  }
  for (let c = 0; c < k; c++) {
    for (let d = 0; d < c; d++) XtX[c][d] = XtX[d][c];
    XtX[c][c] += ridge;
  }

  // Solve A b = Xty (Gaussian elimination)
  // Build augmented matrix [A | b]
  const A = XtX.map((row, i) => {
    const r = new Float64Array(k + 1);
    for (let j = 0; j < k; j++) r[j] = row[j];
    r[k] = Xty[i];
    return r;
  });

  for (let col = 0; col < k; col++) {
    // pivot
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) { const tmp = A[col]; A[col] = A[piv]; A[piv] = tmp; }

    const lead = A[col][col] || EPS;
    // normalize
    for (let j = col; j <= k; j++) A[col][j] /= lead;

    // eliminate
    for (let r = 0; r < k; r++) if (r !== col) {
      const f = A[r][col];
      if (f === 0) continue;
      for (let j = col; j <= k; j++) A[r][j] -= f * A[col][j];
    }
  }
  const beta = new Float64Array(k);
  for (let i = 0; i < k; i++) beta[i] = A[i][k];
  return beta;
}

// ---------- Build reservoir (deterministic) ----------
function buildReservoir(Nh, sparsity, inputScale, spectralRadius, rng) {
  // Input weights (for 1D input): Win[i]
  const Win = new Float64Array(Nh);
  for (let i = 0; i < Nh; i++) Win[i] = (rng() * 2 - 1) * inputScale;

  // Recurrent weights W (sparse)
  const W = Array.from({ length: Nh }, () => new Float64Array(Nh));
  for (let r = 0; r < Nh; r++) {
    for (let c = 0; c < Nh; c++) {
      if (rng() < sparsity) W[r][c] = (rng() * 2 - 1);
    }
  }

  // Scale to desired spectral radius using power iteration (fixed iters, fixed start)
  let v = new Float64Array(Nh); for (let i = 0; i < Nh; i++) v[i] = 1;
  for (let it = 0; it < 20; it++) {
    const nv = new Float64Array(Nh);
    for (let r = 0; r < Nh; r++) {
      let s = 0; const row = W[r];
      for (let c = 0; c < Nh; c++) s += row[c] * v[c];
      nv[r] = s;
    }
    // normalize
    let norm = 0; for (let i = 0; i < Nh; i++) norm += nv[i] * nv[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < Nh; i++) v[i] = nv[i] / norm;
  }
  // Rayleigh quotient
  let num = 0, den = 0;
  for (let r = 0; r < Nh; r++) {
    const row = W[r];
    let s = 0;
    for (let c = 0; c < Nh; c++) s += row[c] * v[c];
    num += v[r] * s; den += v[r] * v[r];
  }
  const sr = Math.abs(num / (den || 1)) || 1;
  const scale = (spectralRadius || 0.95) / (sr || 1);
  for (let r = 0; r < Nh; r++) for (let c = 0; c < Nh; c++) W[r][c] *= scale;

  return { Win, W };
}

// ---------- Core fit/predict ----------
async function fitPredict({ key, y, hyper, seed }) {
  const H = Math.max(1, Math.round(hyper?.horizon ?? 4));
  const Nh = Math.max(10, Math.round(hyper?.reservoir_size ?? 200));
  const leak = Number(hyper?.leak_rate ?? 1.0);
  const ridge = Number(hyper?.ridge ?? 1e-2);
  const inputScale = Number(hyper?.input_scale ?? 0.5);
  const bias = Number(hyper?.bias ?? 0.1);
  const washout = Math.max(0, Math.round(hyper?.washout ?? 50));
  const sparsity = (hyper?.sparsity ?? 0.10);
  const spectralRadius = Number(hyper?.spectral_radius ?? 0.95);
  const scale = hyper?.scale || "log1p"; // allow override; default log1p for counts

  const rng = sfc32(...splitSeed((seed >>> 0) || 1));

  // 1) Scale series
  const yRaw = (y || []).map(v => Number(v || 0));
  const yS = scaleForward(yRaw, scale);
  const T = yS.length;
  if (T < washout + 5) {
    return { ok: true, yfit: [], yhat: new Array(H).fill(0), H };
  }

  // 2) Build reservoir
  const { Win, W } = buildReservoir(Nh, sparsity, inputScale, spectralRadius, rng);

  // 3) Roll states and build supervised dataset
  const states = [];
  const targets = [];
  let x = new Float64Array(Nh); // start at zeros

  for (let t = 0; t < T - 1; t++) {
    const u = yS[t]; // 1D input = current observation
    // x = (1 - a)*x + a * tanh(W*x + Win*u + bias)
    const wx = new Float64Array(Nh);
    for (let r = 0; r < Nh; r++) {
      let s = 0; const row = W[r];
      for (let c = 0; c < Nh; c++) s += row[c] * x[c];
      wx[r] = s + Win[r] * u + bias;
    }
    for (let r = 0; r < Nh; r++) {
      const xr = (1 - leak) * x[r] + leak * tanh(wx[r]);
      x[r] = xr;
    }
    if (t >= washout) {
      const row = new Float64Array(Nh + 1);
      row[0] = 1; // bias term
      for (let i = 0; i < Nh; i++) row[i + 1] = x[i];
      states.push(row);
      targets.push(yS[t + 1]); // predict next
    }
  }

  // 4) Fit readout with ridge regression
  const beta = ridgeSolve(states, targets, ridge); // (Nh+1)

  // 5) In-sample one-step-ahead predictions for the train window
  const fitScaled = new Float64Array(states.length);
  for (let i = 0; i < states.length; i++) {
    const row = states[i];
    let s = 0;
    for (let j = 0; j < row.length; j++) s += row[j] * beta[j];
    fitScaled[i] = s;
  }
  const yfit = scaleInverse(Array.from(fitScaled), scale);

  // 6) Multi-step forecast from the last observed point
  let xF = x.slice();
  let uS = yS[T - 1];
  const yhatScaled = new Array(H);
  for (let h = 0; h < H; h++) {
    // advance state with last input uS
    const wxF = new Float64Array(Nh);
    for (let r = 0; r < Nh; r++) {
      let s = 0; const row = W[r];
      for (let c = 0; c < Nh; c++) s += row[c] * xF[c];
      wxF[r] = s + Win[r] * uS + bias;
    }
    for (let r = 0; r < Nh; r++) xF[r] = (1 - leak) * xF[r] + leak * tanh(wxF[r]);

    // readout
    let yhat_s = beta[0];
    for (let j = 0; j < Nh; j++) yhat_s += beta[j + 1] * xF[j];

    yhatScaled[h] = yhat_s;
    uS = yhat_s; // closed-loop forecasting (use own prediction as next input)
  }
  const yhat = scaleInverse(yhatScaled, scale);

  return { ok: true, yfit, yhat, H };
}

function postResult(obj) { postMessage(obj); }
function postErr(err) {
  postMessage({ ok: false, error: (err && err.message) || String(err) });
}
