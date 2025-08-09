// App.jsx — Overflowing Palette (React / CRA)
import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const MOVES_BY_DIFF = { easy: 4, medium: 5, hard: 6 };
const BLOCKER = -1;

const PALETTE = [
    { id: 1, name: "blue",   hex: "#3E82C4" },
    { id: 2, name: "red",    hex: "#D04747" },
    { id: 3, name: "yellow", hex: "#E8D05B" },
    { id: 4, name: "green",  hex: "#3E9E8F" },
];

export default function App() {
    const posId = (r, c, C) => r * C + c;

    // size
    const [rows, setRows] = useState(8);
    const [cols, setCols] = useState(10);

    // game state
    const [difficulty, setDifficulty] = useState("medium");
    const [grid, setGrid] = useState([]);
    const [seedGrid, setSeedGrid] = useState([]);
    const [goalColor, setGoalColor] = useState(0);
    const [movesLeft, setMovesLeft] = useState(MOVES_BY_DIFF["medium"]);
    const [selectedColorIdx, setSelectedColorIdx] = useState(null);
    const [isWon, setIsWon] = useState(false);

    // fx/animation
    const [origin, setOrigin] = useState([Math.floor(rows/2), Math.floor(cols/2)]);
    const [changedThisMove, setChangedThisMove] = useState(new Set());
    const [waveSeed, setWaveSeed] = useState(0);

    // async generation
    const [isGenerating, setIsGenerating] = useState(false);

    // init
    useEffect(() => { newGame(difficulty, rows, cols); }, []); // on mount

    // --- helpers ---
    function isUniformTo(g, color) {
        for (const v of g.flat()) if (v !== BLOCKER && v !== color) return false;
        return true;
    }

    function distanceMap([sr, sc], R, C){
        const dm = Array.from({length:R},()=>Array(C).fill(0));
        for (let r=0;r<R;r++) for (let c=0;c<C;c++) dm[r][c] = Math.abs(sr-r)+Math.abs(sc-c);
        return dm;
    }

    // flood + track changed cells (fast queue, numeric ids)
    function simulateFlood(g, sr, sc, targetIdx, R, C) {
        const base = g[sr][sc];
        if (base === BLOCKER || base === targetIdx) return { grid: g, changed: new Set() };

        const ng = g.map(r => r.slice());
        const changed = new Set();

        const q = new Array(R * C);
        let qi = 0, qh = 0;
        q[qi++] = sr; q[qi++] = sc;

        while (qh < qi) {
            const r = q[qh++], c = q[qh++];
            if (r < 0 || r >= R || c < 0 || c >= C) continue;
            if (ng[r][c] !== base) continue;
            ng[r][c] = targetIdx;
            changed.add(posId(r, c, C));

            q[qi++] = r - 1; q[qi++] = c;
            q[qi++] = r + 1; q[qi++] = c;
            q[qi++] = r;     q[qi++] = c - 1;
            q[qi++] = r;     q[qi++] = c + 1;
        }
        return { grid: ng, changed };
    }

    // random grid with bias (WuWa feel) + blockers on hard
    function randomGrid(diff, R, C) {
        const blockersPct = diff === "hard" ? 0.08 : 0;
        const biasColor = (Math.random() * PALETTE.length) | 0;
        const biasPct = 0.62;

        const g = Array.from({ length: R }, () =>
            Array.from({ length: C }, () => {
                if (Math.random() < blockersPct) return BLOCKER;
                if (Math.random() < biasPct) return biasColor;
                return (Math.random() * PALETTE.length) | 0;
            })
        );

        // center cannot be blocker
        const cr = Math.floor(R / 2), cc = Math.floor(C / 2);
        if (g[cr][cc] === BLOCKER) g[cr][cc] = biasColor;
        return g;
    }

    function majorityColorOfGrid(g) {
        const freq = new Map();
        for (const v of g.flat()) if (v !== BLOCKER) freq.set(v, (freq.get(v) || 0) + 1);
        let best = -1, color = 0;
        for (const [k, v] of freq) if (v > best) { best = v; color = k; }
        return color;
    }

    // centers of connected regions (as click seeds)
    function regionSeeds(g, R, C) {
        const seeds = [];
        const seen = Array.from({ length: R }, () => Array(C).fill(false));
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
            if (seen[r][c] || g[r][c] === BLOCKER) continue;
            const color = g[r][c];
            const q = [[r, c]]; seen[r][c] = true;
            let cnt = 0, sr = 0, sc = 0;
            while (q.length) {
                const [rr, cc] = q.shift(); cnt++; sr += rr; sc += cc;
                for (const [nr, nc] of [[rr-1,cc],[rr+1,cc],[rr,cc-1],[rr,cc+1]]) {
                    if (nr<0||nr>=R||nc<0||nc>=C) continue;
                    if (seen[nr][nc]) continue;
                    if (g[nr][nc] === color) { seen[nr][nc] = true; q.push([nr, nc]); }
                }
            }
            seeds.push({ r: Math.round(sr / cnt), c: Math.round(sc / cnt) });
        }
        return seeds;
    }

    function connectedSize(g, color, R, C) {
        const seen = Array.from({ length: R }, () => Array(C).fill(false));
        let best = 0;
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
            if (seen[r][c] || g[r][c] !== color) continue;
            let cnt = 0; const q = [[r, c]]; seen[r][c] = true;
            while (q.length) {
                const [rr, cc] = q.shift(); cnt++;
                for (const [nr,nc] of [[rr-1,cc],[rr+1,cc],[rr,cc-1],[rr,cc+1]]) {
                    if (nr<0||nr>=R||nc<0||nc>=C) continue;
                    if (seen[nr][nc]) continue;
                    if (g[nr][nc] === color) { seen[nr][nc] = true; q.push([nr,nc]); }
                }
            }
            if (cnt > best) best = cnt;
        }
        return best;
    }

    // cheap greedy check (<= k moves)
    function isSolvableGreedy(start, target, maxDepth, R, C, simulateFlood) {
        let state = start.map(r => r.slice());
        for (let depth = 0; depth < maxDepth; depth++) {
            if (isUniformTo(state, target)) return true;
            let bestGain = -1, bestNext = null;
            const seeds = regionSeeds(state, R, C);
            for (const { r, c } of seeds) {
                const base = state[r][c];
                if (base === BLOCKER) continue;
                for (let color = 0; color < PALETTE.length; color++) {
                    if (color === base) continue;
                    const { grid: ng } = simulateFlood(state, r, c, color, R, C);
                    // skip no-op
                    if (ng === state) continue;
                    const gain = connectedSize(ng, target, R, C);
                    if (gain > bestGain) { bestGain = gain; bestNext = ng; }
                }
            }
            if (!bestNext) break;
            state = bestNext;
        }
        return isUniformTo(state, target);
    }

    function newGame(diff = difficulty, R = rows, C = cols) {
        setIsGenerating(true);
        const k = MOVES_BY_DIFF[diff];
        let attempts = 0;

        const tryOnce = () => {
            attempts++;
            const g = randomGrid(diff, R, C);
            const majority = majorityColorOfGrid(g);
            const ok = isSolvableGreedy(g, majority, k, R, C, simulateFlood);

            if (ok || attempts >= 120) {
                React.startTransition?.(() => {
                    setSeedGrid(g.map(r => r.slice()));
                    setGrid(g);
                    setGoalColor(majority);
                    setMovesLeft(k);
                    setIsWon(false);
                    setSelectedColorIdx(null);
                    setOrigin([Math.floor(R/2), Math.floor(C/2)]);
                    setChangedThisMove(new Set());
                    setWaveSeed(s => s + 1);
                    setIsGenerating(false);
                });
            } else {
                setTimeout(tryOnce, 0);
            }
        };

        setTimeout(tryOnce, 0);
    }

    // -------- gameplay --------
    const wonNow = useMemo(()=>isUniformTo(grid, goalColor),[grid,goalColor]);
    useEffect(()=>{ if (wonNow && movesLeft>=0) setIsWon(true); },[wonNow,movesLeft]);

    function onCellClick(r, c) {
        if (selectedColorIdx == null || isWon || movesLeft <= 0) return;
        if (grid[r][c] === BLOCKER) return;

        const res = simulateFlood(grid, r, c, selectedColorIdx, rows, cols);
        if (res.changed.size === 0) return;

        setGrid(res.grid);
        setMovesLeft(m => {
            const next = m - 1;
            setOrigin([r, c]);
            setChangedThisMove(res.changed);
            setWaveSeed(s => s + 1);

            if (next === 0 && !isUniformTo(res.grid, goalColor)) {
                console.log("restarting cause no attemps"); // replace with your toast if needed
                setTimeout(() => handleRetry(), 300);
            }
            return next;
        });
    }

    function handleDiff(e){ const d=e.target.value; setDifficulty(d); newGame(d, rows, cols); }
    function handleRetry(){ setGrid(seedGrid.map(r=>r.slice())); setMovesLeft(MOVES_BY_DIFF[difficulty]); setIsWon(false); setSelectedColorIdx(null); setChangedThisMove(new Set()); setWaveSeed(s=>s+1); }
    function handleNew(){ newGame(difficulty, rows, cols); }
    function handleResize(newR,newC){
        const R = Math.max(5, Math.min(14, newR|0));
        const C = Math.max(5, Math.min(18, newC|0));
        setRows(R); setCols(C);
        newGame(difficulty, R, C);
    }

    const dmap = useMemo(
        () => distanceMap(origin, rows, cols),
        [origin, rows, cols, waveSeed]
    );

    // -------- render --------
    return (
        <div className="game">
            <div className="topbar">
                <div className="logo"><span className="dot dot-sm" /> Overflowing Palette</div>

                <div className="hud-left">
                    <div className="moves">
                        Remaining Moves: <b className={movesLeft===0 && !isWon ? "danger":""}>{movesLeft}</b>
                    </div>

                    <label className="diff">
                        Difficulty
                        <select value={difficulty} onChange={handleDiff}>
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard (blockers)</option>
                        </select>
                    </label>

                    <div className="size">
                        <label>Rows <input type="number" min="5" max="14" value={rows}
                                           onChange={(e)=>handleResize(e.target.value, cols)} /></label>
                        <label>Cols <input type="number" min="5" max="18" value={cols}
                                           onChange={(e)=>handleResize(rows, e.target.value)} /></label>
                    </div>

                    <div className="actions">
                        <button className="btn" onClick={handleRetry}>Retry</button>
                        <button className="btn" onClick={handleNew}>New Game</button>
                    </div>

                    {!isWon && <div className="target-inline">
                        Target color:&nbsp;<span style={{color:PALETTE[goalColor].hex}}>{PALETTE[goalColor].name}</span>
                    </div>}
                    {isWon && <div className="banner">Completed!</div>}
                </div>
            </div>

            <div className="content">
                <div className="board-frame">
                    <div className="board">
                        {grid.map((row,r)=>(
                            <div className="row" key={r}>
                                {row.map((idx,c)=>{
                                    const key=`${r},${c}`;
                                    const id = posId(r, c, cols);
                                    const willFlip = changedThisMove.has(id);
                                    const delay = willFlip ? dmap[r][c] * 90 : 0;

                                    const style = {
                                        background: idx === BLOCKER ? "#0b0b0f" : PALETTE[idx].hex,
                                        transitionDelay: `${delay}ms`,
                                    };
                                    const isOrigin = origin[0]===r && origin[1]===c;
                                    return (
                                        <button
                                            key={key}
                                            className={`cell ${idx===BLOCKER ? "blocker":""} ${isOrigin ? "origin":""} ${willFlip ? "flip":""}`}
                                            style={style}
                                            onClick={()=>onCellClick(r,c)}
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    <button className="reset" onClick={handleNew} aria-label="Reset">
                        <span className="reset-arrow" />
                    </button>
                </div>

                <div className="sidebar">
                    {PALETTE.map((c,i)=>(
                        <button key={c.id}
                                className={`color-btn ${selectedColorIdx===i ? "active":""}`}
                                onClick={()=>setSelectedColorIdx(i)}
                                title={`Pick ${c.name}`}>
                            <span className="dot" style={{background:c.hex}}/>
                            <span className="num">{c.id}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="goalbar">
                <span className="chev">▾▾</span>&nbsp;Turn all the blocks into&nbsp;
                <span style={{color:PALETTE[goalColor].hex, fontWeight:700}}>
          {PALETTE[goalColor].name[0].toUpperCase()+PALETTE[goalColor].name.slice(1)}
        </span>
            </div>

            {isGenerating && (<div className="overlay">Generating puzzle…</div>)}
        </div>
    );
}
