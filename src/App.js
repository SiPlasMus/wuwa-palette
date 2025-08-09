// App.jsx — Overflowing Palette (React / CRA)
// - Проверка решаемости до показа (к целевому цвету) за k ходов
// - Настройка Rows / Cols
// - UI в стиле твоего скрина (Remaining Moves слева, цель внизу, круглая палитра справа)
// - Анимация «flip» только у изменившихся клеток

import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const MOVES_BY_DIFF = { easy: 3, medium: 4, hard: 5 };
const MAX_GEN_ATTEMPTS = 300;
const BLOCKER = -1;

const PALETTE = [
    { id: 1, name: "blue",   hex: "#3E82C4" },
    { id: 2, name: "red",    hex: "#D04747" },
    { id: 3, name: "yellow", hex: "#E8D05B" },
    { id: 4, name: "green",  hex: "#3E9E8F" },
];

export default function App() {
    // Размеры теперь настраиваемые
    const [rows, setRows] = useState(9);
    const [cols, setCols] = useState(11);

    const [difficulty, setDifficulty] = useState("medium");
    const [grid, setGrid] = useState([]);        // текущее поле
    const [seedGrid, setSeedGrid] = useState([]);// исходное для Retry
    const [goalColor, setGoalColor] = useState(0);
    const [movesLeft, setMovesLeft] = useState(MOVES_BY_DIFF[difficulty]);

    const [selectedColorIdx, setSelectedColorIdx] = useState(null);
    const [isWon, setIsWon] = useState(false);
    const [origin, setOrigin] = useState([Math.floor(rows/2), Math.floor(cols/2)]);
    const [changedThisMove, setChangedThisMove] = useState(new Set());
    const [waveSeed, setWaveSeed] = useState(0);

    // ————— utils over dynamic size —————
    const inside = (r,c) => r>=0 && r<rows && c>=0 && c<cols;

    const majorityColor = (g) => {
        const cnt = new Map();
        for (const v of g.flat()) if (v !== BLOCKER) cnt.set(v,(cnt.get(v)||0)+1);
        let best = 0, color = 0;
        for (const [k,v] of cnt) if (v>best){ best=v; color=k; }
        return color;
    };

    const isUniformTo = (g, color) => {
        for (const v of g.flat()) if (v !== BLOCKER && v !== color) return false;
        return true;
    };

    // ————— генерация с проверкой решаемости за k ходов к целевому цвету —————
    useEffect(() => { newGame(difficulty, rows, cols); /* init */ }, []); // mount

    function newGame(diff = difficulty, R = rows, C = cols) {
        const k = MOVES_BY_DIFF[diff];
        for (let att=0; att<MAX_GEN_ATTEMPTS; att++) {
            const g = randomGrid(diff, R, C);
            const goal = majorityColor(g);
            if (checkSolvableToward(g, goal, k, R, C)) {
                setSeedGrid(g.map(r=>r.slice()));
                setGrid(g);
                setGoalColor(goal);
                setMovesLeft(k);
                setIsWon(false);
                setSelectedColorIdx(null);
                setOrigin([Math.floor(R/2), Math.floor(C/2)]);
                setChangedThisMove(new Set());
                setWaveSeed(s=>s+1);
                return;
            }
        }
        // fallback — всё равно покажем, но такое вряд ли произойдёт с bias
        const g = randomGrid(diff, R, C);
        setSeedGrid(g.map(r=>r.slice()));
        setGrid(g);
        setGoalColor(majorityColor(g));
        setMovesLeft(MOVES_BY_DIFF[diff]);
        setIsWon(false);
    }

    function randomGrid(diff, R, C) {
        const blockersPct = diff === "hard" ? 0.08 : 0;
        const biasColor = Math.floor(Math.random()*PALETTE.length);
        const biasPct = 0.55;
        const g = Array.from({length:R},()=>Array.from({length:C},()=>{
            if (Math.random() < blockersPct) return BLOCKER;
            if (Math.random() < biasPct) return biasColor;
            return Math.floor(Math.random()*PALETTE.length);
        }));
        // избегаем блокера прямо в центре «по ощущениям»
        const [cr,cc] = [Math.floor(R/2), Math.floor(C/2)];
        if (g[cr][cc] === BLOCKER) g[cr][cc] = biasColor;
        return g;
    }

    // ————— solver (Depth-Limited DFS с сильным отсевом) —————
    function checkSolvableToward(start, target, maxDepth, R, C) {
        // кэш по состояниям для отсечения повторов: key = colors joined
        const seen = new Set();
        const seeds = () => regionSeeds(start, R, C); // стартовые кандидаты
        // IDA*-подобный поиск с отсечением по «оставшимся цветам не target»
        function dfs(state, depth) {
            const key = serialize(state);
            if (seen.has(key) && depth <= maxDepth) return false;
            seen.add(key);
            if (isUniformTo(state, target)) return true;
            if (depth === maxDepth) return false;

            // ограничим варианты: только центры регионов + ближайшие к центру
            const cand = regionSeeds(state, R, C);
            for (const {r,c} of cand) {
                for (let color=0;color<PALETTE.length;color++){
                    if (state[r][c]===color || state[r][c]===BLOCKER) continue;
                    const next = simulateFlood(state, r, c, color, R, C).grid;
                    // эвристика: если не увеличили компоненту target — пропустим часть веток
                    if (connectedSize(next, target, R, C) < connectedSize(state, target, R, C)) continue;
                    if (dfs(next, depth+1)) return true;
                }
            }
            return false;
        }
        return dfs(start, 0);
    }

    function regionSeeds(g, R, C) {
        const seeds = [];
        const vis = Array.from({length:R},()=>Array(C).fill(false));
        for (let r=0;r<R;r++) for (let c=0;c<C;c++){
            if (vis[r][c] || g[r][c]===BLOCKER) continue;
            const clr = g[r][c]; let q=[[r,c]]; vis[r][c]=true;
            let cnt=0, sr=0, sc=0;
            while(q.length){
                const [rr,cc]=q.shift(); cnt++; sr+=rr; sc+=cc;
                for (const [nr,nc] of [[rr-1,cc],[rr+1,cc],[rr,cc-1],[rr,cc+1]]){
                    if (!insideIdx(nr,nc,R,C)) continue;
                    if (vis[nr][nc]) continue;
                    if (g[nr][nc]===clr){ vis[nr][nc]=true; q.push([nr,nc]); }
                }
            }
            seeds.push({r:Math.round(sr/cnt), c:Math.round(sc/cnt)});
        }
        return seeds;
    }
    function insideIdx(r,c,R,C){ return r>=0&&r<R&&c>=0&&c<C; }

    function connectedSize(g, color, R, C) {
        const vis = Array.from({length:R},()=>Array(C).fill(false));
        let best=0;
        for (let r=0;r<R;r++) for (let c=0;c<C;c++){
            if (vis[r][c] || g[r][c]!==color) continue;
            let cnt=0, q=[[r,c]]; vis[r][c]=true;
            while(q.length){
                const [rr,cc]=q.shift(); cnt++;
                for (const [nr,nc] of [[rr-1,cc],[rr+1,cc],[rr,cc-1],[rr,cc+1]]){
                    if (!insideIdx(nr,nc,R,C)) continue;
                    if (vis[nr][nc]) continue;
                    if (g[nr][nc]===color){ vis[nr][nc]=true; q.push([nr,nc]); }
                }
            }
            if (cnt>best) best=cnt;
        }
        return best;
    }

    function serialize(g){ return g.map(r=>r.join(",")).join("|"); }

    // ————— игровой флоу —————
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

    function simulateFlood(g, sr, sc, targetIdx, R, C){
        const ng = g.map(row=>row.slice());
        const changed = new Set();
        if (ng[sr][sc]===BLOCKER) return {grid:ng,changed};
        const base = ng[sr][sc]; if (base===targetIdx) return {grid:ng,changed};
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

    function distanceMap([sr,sc]){
        const dm = Array.from({length:rows},()=>Array(cols).fill(0));
        for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) dm[r][c] = Math.abs(sr-r)+Math.abs(sc-c);
        return dm;
    }
    const dmap = useMemo(()=>distanceMap(origin),[origin,grid,waveSeed,rows,cols]);

    // ————— handlers —————
    function handleDiff(e){ const d=e.target.value; setDifficulty(d); newGame(d, rows, cols); }
    function handleRetry(){ setGrid(seedGrid.map(r=>r.slice())); setMovesLeft(MOVES_BY_DIFF[difficulty]); setIsWon(false); setSelectedColorIdx(null); setChangedThisMove(new Set()); setWaveSeed(s=>s+1); }
    function handleNew(){ newGame(difficulty, rows, cols); }
    function handleResize(newR,newC){
        const R = Math.max(5, Math.min(14, newR|0));
        const C = Math.max(5, Math.min(18, newC|0));
        setRows(R); setCols(C);
        newGame(difficulty, R, C);
    }

    // ————— render —————
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
                                    const delay = willFlip ? dmap[r][c]*120 : 0;
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
                <span style={{color:PALETTE[goalColor].hex, fontWeight:700}}>{PALETTE[goalColor].name[0].toUpperCase()+PALETTE[goalColor].name.slice(1)}</span>
            </div>
        </div>
    );
}
