// App.jsx — Overflowing Palette (React / CRA)
// - Constructive generator: always solvable in k steps (k per difficulty)
// - Goal color is chosen automatically per puzzle (random); UI shows it
// - Async generation to avoid UI freeze
// - Flip animation only for changed tiles
// - Rows/Cols inputs, Difficulty, Retry/New Game, goal text

import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const MOVES_BY_DIFF = { easy: 3, medium: 4, hard: 5 };
const BLOCKER = -1;
const MAX_ATTEMPTS = 250; // сколько раз пробуем сгенерить и проверить


const PALETTE = [
    { id: 1, name: "blue",   hex: "#3E82C4" },
    { id: 2, name: "red",    hex: "#D04747" },
    { id: 3, name: "yellow", hex: "#E8D05B" },
    { id: 4, name: "green",  hex: "#3E9E8F" },
];

export default function App() {

    const colors = ['blue', 'red', 'yellow', 'green'];

    function generateBoard(rows, cols) {
        const board = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                const randomColor = colors[Math.floor(Math.random() * colors.length)];
                row.push(randomColor);
            }
            board.push(row);
        }
        return board;
    }

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

    // helpers
    const insideIdx = (r,c,R,C) => r>=0 && r<R && c>=0 && c<C;

    function isUniformTo(g, color) {
        for (const v of g.flat()) if (v !== BLOCKER && v !== color) return false;
        return true;
    }

    function distanceMap([sr, sc], R, C){
        const dm = Array.from({length:R},()=>Array(C).fill(0));
        for (let r=0;r<R;r++) for (let c=0;c<C;c++) dm[r][c] = Math.abs(sr-r)+Math.abs(sc-c);
        return dm;
    }

    // flood + track changed cells
    function simulateFlood(g, sr, sc, targetIdx, R, C){
        const ng = g.map(row=>row.slice());
        const changed = new Set();
        if (ng[sr][sc]===BLOCKER) return {grid:ng, changed};
        const base = ng[sr][sc]; if (base===targetIdx) return {grid:ng, changed};
        const vis = Array.from({length:R},()=>Array(C).fill(false));
        const q=[[sr,sc]];
        while(q.length){
            const [r,c]=q.shift();
            if (!insideIdx(r,c,R,C) || vis[r][c] || ng[r][c]===BLOCKER || ng[r][c]!==base) continue;
            vis[r][c]=true; ng[r][c]=targetIdx; changed.add(`${r},${c}`);
            q.push([r-1,c],[r+1,c],[r,c-1],[r,c+1]);
        }
        return {grid:ng, changed};
    }

    function gridsEqual(a,b){
        if (!a.length || !b.length) return false;
        for (let r=0;r<a.length;r++) for (let c=0;c<a[0].length;c++) if (a[r][c]!==b[r][c]) return false;
        return true;
    }

    // -------- Constructive generator (guaranteed ≤ k steps) --------
    // idea: pick a random TARGET; start from a uniform TARGET board; (Hard) add blockers;
    // then perform k reverse-steps: choose origin + non-TARGET color and flood to that color.
    // The resulting puzzle is solvable in k by replaying the same origins to TARGET.
    function generatePuzzleConstructive(diff, R, C, k) {
        const TARGET = (Math.random() * PALETTE.length) | 0; // automatic random goal

        // Start uniform target
        let g = Array.from({ length: R }, () =>
            Array.from({ length: C }, () => Math.floor(Math.random() * PALETTE.length))
        );
        // Hard: sprinkle blockers first so reverse steps respect them
        const blockersPct = diff === "hard" ? 0.08 : 0;
        if (blockersPct > 0) {
            for (let r = 0; r < R; r++) {
                for (let c = 0; c < C; c++) {
                    if (Math.random() < blockersPct) g[r][c] = BLOCKER;
                }
            }
        }

        // pick k origins (avoid blockers)
        const origins = [];
        for (let i=0;i<k;i++){
            let r=0,c=0,tries=0;
            do { r=(Math.random()*R)|0; c=(Math.random()*C)|0; } while (g[r][c]===BLOCKER && tries++<200);
            if (g[r][c]===BLOCKER) { r=Math.floor(R/2); c=Math.floor(C/2); } // fallback
            origins.push([r,c]);
        }

        // push away from TARGET k times
        for (let i=0;i<k;i++){
            const [r,c] = origins[i];
            let color = TARGET;
            for (let guard=0; guard<20 && color===TARGET; guard++){
                color = (Math.random()*PALETTE.length)|0;
            }
            const res = simulateFlood(g, r, c, color, R, C);
            g = res.grid;
        }

        return { grid: g, goal: TARGET };
    }

    // Случайная доска с лёгким уклоном в один цвет (повышает решаемость)
    function randomGrid(diff, R, C) {
        const blockersPct = diff === "hard" ? 0.08 : 0;
        const biasColor = (Math.random() * PALETTE.length) | 0;
        const biasPct = 0.55;

        const g = Array.from({ length: R }, () =>
            Array.from({ length: C }, () => {
                if (Math.random() < blockersPct) return BLOCKER;
                if (Math.random() < biasPct) return biasColor;
                return (Math.random() * PALETTE.length) | 0;
            })
        );

        // центр не должен быть блокером (приятнее играть)
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

// центры компонент — кандидаты-«ориджины» для клика
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

// нижняя оценка: количество компонент «нецелевого» цвета
    function nonTargetComponents(g, target, R, C) {
        const seen = Array.from({ length: R }, () => Array(C).fill(false));
        let comps = 0;
        for (let r=0;r<R;r++) for (let c=0;c<C;c++) {
            if (seen[r][c] || g[r][c] === BLOCKER || g[r][c] === target) continue;
            const clr = g[r][c]; comps++;
            const q = [[r,c]]; seen[r][c] = true;
            while (q.length) {
                const [rr,cc] = q.shift();
                for (const [nr,nc] of [[rr-1,cc],[rr+1,cc],[rr,cc-1],[rr,cc+1]]) {
                    if (nr<0||nr>=R||nc<0||nc>=C) continue;
                    if (seen[nr][nc]) continue;
                    if (g[nr][nc] === clr) { seen[nr][nc] = true; q.push([nr,nc]); }
                }
            }
        }
        return comps;
    }

    function serialize(g){ return g.map(r=>r.join(",")).join("|"); }

// Поиск решения ≤ k ходов (итеративный DFS с отсечениями)
    function isSolvableToward(start, target, maxDepth, R, C, simulateFlood) {
        const seen = new Set();
        const startKey = serialize(start);
        function dfs(state, depth) {
            if (depth > maxDepth) return false;
            if (nonTargetComponents(state, target, R, C) > (maxDepth - depth)) return false;
            if (state === true) return false; // guard
            if (state && isUniformTo(state, target)) return true;

            const key = serialize(state) + "|" + depth;
            if (seen.has(key)) return false;
            seen.add(key);

            const seeds = regionSeeds(state, R, C);
            const moves = [];
            for (const { r, c } of seeds) {
                const base = state[r][c];
                if (base === BLOCKER) continue;
                for (let color = 0; color < PALETTE.length; color++) {
                    if (color === base) continue;
                    const { grid: ng } = simulateFlood(state, r, c, color, R, C);
                    if (serialize(ng) === serialize(state)) continue;
                    const gain = connectedSize(ng, target, R, C);
                    moves.push({ ng, gain });
                }
            }
            // жадно пробуем ходы, которые сильнее наращивают компоненту target
            moves.sort((a,b)=>b.gain - a.gain);
            for (const m of moves.slice(0, 18)) {
                if (dfs(m.ng, depth + 1)) return true;
            }
            return false;
        }
        return dfs(start, 0);
    }


    function newGame(diff = difficulty, R = rows, C = cols) {
        setIsGenerating(true);
        const k = MOVES_BY_DIFF[diff];
        let attempts = 0;

        const tryOnce = () => {
            attempts++;
            const g = randomGrid(diff, R, C);
            const goal = majorityColorOfGrid(g);

            if (isSolvableToward(g, goal, k, R, C, simulateFlood)) {
                setSeedGrid(g.map(r => r.slice()));
                setGrid(g);
                setGoalColor(goal);
                setMovesLeft(k);
                setIsWon(false);
                setSelectedColorIdx(null);
                setOrigin([Math.floor(R/2), Math.floor(C/2)]);
                setChangedThisMove(new Set());
                setWaveSeed(s => s + 1);
                setIsGenerating(false);
                return;
            }

            if (attempts < MAX_ATTEMPTS) {
                // уступаем потоку рендера, чтобы не «висеть»
                setTimeout(tryOnce, 0);
            } else {
                // fallback — очень редко; всё равно стартуем игру
                setSeedGrid(g.map(r => r.slice()));
                setGrid(g);
                setGoalColor(goal);
                setMovesLeft(k);
                setIsWon(false);
                setSelectedColorIdx(null);
                setOrigin([Math.floor(R/2), Math.floor(C/2)]);
                setChangedThisMove(new Set());
                setWaveSeed(s => s + 1);
                setIsGenerating(false);
            }
        };

        setTimeout(tryOnce, 0);
    }

    // -------- gameplay --------
    const wonNow = useMemo(()=>isUniformTo(grid, goalColor),[grid,goalColor]);
    useEffect(()=>{ if (wonNow && movesLeft>=0) setIsWon(true); },[wonNow,movesLeft]);

    function onCellClick(r,c){
        if (selectedColorIdx==null || isWon || movesLeft<=0) return;
        if (grid[r][c]===BLOCKER) return;
        const res = simulateFlood(grid, r, c, selectedColorIdx, rows, cols);
        if (!gridsEqual(res.grid, grid)){
            setGrid(res.grid);
            setMovesLeft(m=>m-1);
            setOrigin([r,c]);
            setChangedThisMove(res.changed);
            setWaveSeed(s=>s+1);
        }
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

    const dmap = useMemo(()=>distanceMap(origin, rows, cols),[origin, grid, waveSeed, rows, cols]);

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
                            <option value="easy">Easy (3 moves)</option>
                            <option value="medium">Medium (4 moves)</option>
                            <option value="hard">Hard (5 moves + blockers)</option>
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
                                    const willFlip = changedThisMove.has(key);
                                    const delay = willFlip ? dmap[r][c]*120 : 0; // slow wave only on changed
                                    const isOrigin = origin[0]===r && origin[1]===c;
                                    const style = {
                                        background: idx===BLOCKER ? "#0b0b0f" : PALETTE[idx].hex,
                                        transitionDelay: `${delay}ms`,
                                    };
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

            {isGenerating && (
                <div className="overlay">Generating puzzle…</div>
            )}
        </div>
    );
}
