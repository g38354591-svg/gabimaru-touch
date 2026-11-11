const fs = require('fs');
const path = require('path');
'use strict';

const http = require('http');
const crypto = require('crypto');
const { Chess } = require('chess.js');

let config = {};
try { config = require('./config'); } catch {}

const PORT = Number(process.env.PORT || 8787);
const HOST = '0.0.0.0';

// ═══ AI ENGINE (minimax + alpha-beta) ═══
function aiBestMove(chessInstance, level = 3) {
    const PIECE_VALUES = { p:100, n:320, b:330, r:500, q:900, k:20000 };
    function evaluate(chess) {
        if (chess.isCheckmate()) return chess.turn() === 'w' ? 99999 : -99999;
        if (chess.isDraw()) return 0;
        let score = 0;
        const board = chess.board();
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const sq = board[r][c];
                if (!sq) continue;
                const val = PIECE_VALUES[sq.type] || 0;
                score += sq.color === 'w' ? val : -val;
            }
        }
        return score;
    }
    function minimax(chess, d, alpha, beta, isMax) {
        if (d === 0 || chess.isGameOver()) return evaluate(chess);
        const moves = chess.moves({ verbose: true });
        if (isMax) {
            let best = -Infinity;
            for (const m of moves) {
                chess.move(m);
                best = Math.max(best, minimax(chess, d-1, alpha, beta, false));
                chess.undo();
                alpha = Math.max(alpha, best);
                if (beta <= alpha) break;
            }
            return best;
        } else {
            let best = Infinity;
            for (const m of moves) {
                chess.move(m);
                best = Math.min(best, minimax(chess, d-1, alpha, beta, true));
                chess.undo();
                beta = Math.min(beta, best);
                if (beta <= alpha) break;
            }
            return best;
        }
    }
    const legalMoves = chessInstance.moves({ verbose: true });
    if (!legalMoves.length) return null;
    
    if (level === 1 && Math.random() < 0.65) {
        return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }
    
    const depth = level === 1 ? 2 : level === 2 ? 2 : level === 3 ? 3 : 4;
    
    let bestMove = legalMoves[0];
    let bestScore = -Infinity;
    for (const m of legalMoves) {
        chessInstance.move(m);
        const score = minimax(chessInstance, depth-1, -Infinity, Infinity, false);
        chessInstance.undo();
        if (score > bestScore) { bestScore = score; bestMove = m; }
    }
    return bestMove;
}
// ═══════════════════════════════════════

const chessGames = new Map();

const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function chessState(game) {
  const b = game.chess.board();
  const symbols = {
    wk:'♔', wq:'♕', wr:'♖', wb:'♗', wn:'♘', wp:'♙',
    bk:'♚', bq:'♛', br:'♜', bb:'♝', bn:'♞', bp:'♟'
  };

  return {
    id: game.id,
    board: b.map(row => row.map(p => p ? symbols[p.color + p.type] : '')),
    turn: game.chess.turn(),
    fen: game.chess.fen(),
    moves: game.chess.history(),
    check: game.chess.isCheck(),
    over: game.chess.isGameOver(),
    checkmate: game.chess.isCheckmate(),
    draw: game.chess.isDraw(),
    legal: game.chess.moves({ verbose: true }).map(m => ({
      from: m.from,
      to: m.to,
      promotion: m.promotion || null,
      captured: m.captured || null
    })),
    status: game.chess.isCheckmate()
      ? 'كش مات — انتهت المباراة'
      : game.chess.isDraw()
        ? 'تعادل — انتهت المباراة'
        : game.chess.isCheck()
          ? 'كش! ' + (game.chess.turn() === 'w' ? 'دور الأبيض' : 'دور الأسود')
          : 'دور ' + (game.chess.turn() === 'w' ? 'الأبيض' : 'الأسود'),
    legal: game.chess.moves({ verbose: true }).map(m => ({
      from: m.from, to: m.to, promotion: m.promotion || null
    }))
  };
}

function shell(title, content, script) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="theme-color" content="#080910">
<title>${title}</title>
<style>
:root{color-scheme:dark;--bg:#080910;--panel:#111321;--line:#292d43;--red:#ff2457;--purple:#a855f7;--muted:#a5abc2;--gold:#ffc857}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top,#21112d 0%,var(--bg) 52%);color:#f7f7ff;font-family:system-ui,-apple-system,sans-serif}
button{font:inherit;cursor:pointer;touch-action:manipulation}
.app{width:min(100% - 28px,520px);margin:auto;padding:22px 0 35px}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:22px}
.brand{font-weight:900;letter-spacing:1px}.online{font-size:12px;color:#75f0ae}.online:before{content:'●';margin-left:6px}
.hero{padding:24px 18px;border:1px solid #403052;border-radius:25px;background:linear-gradient(140deg,#20142e,#111321 70%);box-shadow:0 14px 40px #0005;text-align:center}
.logo{font-size:clamp(28px,8vw,40px);font-weight:950;text-shadow:0 0 24px #b34dff66}
.sub{color:var(--muted);font-size:12px;letter-spacing:3px;margin-top:5px}
h1{font-size:24px;margin:0 0 8px}p{color:var(--muted);line-height:1.7}
.cards{display:grid;gap:14px;margin-top:18px}
.card{width:100%;display:flex;align-items:center;text-align:right;gap:16px;padding:19px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(115deg,#171827,#10111b);color:white;transition:transform .15s,border-color .15s}
.card:active{transform:scale(.98);border-color:var(--red)}
.icon{width:64px;height:64px;flex-shrink:0;display:grid;place-items:center;border-radius:17px;background:#25203b;font-size:35px}
.card h2{font-size:19px;margin:0 0 4px}.card p{font-size:13px;margin:0}.arrow{margin-right:auto;color:var(--red);font-size:24px}
.btn{border:1px solid var(--line);border-radius:14px;padding:12px 16px;background:#191b2b;color:white}
.btn.primary{background:linear-gradient(100deg,#ed174b,#a21caf);border:0;font-weight:800}
.actions{display:flex;justify-content:center;gap:9px;flex-wrap:wrap;margin-top:15px}
.status{padding:12px;border:1px solid var(--line);border-radius:13px;background:#111321;color:#ddd;text-align:center;margin:13px 0}
.board{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));width:100%;aspect-ratio:1;border:3px solid #363248;border-radius:13px;overflow:hidden;box-shadow:0 12px 36px #0007;direction:ltr}
.square{position:relative;display:grid;place-items:center;border:0;border-radius:0;padding:0;min-width:0;aspect-ratio:1;font-family:"Segoe UI Symbol",serif;font-size:clamp(25px,8.5vw,47px);line-height:1}
.light{background:#e5d9c8;color:#17131b}.dark{background:#72617f;color:#fff}
.square.selected{box-shadow:inset 0 0 0 4px #ffcc45}
.square.target:after{content:'';position:absolute;width:24%;height:24%;border-radius:50%;background:#4ade80bb}
.square.capture:after{content:'';position:absolute;inset:5%;border:4px solid #ff5b70;border-radius:50%}
.square small{position:absolute;bottom:2px;left:3px;font:10px system-ui;opacity:.65}
.xoboard{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:17px}
.xocell{aspect-ratio:1;border:1px solid #37354f;border-radius:17px;background:linear-gradient(145deg,#1b1b2b,#10111b);font-size:clamp(46px,15vw,76px);font-weight:900;color:white}
.xocell.x{color:#ff456a;text-shadow:0 0 20px #ff245766}.xocell.o{color:#50a7ff;text-shadow:0 0 20px #2585ff66}
.footer{text-align:center;color:#777e9b;font-size:12px;margin-top:25px}
@media(min-width:430px){.cards{grid-template-columns:1fr 1fr}.card{display:block}.icon{margin-bottom:13px}.arrow{float:left}}

/* GABIMARU PREMIUM ARENA */
.win-overlay{z-index:5}
.victory-stroke{stroke-dasharray:300;stroke-dashoffset:300;filter:drop-shadow(0 0 5px #ffd477);animation:victoryDraw .45s ease-out forwards}
@keyframes victoryDraw{to{stroke-dashoffset:0}}
:root{
 --bg:#07070d;--panel:#11111d;--line:#30233d;--red:#ff2858;
 --purple:#a855f7;--muted:#aaa9c2;--gold:#ffd477;--blue:#56b8ff;
}
html{background:var(--bg);scroll-behavior:smooth}
body{
 background:
 radial-gradient(ellipse at 8% 0%,#54152c55,transparent 38%),
 radial-gradient(ellipse at 95% 20%,#4b168055,transparent 34%),
 radial-gradient(ellipse at 50% 100%,#20104755,transparent 45%),
 #07070d;
 background-attachment:fixed;
}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.13;z-index:0;
 background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);
 background-size:28px 28px;mask-image:linear-gradient(to bottom,#000,transparent 85%)}
.app{position:relative;z-index:1;width:min(100% - 30px,560px);padding:23px 0 40px}
.top{margin-bottom:20px;min-height:42px}
.brand{font-size:12px;font-weight:950;letter-spacing:1.6px;color:#f4eaff}
.online{padding:7px 11px;border:1px solid #3b2850;border-radius:999px;background:#171020;color:#a8ffc9;font-weight:800;font-size:11px;white-space:nowrap}
.hero{
 position:relative;isolation:isolate;overflow:hidden;text-align:right;
 padding:25px 21px 23px;border:1px solid #59304f;border-radius:27px;
 background:linear-gradient(125deg,#281124 0%,#171020 47%,#11111c 100%);
 box-shadow:0 20px 55px #0008,0 0 35px #a21caf12,inset 0 1px #ffffff12
}
.hero:before{content:"";position:absolute;z-index:-1;width:190px;height:190px;left:-75px;top:-100px;border-radius:50%;background:#a21caf35;filter:blur(28px)}
.hero:after{content:"";position:absolute;z-index:-1;width:150px;height:4px;left:20px;bottom:0;background:linear-gradient(90deg,transparent,var(--red),#c084fc,transparent);box-shadow:0 0 24px #ff245766}
.logo{font-size:clamp(29px,8vw,43px);font-weight:1000;letter-spacing:.4px;line-height:1.35;color:#fff;text-shadow:0 0 22px #d946ef65}
.sub{font-size:10px;font-weight:900;letter-spacing:3px;color:#df9dff;margin-top:8px}
.hero h1{font-size:24px}
.hero p{margin:9px 0 0;font-size:13px}
h1{font-size:25px;letter-spacing:-.5px}
p{color:#aaa9c2;line-height:1.8}
.cards{display:grid;grid-template-columns:1fr;gap:13px;margin-top:17px}
.card{
 position:relative;isolation:isolate;overflow:hidden;width:100%;min-height:123px;
 display:flex;align-items:center;text-align:right;gap:16px;padding:18px;
 border:1px solid #33263f;border-radius:23px;
 background:linear-gradient(120deg,#191522,#101019 75%);
 color:white;box-shadow:0 12px 26px #0004;
 transition:transform .22s,border-color .22s,box-shadow .22s
}
.card:before{content:"";position:absolute;z-index:-1;inset:0;background:linear-gradient(110deg,#ff24570d,transparent 52%,#a855f714)}
.card:after{content:"";position:absolute;right:0;top:17%;bottom:17%;width:3px;background:linear-gradient(transparent,var(--red),#c084fc,transparent);box-shadow:0 0 16px #ff245766}
.card:active{transform:scale(.975);border-color:#d34b86;box-shadow:0 0 24px #a21caf22}
.icon{
 position:relative;width:76px;height:76px;flex-shrink:0;display:grid;place-items:center;
 border:1px solid #55334f;border-radius:21px;
 background:radial-gradient(circle at 30% 20%,#462044,#21152e 65%,#13121f);
 font-size:40px;box-shadow:inset 0 1px #ffffff14,0 8px 22px #0005;
}
.card:nth-child(1) .icon{color:#ffe2a4;text-shadow:0 0 22px #ffc85777}
.card:nth-child(2) .icon{font-size:30px;color:#ff6d9c;text-shadow:0 0 20px #ff245766}
.card h2{font-size:19px;font-weight:950;margin:0 0 5px}
.card p{font-size:12px;margin:0;line-height:1.7}
.arrow{margin-right:auto;color:#ff6b9b;font-size:30px}
.footer{border-top:1px solid #ffffff0d;padding-top:16px;text-align:center;color:#79758f;font-size:10px;letter-spacing:2px;margin-top:24px}
.btn{border:1px solid #3a2b4a;border-radius:14px;padding:12px 15px;background:linear-gradient(145deg,#201a2c,#13131e);color:#f8efff;font-weight:750;transition:transform .18s,border-color .18s}
.btn:active{transform:scale(.96);border-color:#e3487c}
.btn.primary{background:linear-gradient(110deg,#ed174b,#a21caf 75%);border:1px solid #ff729b55;box-shadow:0 7px 22px #a21caf35;color:white;font-weight:900}
.actions{gap:9px;margin:17px 0}
.status{padding:13px 15px;border:1px solid #35263f;border-radius:15px;background:linear-gradient(110deg,#171320,#101019);color:#eee3fa;text-align:center;margin:13px 0;box-shadow:inset 0 1px #ffffff08}
.board{position:relative;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));width:100%;aspect-ratio:1;border:4px solid #36253f;border-radius:16px;overflow:hidden;box-shadow:0 18px 45px #0009,0 0 25px #a855f71c;direction:ltr}
.square{position:relative;display:grid;place-items:center;border:0;border-radius:0;padding:0;min-width:0;aspect-ratio:1;font-family:"Segoe UI Symbol","Noto Sans Symbols 2",serif;font-size:clamp(29px,8.7vw,49px);line-height:1;transition:filter .15s,box-shadow .15s}
.light{background:#eadfce;color:#25162b}
.dark{background:#75617e;color:#fff}
.square:active{filter:brightness(1.25)}
.square.selected{z-index:1;box-shadow:inset 0 0 0 4px #ffd45c;animation:gabSelect .65s ease-in-out infinite alternate}
.square.target:after{content:"";position:absolute;width:25%;height:25%;border-radius:50%;background:#38e8a0c9;box-shadow:0 0 12px #38e8a088;animation:gabTarget .65s ease-in-out infinite alternate}
.square.capture:after{content:"";position:absolute;inset:5%;border:3px solid #ff557b;border-radius:50%;box-shadow:0 0 12px #ff245755}
.square small{position:absolute;bottom:2px;left:3px;font:9px system-ui;opacity:.6}
.square.piece-white{color:#fffdf7!important;-webkit-text-stroke:.55px #312638;text-shadow:0 1px 2px #17101d,0 0 5px #fff5}
.square.piece-black{color:#17121b!important;-webkit-text-stroke:.45px #b7a8bd;text-shadow:0 1px 1px #fff5}
.piece-flight.piece-white{color:#fffdf7!important;-webkit-text-stroke:.55px #312638}
.piece-flight.piece-black{color:#17121b!important;-webkit-text-stroke:.45px #b7a8bd}

@keyframes gabSelect{to{box-shadow:inset 0 0 0 5px #fff0a0}}
@keyframes gabTarget{to{transform:scale(1.18);opacity:.7}}
.xoboard{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:18px;perspective:900px}
.xocell{
 position:relative;aspect-ratio:1;min-width:0;display:grid;place-items:center;overflow:hidden;
 border:1px solid #3a2c4c;border-radius:21px;
 background:linear-gradient(145deg,#211829,#11111b 70%);
 font-size:clamp(70px,21vw,108px);font-weight:950;line-height:1;color:#fff;
 box-shadow:inset 0 1px #ffffff0d,0 9px 20px #0005;
 transition:transform .16s,border-color .2s,background .2s,box-shadow .2s
}
.xocell:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 40%,#a855f711,transparent 68%);pointer-events:none}
.xocell:not(:disabled):active{transform:scale(.94)}
.xocell:disabled{cursor:default;opacity:1}
.xocell.x{color:#ff4d79;text-shadow:0 0 24px #ff245788;animation:gabX .32s cubic-bezier(.2,.8,.2,1);border-color:#a83b63}
.xocell.o{color:#68c8ff;text-shadow:0 0 24px #2585ff88;animation:gabO .32s cubic-bezier(.2,.8,.2,1);border-color:#326c9e}
.xocell.win{background:linear-gradient(145deg,#38253c,#201326);border-color:#ffd477;box-shadow:0 0 25px #ffc85738,inset 0 0 25px #ffc85716;animation:gabWin .65s ease-in-out infinite alternate}
@keyframes gabX{0%{transform:scale(.55) rotate(-15deg);opacity:.3}75%{transform:scale(1.12) rotate(3deg)}100%{transform:scale(1);opacity:1}}
@keyframes gabO{0%{transform:scale(.45);opacity:.2}75%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
@keyframes gabWin{to{box-shadow:0 0 32px #ffc85777,inset 0 0 25px #ffc8572a}}
@media(min-width:430px){.cards{grid-template-columns:1fr 1fr}.card{min-height:205px;display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:19px}.icon{width:82px;height:82px;margin-bottom:4px}.arrow{position:absolute;left:17px;bottom:17px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}


/* CHARACTER HUB + CHESS MOVE ANIMATION */
.character-stage{display:flex;flex-direction:column;align-items:stretch;gap:14px;margin:0 0 18px}
.character-art{display:block;width:100%;height:auto;aspect-ratio:49/20;object-fit:cover;object-position:center;border:1px solid #63345f;border-radius:16px;filter:drop-shadow(0 0 18px #ff245744)}
.character-info{min-width:0;text-align:center}
.character-name{font-size:22px;font-weight:1000;letter-spacing:1px;color:#fff;text-shadow:0 0 20px #ff245766}
.character-caption{font-size:10px;color:#e1a3ff;letter-spacing:2px;margin-top:6px}
.hero .character-info p{font-size:12px;margin:8px 0 0}
.card.soon{cursor:default;opacity:.86;border-style:dashed;border-color:#49304e}
.card.soon:active{transform:none;box-shadow:0 12px 26px #0004}
.soon-badge{display:inline-flex;margin-top:9px;padding:5px 9px;border-radius:99px;border:1px solid #65426c;background:#281a30;color:#e7baff;font-size:10px;font-weight:900}
.card.soon .icon{filter:saturate(.6)}
.piece-flight{position:fixed;z-index:99999;pointer-events:none;display:grid;place-items:center;line-height:1;font-family:"Segoe UI Symbol","Noto Sans Symbols 2",serif;text-shadow:0 3px 5px #0007;will-change:transform,left,top;filter:drop-shadow(0 0 9px #ffd47788)}

@media(min-width:430px){.character-art{width:100%;height:auto}}

/* GABIMARU 3D DEPTH ENGINE */
:root{--g3d-edge:#74409a;--g3d-glow:#a855f7;--g3d-shadow:#030208}
.app{perspective:1200px;transform-style:preserve-3d}
.hero,.star-intro{transform-style:preserve-3d;box-shadow:0 24px 0 -12px #10091b,0 34px 55px #000b,0 0 30px #a855f722,inset 0 2px 0 #ffffff20,inset 0 -4px 0 #05040b}
.hero{transform:rotateX(1deg)}
.card{transform-style:preserve-3d;border-color:#513263;box-shadow:0 7px 0 #100a19,0 12px 24px #0009,inset 0 1px 0 #ffffff22,inset 0 -2px 0 #05040b}
.card:not(.soon):active{transform:perspective(700px) rotateX(2deg) translateY(5px) scale(.985);box-shadow:0 2px 0 #100a19,0 5px 12px #0009,inset 0 1px 0 #ffffff20}
.icon{transform:translateZ(16px);border-color:#8b50ac;box-shadow:0 7px 0 #170c24,0 12px 20px #0009,inset 0 2px 0 #ffffff30,inset 0 -4px 0 #11091b}
.btn,.star-button{transform:translateZ(5px);box-shadow:0 5px 0 #12091c,0 9px 18px #0008,inset 0 1px 0 #ffffff30}
.btn:active,.star-button:active{transform:translateY(4px) translateZ(1px) scale(.98);box-shadow:0 1px 0 #12091c,0 3px 8px #0008,inset 0 1px 0 #ffffff20}
.board{transform:perspective(1100px) rotateX(2deg);transform-origin:center bottom;border:5px solid #513263;box-shadow:0 9px 0 #1a1024,0 17px 0 #0d0813,0 28px 42px #000c,0 0 26px #a855f72a,inset 0 2px 0 #ffffff30}
.square{box-shadow:inset 0 0 0 1px #00000012}
.square.piece-white{text-shadow:0 1px 0 #d9cce5,0 2px 0 #9887a9,0 3px 0 #5d4b70,0 5px 0 #271a32,0 7px 9px #000b,0 0 12px #ffffff45!important}
.square.piece-black{text-shadow:0 1px 0 #a79aaf,0 2px 0 #71637b,0 3px 0 #403347,0 5px 0 #160f1c,0 7px 9px #000d!important}
.xoboard{perspective:1000px;transform-style:preserve-3d;padding:2px 3px 10px}
.xocell{transform-style:preserve-3d;border-color:#684183;background:linear-gradient(145deg,#30203d 0%,#1b1226 48%,#0b0a12 100%);box-shadow:0 7px 0 #11091a,0 13px 19px #000b,inset 0 2px 0 #ffffff24,inset 0 -4px 0 #09060e;text-shadow:0 3px 0 #170b22,0 7px 12px #000c}
.xocell:not(:disabled):active{transform:translateY(5px) scale(.97);box-shadow:0 2px 0 #11091a,0 5px 10px #0009,inset 0 1px 0 #ffffff20}
.xocell.x{text-shadow:0 2px 0 #7b173c,0 4px 0 #3c1028,0 8px 18px #ff245777}
.xocell.o{text-shadow:0 2px 0 #164a79,0 4px 0 #102b4b,0 8px 18px #2585ff77}
.character-art{box-shadow:0 8px 0 #180d23,0 17px 28px #000b,0 0 24px #a855f733}
.star-mark{transform:translateZ(35px);filter:drop-shadow(0 10px 8px #0008)}
@media(prefers-reduced-motion:reduce){.hero,.board,.icon,.card,.btn,.star-button,.xocell{transition:none!important}}

/* GABIMARU PIECE DEPTH — FINAL OVERRIDE */
#board.board{
  overflow:hidden;
  border:5px solid #593675;
  box-shadow:0 8px 0 #21132d,0 15px 0 #100a17,0 25px 35px #000c,0 0 24px #a855f72b;
}
#board .square{
  overflow:hidden;
  transition:filter .16s,box-shadow .16s,transform .16s;
}
#board .square.light{background:linear-gradient(135deg,#f1dfc8,#c9b19a)}
#board .square.dark{background:linear-gradient(135deg,#79518e,#493052)}
#board .square.piece-white{
  color:#fffaf2!important;
  -webkit-text-stroke:.7px #49304f;
  text-shadow:0 1px 0 #d6c5db,0 2px 0 #9b83a5,0 4px 0 #594365,0 7px 9px #000b,0 0 13px #ffffff55!important;
}
#board .square.piece-black{
  color:#21172a!important;
  -webkit-text-stroke:.6px #c7b4d1;
  text-shadow:0 1px 0 #d0bfd8,0 2px 0 #887493,0 4px 0 #45314f,0 7px 9px #000c!important;
}
#board .square.selected{z-index:2;filter:brightness(1.3);box-shadow:inset 0 0 0 4px #ffd45c,0 0 18px #ffd45c66}
#board .square.target:after{box-shadow:0 0 12px #38e8a0aa}
#board .square.capture:after{box-shadow:0 0 14px #ff557b77}
#board .square small{z-index:1;color:#21132b;font-weight:800}
#board .piece-flight{filter:drop-shadow(0 8px 6px #000b)}
#board .square:focus-visible,.xoboard .xocell:focus-visible{outline:3px solid #d9a7ff;outline-offset:-4px}
.xoboard .xocell{
  position:relative;
  overflow:hidden;
  border:1px solid #8251a0;
  border-radius:15px;
  background:linear-gradient(145deg,#39254a 0%,#21142e 48%,#100b18 100%);
  box-shadow:0 7px 0 #160c20,0 13px 20px #000b,inset 0 2px 0 #ffffff24,inset 0 -4px 0 #09060e;
  transition:transform .16s,box-shadow .16s,filter .16s;
}
.xoboard .xocell:before{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  background:linear-gradient(135deg,#ffffff12,transparent 45%,#00000020);
}
.xoboard .xocell.x{color:#ff5b89;text-shadow:0 2px 0 #8a234b,0 5px 0 #45132c,0 9px 18px #ff245766}
.xoboard .xocell.o{color:#7bd4ff;text-shadow:0 2px 0 #225d8d,0 5px 0 #12334f,0 9px 18px #2585ff77}
.xoboard .xocell.win{border-color:#ffd477;box-shadow:0 7px 0 #342116,0 0 24px #ffc85755,inset 0 0 22px #ffc8571c}
@media(prefers-reduced-motion:reduce){
  #board .square,.xoboard .xocell{transition:none!important;animation:none!important}
}






/* GABIMARU 3D WORLD */
#gabimaru-3d-world {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -2;
  pointer-events: none;
}

/* GABIMARU THREE.JS SCENE */
#gabimaru-3d-bg {
  position:fixed; inset:0; width:100%; height:100%;
  z-index:-1; pointer-events:none; opacity:.72;
}

/* GABIMARU 3D UI UPGRADE */
:root {
  --g3d-bg:#080611;
  --g3d-panel:rgba(27,18,48,.88);
  --g3d-purple:#9b5cff;
  --g3d-glow:rgba(155,92,255,.28);
}
html { background:var(--g3d-bg); }
body {
  perspective:1200px;
  background:
    radial-gradient(ellipse at 50% 0%,#29134c 0%,transparent 48%),
    radial-gradient(ellipse at 100% 70%,#170d35 0%,transparent 45%),
    #080611 !important;
}
.top {
  position:relative;
  border:1px solid rgba(183,130,255,.35) !important;
  border-radius:18px !important;
  background:linear-gradient(145deg,rgba(49,28,78,.92),rgba(12,9,24,.96)) !important;
  box-shadow:0 12px 0 rgba(5,3,12,.7),0 18px 35px rgba(0,0,0,.42),
    inset 0 1px rgba(255,255,255,.12),0 0 24px var(--g3d-glow) !important;
}
.hero {
  position:relative;
  transform-style:preserve-3d;
  border:1px solid rgba(171,111,255,.3) !important;
  border-radius:24px !important;
  background:linear-gradient(145deg,rgba(42,24,70,.94),rgba(12,9,24,.97)) !important;
  box-shadow:0 10px 0 #10091f,0 20px 34px rgba(0,0,0,.4),
    inset 0 1px rgba(255,255,255,.1),0 0 28px rgba(139,72,255,.14) !important;
}
.btn,button {
  transform:translateY(0);
  transition:transform .16s ease,box-shadow .16s ease,filter .16s ease;
  border-color:rgba(180,125,255,.38) !important;
  box-shadow:0 5px 0 #211035,0 9px 18px rgba(0,0,0,.3),
    inset 0 1px rgba(255,255,255,.13) !important;
}
.btn:active,button:active {
  transform:translateY(4px) scale(.985);
  box-shadow:0 1px 0 #211035,inset 0 2px 7px rgba(0,0,0,.3) !important;
}
@media (hover:hover) {
  .btn:hover,button:hover {
    transform:translateY(-3px);
    filter:brightness(1.14);
    box-shadow:0 8px 0 #211035,0 13px 25px rgba(112,48,210,.24),
      inset 0 1px rgba(255,255,255,.2) !important;
  }
}
.card,.game-card,.tile,.panel,.menu-card,.game,.feature {
  transform-style:preserve-3d;
  border:1px solid rgba(173,119,255,.3) !important;
  background:linear-gradient(145deg,rgba(39,25,62,.96),rgba(14,10,27,.98)) !important;
  box-shadow:0 7px 0 #10091e,0 15px 25px rgba(0,0,0,.34),
    inset 0 1px rgba(255,255,255,.08) !important;
  transition:transform .2s ease,box-shadow .2s ease;
}
@media (hover:hover) {
  .card:hover,.game-card:hover,.tile:hover,.panel:hover,
  .menu-card:hover,.game:hover,.feature:hover {
    transform:translateY(-4px) rotateX(2deg);
    box-shadow:0 11px 0 #10091e,0 22px 32px rgba(105,42,190,.22) !important;
  }
}
.board {
  perspective:1000px;
  transform-style:preserve-3d;
  filter:drop-shadow(0 16px 18px rgba(0,0,0,.45));
}
.square {
  position:relative;
  transform-style:preserve-3d;
  text-shadow:0 2px 1px rgba(0,0,0,.45);
}
.status {
  border:1px solid rgba(167,111,255,.22) !important;
  background:linear-gradient(145deg,rgba(34,22,54,.9),rgba(12,9,24,.95)) !important;
  box-shadow:inset 0 1px rgba(255,255,255,.06),0 5px 14px rgba(0,0,0,.2);
}
a { transition:filter .18s ease; }
a:active { filter:brightness(1.2); }
@media (prefers-reduced-motion:reduce) {
  *,*::before,*::after { transition:none !important; animation:none !important; }
}

body>script{display:none!important}
</style>

<style id="gabimaru-touch-layer-fix">
#gabimaru-3d-world,
#gabimaru-3d-world canvas,
.gabimaru-3d-bg,
#three-bg,
canvas.gabimaru-three {
  pointer-events: none !important;
}
#board,
#board .square,
.square {
  position: relative;
  z-index: 20 !important;
  pointer-events: auto !important;
  touch-action: manipulation !important;
}
</style>
<script src="https://cdn.jsdelivr.net/npm/eruda"></script><script>eruda.init();</script></head>
<body><main class="app">${content}</main>${script || ""}

<script type="module">
(async () => {
  try {
const THREE = await import('/assets/three.module.js?v=' + Date.now());

    const canvas = document.createElement('canvas');
    canvas.id = 'gabimaru-3d-world';
    document.body.prepend(canvas);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", failIfMajorPerformanceCaveat: false,
      canvas,
      alpha: true,
      antialias: false
    });

    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
    renderer.setSize(innerWidth, innerHeight);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      55,
      innerWidth / innerHeight,
      0.1,
      100
    );

    camera.position.z = 11;

    scene.add(new THREE.AmbientLight(0x7b4bc4, 1.8));

    const light = new THREE.PointLight(0xa66cff, 35, 35);
    light.position.set(3, 5, 8);
    scene.add(light);

    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.IcosahedronGeometry(0.13, 1);

    const material = new THREE.MeshStandardMaterial({
      color: 0x9b5cff,
      emissive: 0x260040,
      emissiveIntensity: 1.4,
      metalness: 0.7,
      roughness: 0.22
    });

    const nodes = [];

    for (let i = 0; i < 75; i++) {
      const mesh = new THREE.Mesh(geometry, material);

      mesh.position.set(
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 8
      );

      mesh.userData = {
        x: mesh.position.x,
        y: mesh.position.y,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.6
      };

      group.add(mesh);
      nodes.push(mesh);
    }

    const ringGeometry = new THREE.TorusGeometry(3.8, 0.012, 8, 96);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x7d3cff,
      transparent: true,
      opacity: 0.18
    });

    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = 1.15;
    ring.position.z = -3;
    group.add(ring);

    let px = 0;
    let py = 0;

    window.addEventListener('pointermove', e => {
      px = (e.clientX / innerWidth - 0.5) * 0.7;
      py = (e.clientY / innerHeight - 0.5) * 0.4;
    }, { passive: true });

    window.addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });

    let t = 0;

    function animate() {
      requestAnimationFrame(animate);
      t += 0.006;

      group.rotation.y += (px * 0.18 - group.rotation.y) * 0.025;
      group.rotation.x += (-py * 0.12 - group.rotation.x) * 0.025;

      for (const n of nodes) {
        n.position.x =
          n.userData.x +
          Math.sin(t * n.userData.speed + n.userData.phase) * 0.12;

        n.position.y =
          n.userData.y +
          Math.cos(t * n.userData.speed + n.userData.phase) * 0.12;

        n.rotation.x += 0.003;
        n.rotation.y += 0.004;
      }

      ring.rotation.z += 0.0018;

      renderer.render(scene, camera);
    }

    animate();
    console.log('GABIMARU 3D WORLD ONLINE');

  } catch (error) {
    console.warn('Gabimaru 3D:', error.message);
  }
})();
</script>

<script>${script}</script>
</body></html>`;
}

function hubHTML() {
  return shell('Gabimaru Bot — Hell Arena', `
<style>
/* GABIMARU STAR INTRO */
.star-intro{position:relative;min-height:62vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden;border:1px solid #59304f;border-radius:28px;background:radial-gradient(ellipse at center,#351344 0%,#130d20 42%,#07070d 78%);padding:25px 16px;isolation:isolate}
.star-intro:before,.star-intro:after{content:"";position:absolute;width:220px;height:220px;border:1px solid #c084fc44;border-radius:50%;animation:starOrbit 9s linear infinite;z-index:-1}
.star-intro:after{width:300px;height:300px;border-color:#ff527e33;animation-duration:15s;animation-direction:reverse}
.star-mark{font-size:clamp(68px,22vw,112px);line-height:1;color:#ffe6a3;text-shadow:0 0 14px #ffd477,0 0 40px #a855f7,0 0 80px #a855f766;animation:starPulse 2.1s ease-in-out infinite}
.star-title{font-size:clamp(25px,7vw,40px);font-weight:1000;letter-spacing:3px;margin-top:20px;text-shadow:0 0 22px #a855f766}
.star-copy{font-size:12px;letter-spacing:3px;color:#c4afd9;margin-top:9px}
.star-button{margin-top:30px;min-width:190px;padding:16px 25px;border:1px solid #ffd477;border-radius:999px;color:#fff4d1;font-weight:1000;letter-spacing:3px;background:linear-gradient(110deg,#45134f,#9b174d,#50136d);box-shadow:0 0 22px #a855f744,inset 0 0 15px #fff1;animation:starButtonPulse 2s ease-in-out infinite}
.star-button:active{transform:scale(.96)}
.star-intro.leaving{animation:starLeave .7s ease forwards;pointer-events:none}
.arena-hidden{display:none!important}
.arena-ready{animation:arenaEnter .8s cubic-bezier(.2,.8,.2,1) both}
@keyframes starPulse{0%,100%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.08);filter:brightness(1.4)}}
@keyframes starButtonPulse{0%,100%{box-shadow:0 0 15px #a855f744}50%{box-shadow:0 0 34px #a855f799,0 0 60px #ff245722}}
@keyframes starOrbit{to{transform:rotate(360deg) scale(1.08)}}
@keyframes starLeave{to{opacity:0;transform:scale(1.12);filter:blur(8px)}}
@keyframes arenaEnter{from{opacity:0;transform:translateY(25px);filter:blur(5px)}to{opacity:1;transform:translateY(0);filter:blur(0)}}
@media(prefers-reduced-motion:reduce){.star-mark,.star-button,.star-intro:before,.star-intro:after{animation:none}}
</style>

<section class="star-intro" id="gabimaru-star-intro">
  <div class="star-mark" aria-hidden="true">✦</div>
  <div class="star-title">GABIMARU</div>
  <div class="star-copy">THE HELL NINJA · HELL MATRIX</div>
  <button class="star-button" id="gabimaru-star-button" type="button">★ STAR ★</button>
  <div class="sub" style="margin-top:22px">ENTER THE ARENA</div>
</section>

<div id="gabimaru-arena" class="arena-hidden">
<header class="top">
  <div class="brand">♛ GABIMARU <span style="color:#ff527e">/</span> HELL MATRIX</div>
  <div class="online">النظام جاهز</div>
</header>

<section class="hero">
  <div class="character-stage">
    <img class="character-art" src="/assets/gabimaru-hero-banner.png" alt="Gabimaru — Hell Ninja">
    <div class="character-info">
      <div class="sub">THE HELL NINJA</div>
      <div class="character-name">GABIMARU</div>
      <div class="character-caption">GABIMARU BOT</div>
      <p>اختر ساحتك وابدأ التحدي</p>
    </div>
  </div>
  <div class="sub">⛧ HELL MATRIX · TOUCH ARENA ⛧</div>
</section>

<section class="cards">
<button class="card" onclick="location.href='/game/chess-menu'">
  <div class="icon">♟</div><div><h2>ساحة الشطرنج</h2><p>خطط لحركاتك وسيطر على الرقعة</p></div><span class="arrow">‹</span>
</button>
<button class="card" onclick="location.href='/game/xo'">
  <div class="icon">𝑿𝑶</div><div><h2>ساحة XO</h2><p>معركة ذكاء وحركات متحركة</p></div><span class="arrow">‹</span>
</button>
<article class="card soon">
  <div class="icon">🏁</div><div><h2>سباق</h2><p>استعد للانطلاق والمنافسة</p><span class="soon-badge">◷ سيتوفر قريبًا</span></div>
</article>
<article class="card soon">
  <div class="icon">🁣</div><div><h2>دومينو</h2><p>خطط لقطعك وتغلّب على خصمك</p><span class="soon-badge">◷ سيتوفر قريبًا</span></div>
</article>
<article class="card soon">
  <div class="icon">🔎</div><div><h2>من القاتل؟</h2><p>لغز وتحقيق وتحديات بين اللاعبين</p><span class="soon-badge">◷ سيتوفر قريبًا</span></div>
</article>
</section>
<div class="footer">GABIMARU BOT · THE HELL ARENA</div>
</div>

<script>
(function(){
 const intro=document.getElementById('gabimaru-star-intro');
 const button=document.getElementById('gabimaru-star-button');
 const arena=document.getElementById('gabimaru-arena');
 if(!intro||!button||!arena)return;
 if(new URLSearchParams(window.location.search).get('arena')==='1'){
   intro.remove();
   arena.classList.remove('arena-hidden');
   arena.classList.add('arena-ready');
   return;
 }
 button.addEventListener('click',function(){
   if(button.disabled)return;
   button.disabled=true;
   intro.classList.add('leaving');
   window.setTimeout(function(){
     intro.remove();
     arena.classList.remove('arena-hidden');
     arena.classList.add('arena-ready');
     window.scrollTo({top:0,behavior:'smooth'});
   },650);
 });
})();
</script>
`);
}

function chessHTML(aiMode = false, aiLevel = 3) {
  const content = `
<header class="top">
  <button class="btn" onclick="location.href='/?arena=1'">← رجوع</button>
  <div class="brand">♟ GABIMARU CHESS 3D</div>
  <div class="online">3D</div>
</header>

<section class="hero">
  <div class="sub">THREE.JS CHESS ARENA</div>
  <h1>♟ الشطرنج ثلاثي الأبعاد</h1>
  <p>المس القطعة ثم المس المربع المضيء</p>
</section>

<div id="status" class="status">جارٍ تشغيل العالم ثلاثي الأبعاد...</div>

<div id="chess3d" style="
width:100%;
aspect-ratio:1 / 1;
height:auto;
min-height:0;
max-width:620px;
max-height:620px;
margin:10px auto;
position:relative;
overflow:hidden;
border-radius:18px;
background:#050208;
border:1px solid rgba(170,80,255,.35);
touch-action:none;
"></div>

<div class="actions">
<button class="btn" id="undo">↶ تراجع</button>
<button class="btn" id="flip">⇅ تدوير</button>
<button class="btn primary" id="restart">إعادة المباراة</button>
</div>

<div id="moves" class="status">النقلات: —</div>
`;

  const script = `
<script type="module">
(async()=>{

const AI_MODE = ${aiMode ? 'true' : 'false'};
const AI_LEVEL = ${aiLevel};
const THREE = await import('/assets/three.module.js?v=' + Date.now());

const root = document.getElementById('chess3d');
const status = document.getElementById('status');
const movesEl = document.getElementById('moves');

let scene;
let camera;
let renderer;
let raycaster;
let pointer;
let boardGroup;
let piecesGroup;
let marksGroup;

let gameId = '';
let position = null;
let selected = null;
let flipped = false;
let busy = false;

// ═══ AI MODE WATCHER ═══
if (typeof AI_MODE !== 'undefined' && AI_MODE) {
    let _aiLastCheck = 0;
    const _aiTick = async () => {
        if (!position || busy || position.over) return;
        if (position.turn !== 'b') return;
        if (Date.now() - _aiLastCheck < 1500) return;
        _aiLastCheck = Date.now();
        try {
            const ai = await api('/api/chess/ai-move', {id: gameId, level: AI_LEVEL});
            if (ai && ai.state) {
                position = ai.state;
                if (typeof render === 'function') render();
            }
        } catch(e) { console.error('[AI-MOVE]', e); }
    };
    setTimeout(() => setInterval(_aiTick, 600), 3000);
}
// ═══════════════════════

function api(path, body){
  return fetch(path,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body || {})
  }).then(async r=>{
    const d=await r.json();
    if(!r.ok || !d.ok) throw Error(d.error || 'حدث خطأ');
    return d;
  });
}

function material(color){
  return new THREE.MeshStandardMaterial({
    color:color,
    metalness:.45,
    roughness:.25
  });
}

function squarePosition(square){
  let file=square.charCodeAt(0)-97;
  let rank=8-Number(square[1]);

  if(flipped){
    file=7-file;
    rank=7-rank;
  }

  return {
    x:file-3.5,
    z:rank-3.5
  };
}


function makePiece(symbol) {
  const g = new THREE.Group();
  const white = '♔♕♖♗♘♙'.includes(symbol);
  const main = material(white ? 0xe9e0f5 : 0x21142b);
  const trim = material(white ? 0xb9a6d4 : 0x552477);
  const jewel = material(white ? 0x8e36d9 : 0xc45bff);

  function add(geometry, mat, x, y, z) {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  }

  function lathe(points, mat, y = 0, segments = 32) {
    return add(
      new THREE.LatheGeometry(
        points.map(p => new THREE.Vector2(p[0], p[1])),
        segments
      ), mat, 0, y, 0
    );
  }

  // Common stepped pedestal
  lathe([[.22,0],[.36,.035],[.40,.10],[.37,.16],[.29,.19]], trim);
  lathe([[.20,.16],[.25,.22],[.23,.28],[.17,.32]], main);
  lathe([[.15,.27],[.18,.34],[.16,.40]], trim);

  const type = symbol.toLowerCase();

  if (type === '♙' || type === '♟') {
    lathe([[.12,.34],[.16,.43],[.13,.57],[.09,.64]], main);
    add(new THREE.SphereGeometry(.155, 28, 20), main, 0, .72, 0);
  } else if (type === '♖' || type === '♜') {
    lathe([[.14,.34],[.21,.48],[.23,.72],[.25,.79],[.28,.83]], main);
    add(new THREE.CylinderGeometry(.29,.29,.09,32), trim, 0,.84,0);
    add(new THREE.CylinderGeometry(.25,.25,.16,32), main,0,.94,0);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4;
      add(new THREE.BoxGeometry(.13,.14,.13),trim,
        Math.cos(a)*.205,1.07,Math.sin(a)*.205);
    }
  } else if (type === '♘' || type === '♞') {
    // Distinct horse-head silhouette, extruded into a real 3D mesh
    const shape = new THREE.Shape();
    shape.moveTo(-.20,.36);
    shape.lineTo(-.17,.60);
    shape.lineTo(-.09,.76);
    shape.lineTo(-.02,.89);
    shape.lineTo(.04,.83);
    shape.lineTo(.13,.84);
    shape.lineTo(.20,.79);
    shape.lineTo(.12,.73);
    shape.lineTo(.09,.64);
    shape.lineTo(.19,.48);
    shape.lineTo(.17,.36);
    shape.closePath();
    const horse = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape,{
        depth:.18, bevelEnabled:true, bevelSegments:2,
        steps:1, bevelSize:.025, bevelThickness:.025
      }), main
    );
    horse.position.z=-.09;
    horse.castShadow=true;
    g.add(horse);
    add(new THREE.SphereGeometry(.035,12,10),jewel,.105,.77,.105);
    add(new THREE.BoxGeometry(.12,.045,.20),trim,0,.40,0);
  } else if (type === '♗' || type === '♝') {
    lathe([[.13,.34],[.19,.48],[.15,.61],[.10,.75],[.13,.84],[.19,.89],[.16,.94]],main);
    add(new THREE.SphereGeometry(.105,24,18),main,0,.99,0);
    add(new THREE.SphereGeometry(.045,16,12),jewel,0,1.09,0);
    const slash=add(new THREE.BoxGeometry(.055,.22,.055),trim,0,.78,0);
    slash.rotation.z=-.55;
  } else if (type === '♕' || type === '♛') {
    lathe([[.14,.34],[.20,.48],[.16,.62],[.13,.78],[.19,.88],[.25,.91]],main);
    lathe([[.22,.90],[.28,.94],[.27,1.00],[.22,1.03]],trim);
    for(let i=0;i<7;i++){
      const a=i*Math.PI*2/7;
      const x=Math.cos(a)*.22, z=Math.sin(a)*.22;
      add(new THREE.SphereGeometry(.055,16,12),jewel,x,1.09,z);
    }
    add(new THREE.SphereGeometry(.09,20,16),trim,0,1.12,0);
  } else {
    // King with a recognizable crown and cross
    lathe([[.14,.34],[.21,.49],[.17,.63],[.14,.79],[.20,.89],[.25,.93]],main);
    lathe([[.22,.92],[.28,.97],[.25,1.02]],trim);
    add(new THREE.BoxGeometry(.085,.31,.085),jewel,0,1.17,0);
    add(new THREE.BoxGeometry(.25,.075,.085),jewel,0,1.20,0);
  }

  g.userData.symbol = symbol;
  return g;
}

function setup(){

  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x050208);

  camera=new THREE.PerspectiveCamera(
    42,
    root.clientWidth/root.clientHeight,
    .1,
    100
  );

  // Player-side camera, angled enough to keep the full board visible
  camera.up.set(0,1,0);
  camera.position.set(0,10.5,11.5);
  camera.fov = 40;
  camera.lookAt(0,0,0);
  camera.updateProjectionMatrix();

  renderer=new THREE.WebGLRenderer({
    antialias: false
  });

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio,2)
  );

  renderer.setSize(
    root.clientWidth,
    root.clientHeight
  );

  renderer.shadowMap.enabled=true;

  root.innerHTML='';
  root.appendChild(renderer.domElement);

  raycaster=new THREE.Raycaster();
  pointer=new THREE.Vector2();

  scene.add(
    new THREE.AmbientLight(0xb66cff,.65)
  );

  const light=new THREE.DirectionalLight(
    0xffffff,
    2.5
  );

  light.position.set(4,10,5);
  light.castShadow=true;
  scene.add(light);

  const purple=new THREE.PointLight(
    0x9b35ff,
    20,
    18
  );

  purple.position.set(-4,5,-4);
  scene.add(purple);

  boardGroup=new THREE.Group();
  piecesGroup=new THREE.Group();
  marksGroup=new THREE.Group();

  scene.add(boardGroup);
  scene.add(piecesGroup);
  scene.add(marksGroup);

  const base=new THREE.Mesh(
    new THREE.BoxGeometry(8.7,.45,8.7),
    material(0x13091c)
  );

  base.position.y=-.1;
  base.receiveShadow=true;
  boardGroup.add(base);

  for(let row=0;row<8;row++){
    for(let col=0;col<8;col++){

      const tile=new THREE.Mesh(
        new THREE.BoxGeometry(.98,.15,.98),
        material(
          (row+col)%2
            ? 0x55256f
            : 0xd6bde2
        )
      );

      tile.position.set(
        col-3.5,
        .20,
        row-3.5
      );

      tile.userData.square=
        String.fromCharCode(97+col)+(8-row);

      tile.receiveShadow=true;

      boardGroup.add(tile);
    }
  }

  renderer.domElement.addEventListener(
    'pointerdown',
    select,
    {passive:false}
  );

  window.addEventListener('resize',resize);

  animate();
}

function clearGroup(group){
  while(group.children.length){
    const obj=group.children.pop();

    obj.traverse(o=>{
      if(o.geometry)o.geometry.dispose();
      if(o.material)o.material.dispose();
    });
  }
}

function render(){

  if(!position)return;

  clearGroup(piecesGroup);
  clearGroup(marksGroup);

  for(let row=0;row<8;row++){
    for(let col=0;col<8;col++){

      const symbol=position.board[row][col];

      if(!symbol)continue;

      const square=
        String.fromCharCode(97+col)+(8-row);

      const piece=makePiece(symbol);
      const pos=squarePosition(square);

      piece.position.set(
        pos.x,
        .30,
        pos.z
      );

      piece.userData.square=square;

      piecesGroup.add(piece);
    }
  }

  if(selected){

    for(const move of position.legal || []){

      if(move.from!==selected)continue;

      const pos=squarePosition(move.to);

      let mark;

      if(move.captured){
        // Capture target: a bright ring around the enemy piece
        mark=new THREE.Mesh(
          new THREE.TorusGeometry(.36,.055,12,40),
          new THREE.MeshBasicMaterial({
            color:0xff315f,
            transparent:true,
            opacity:1,
            depthTest:false
          })
        );
        mark.rotation.x=Math.PI/2;
        mark.position.set(pos.x,.48,pos.z);
        mark.renderOrder=10;
      } else {
        // Empty legal destination: a smaller glowing dot
        mark=new THREE.Mesh(
          new THREE.CylinderGeometry(.15,.15,.045,28),
          new THREE.MeshBasicMaterial({
            color:0xd94dff,
            transparent:true,
            opacity:.9,
            depthTest:false
          })
        );
        mark.position.set(pos.x,.34,pos.z);
        mark.renderOrder=9;
      }

      mark.userData.square=move.to;
      marksGroup.add(mark);
    }
  }

  status.textContent=
    position.status ||
    (position.turn==='w'
      ? 'دور الأبيض'
      : 'دور الأسود');

  movesEl.textContent=
    'النقلات: '+
    (position.moves?.length
      ? position.moves.join(' · ')
      : '—');
}

async function move(from,to){

  if(busy)return;

  const possible=(position.legal||[]).filter(
    m=>m.from===from && m.to===to
  );

  if(!possible.length)return;

  let promotion=null;

  if(possible.some(m=>m.promotion)){
    promotion=(prompt(
      'q وزير | r قلعة | b فيل | n حصان',
      'q'
    )||'q').toLowerCase();

    if(!['q','r','b','n'].includes(promotion))
      promotion='q';
  }

  busy=true;

  try{

    const obj=piecesGroup.children.find(
      p=>p.userData.square===from
    );

    const before=obj
      ? obj.position.clone()
      : null;

    const d=await api(
      '/api/chess/move',
      {
        id:gameId,
        from,
        to,
        promotion
      }
    );

    position=d.state;

    if(obj){

      const target=squarePosition(to);

      const startTime=performance.now();

      await new Promise(resolve=>{

        function animateMove(now){

          const t=Math.min(
            1,
            (now-startTime)/350
          );

          const e=1-Math.pow(1-t,3);

          obj.position.x=
            before.x+(target.x-before.x)*e;

          obj.position.z=
            before.z+(target.z-before.z)*e;

          obj.position.y=
            .30+Math.sin(t*Math.PI)*.55;

          obj.rotation.y+=.07;

          if(t<1)
            requestAnimationFrame(animateMove);
          else
            resolve();
        }

        requestAnimationFrame(animateMove);
      });
    }

    selected=null;
    render();

  }catch(e){

    status.textContent='خطأ: '+e.message;

  }finally{

    busy=false;

  }
}

function select(e){

  if(busy || !position || position.over)return;

  e.preventDefault();

  const rect=renderer.domElement.getBoundingClientRect();

  pointer.x=
    ((e.clientX-rect.left)/rect.width)*2-1;

  pointer.y=
    -((e.clientY-rect.top)/rect.height)*2+1;

  raycaster.setFromCamera(
    pointer,
    camera
  );

  const pieces=raycaster.intersectObjects(
    piecesGroup.children,
    true
  );

  if(pieces.length){

    let obj=pieces[0].object;

    while(
      obj.parent &&
      obj.parent!==piecesGroup
    ){
      obj=obj.parent;
    }

    const square=obj.userData.square;

    if(square){

      if(selected){

        const valid=(position.legal||[]).some(
          m=>m.from===selected &&
             m.to===square
        );

        if(valid){
          move(selected,square);
          return;
        }
      }

      if(
        (position.legal||[]).some(
          m=>m.from===square
        )
      ){
        selected=square;
        render();
        return;
      }
    }
  }

  const marks=raycaster.intersectObjects(
    marksGroup.children,
    false
  );

  if(marks.length && selected){

    const square=
      marks[0].object.userData.square;

    if(square){
      move(selected,square);
      return;
    }
  }

  selected=null;
  render();
}

async function restart(){

  const d=await api(
    '/api/chess/new',
    {}
  );

  gameId=d.state.id;
  position=d.state;
  selected=null;

  render();
}

async function undo(){

  const d=await api(
    '/api/chess/undo',
    {id:gameId}
  );

  position=d.state;
  selected=null;

  render();
}

function resize(){

  camera.aspect=
    root.clientWidth/root.clientHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    root.clientWidth,
    root.clientHeight
  );
}

function animate(){
  requestAnimationFrame(animate);

  if(!renderer || !scene || !camera) return;

  const blackTurn = position && position.turn === 'b';
  const target = {
    x: 0,
    y: 10.5,
    z: blackTurn ? -11.5 : 11.5
  };
  const smooth = 0.04;

  camera.position.x += (target.x - camera.position.x) * smooth;
  camera.position.y += (target.y - camera.position.y) * smooth;
  camera.position.z += (target.z - camera.position.z) * smooth;
  camera.lookAt(0,0,0);

  renderer.render(scene,camera);
}

document.getElementById('restart').onclick=
  restart;

document.getElementById('undo').onclick=
  undo;

document.getElementById('flip').onclick=()=>{
  flipped=!flipped;
  render();
};

setup();

try{
  await restart();
}catch(e){
  status.textContent=
    'تعذر تشغيل الشطرنج: '+e.message;
}

})();
</script>`;

  return shell('Gabimaru Chess 3D', content, script);
}

function xoHTML() {
  const content = `<header class="top"><button class="btn" onclick="location.href='/?arena=1'">← رجوع</button><div class="brand">GABIMARU / XO</div><div class="online">محلي</div></header>
<section class="hero"><div class="sub">MIND BATTLE · 3 × 3</div><div class="logo"><span style="color:#ff4d79">𝑿</span> <span style="color:#68c8ff">𝑶</span></div><h1>ساحة التحدي</h1><p>لا تترك لخصمك فرصة — اصنع خط الفوز</p></section>
<div id="status" class="status">دور ❌</div><div id="board" class="xoboard"></div>
<div class="actions"><button class="btn primary" id="restart">↻ إعادة المباراة</button><button class="btn" onclick="location.href='/?arena=1'">⌂ ساحة الألعاب</button></div>
<div class="footer">GABIMARU · TOUCH ARENA</div>`;
  const script = `
const board=document.getElementById('board'),status=document.getElementById('status');
let cells=Array(9).fill(''),turn='X',ended=false,winning=[];
const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function render(){
 board.innerHTML='';
 cells.forEach((v,i)=>{
  const b=document.createElement('button');
  b.className='xocell '+(v==='X'?'x':v==='O'?'o':'')+(winning.includes(i)?' win':'');
  b.textContent=v==='X'?'×':v==='O'?'○':'';
  b.setAttribute('aria-label','المربع '+(i+1));
  b.disabled=!!v||ended;b.onclick=()=>move(i);board.appendChild(b);
 });
 if(winning.length===3){
  requestAnimationFrame(()=>{
   const buttons=[...board.querySelectorAll('.xocell')];
   if(winning.some(i=>!buttons[i]))return;
   const br=board.getBoundingClientRect();
   const points=winning.map(i=>{
    const r=buttons[i].getBoundingClientRect();
    return {x:r.left+r.width/2-br.left,y:r.top+r.height/2-br.top};
   });
   const first=points[0],last=points[2];
   const dx=last.x-first.x,dy=last.y-first.y;
   const length=Math.hypot(dx,dy);
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
   svg.setAttribute('viewBox','0 0 '+br.width+' '+br.height);
   svg.setAttribute('preserveAspectRatio','none');
   svg.setAttribute('class','win-overlay');
   svg.setAttribute('aria-hidden','true');
   svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;overflow:visible';
   const line=document.createElementNS('http://www.w3.org/2000/svg','line');
   line.setAttribute('x1',first.x);line.setAttribute('y1',first.y);
   line.setAttribute('x2',last.x);line.setAttribute('y2',last.y);
   line.setAttribute('stroke','#ffd477');line.setAttribute('stroke-width',Math.max(4,br.width*.016));
   line.setAttribute('stroke-linecap','round');
   line.style.filter='drop-shadow(0 0 5px #ffd477)';
   line.style.strokeDasharray=String(length);
   line.style.strokeDashoffset=String(length);
   svg.appendChild(line);board.appendChild(svg);
   line.animate([{strokeDashoffset:length},{strokeDashoffset:0}],{duration:420,easing:'ease-out',fill:'forwards'});
  });
 }
}
function move(i){
 if(ended||cells[i])return;
 cells[i]=turn;
 const win=wins.find(line=>line.every(n=>cells[n]===turn));
 if(win){ended=true;winning=win;status.textContent=(turn==='X'?'❌':'⭕')+' فاز بالمباراة 🏆';}
 else if(cells.every(Boolean)){ended=true;status.textContent='تعادل 🤝';}
 else{turn=turn==='X'?'O':'X';status.textContent='دور '+(turn==='X'?'❌':'⭕');}
 render();
}
function reset(){cells=Array(9).fill('');turn='X';ended=false;winning=[];status.textContent='دور ❌';render();}
document.getElementById('restart').onclick=reset;reset();`;
  return shell('Gabimaru XO', content, script);
}

const server = http.createServer(async (req, res) => {// REQUEST-LOGGER
        res.on('finish', () => {
            const ct = res.getHeader('Content-Type') || '';
            if (req.url.includes('.js') || req.url.includes('.glb') || req.url.includes('.gltf') || req.url.includes('.wasm')) {
                const isBad = !ct.includes('javascript') && !ct.includes('octet-stream');
                const prefix = isBad ? '🚨 [BAD]' : '✅ [OK]';
                console.log(prefix + ' ' + req.method + ' ' + req.url + ' → ' + res.statusCode + ' | ' + ct.split(';')[0]);
            }
        });
        
      const url = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'GET' && url.pathname === '/assets/gabimaru-hero-banner.png') {
      const fs = require('fs');
      const imagePath = require('path').join(__dirname, 'assets', 'gabimaru-hero-banner.png');
      if (!fs.existsSync(imagePath)) return send(res, 404, {ok:false,error:'الصورة غير موجودة'});
      res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return fs.createReadStream(imagePath).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/') return send(res,200,hubHTML(),'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/game/ai-levels') {
      try {
        const p = path.join(__dirname, 'public', 'ai-levels.html');
        return send(res, 200, fs.readFileSync(p, 'utf8'), 'text/html; charset=utf-8');
      } catch(e) {
        return send(res, 500, 'Levels not found: ' + e.message, 'text/plain');
      }
    }
    if (req.method === 'GET' && url.pathname === '/game/chess-menu') {
      try {
        const menuPath = path.join(__dirname, 'public', 'chess-menu.html');
        const menuHtml = fs.readFileSync(menuPath, 'utf8');
        return send(res, 200, menuHtml, 'text/html; charset=utf-8');
      } catch(e) {
        return send(res, 500, 'Menu not found', 'text/plain');
      }
    }
    if (req.method === 'GET' && url.pathname === '/game/chess-ai') {
      try {
        const levelParam = parseInt(url.searchParams?.get('level'));
        const level = (!isNaN(levelParam) && levelParam >= 1 && levelParam <= 4) ? levelParam : 3;
        const html = chessHTML(true, level);
        return send(res, 200, html, 'text/html; charset=utf-8');
      } catch(e) {
        console.error('[CHESS-AI-ERR]', e.message);
        console.error(e.stack);
        return send(res, 500, 'AI Error: ' + e.message, 'text/plain');
      }
    }
    if (req.method === 'GET' && url.pathname === '/game/chess') return send(res,200,chessHTML(),'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/game/xo') return send(res,200,xoHTML(),'text/html; charset=utf-8');
    // no-store on three
    if (req.method === 'GET' && url.pathname.startsWith('/assets/three')) {
      const file = path.basename(url.pathname);
      const asset = path.join(__dirname, '..', 'node_modules', 'three', 'build', file);
      if (!fs.existsSync(asset)) {
        return send(res, 404, {ok:false,error:'Three asset not found'});
      }
      res.writeHead(200, {
        'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      return fs.createReadStream(asset).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/assets/three.core.js') {
      const corePath = path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.core.js');
      if (!fs.existsSync(corePath)) return send(res, 404, 'not found', 'text/plain');
      res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache','Access-Control-Allow-Origin':'*'});
      return fs.createReadStream(corePath).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/assets/three.module.js') {
      const asset = path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.js');
      if (!fs.existsSync(asset)) {
        return send(res, 404, {ok:false,error:'Three.js file not found'});
      }
      res.writeHead(200, {
        'Content-Type':'text/javascript; charset=utf-8',
        'Cache-Control':'no-cache',
        'Access-Control-Allow-Origin':'*'
      });
      return fs.createReadStream(asset).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ok:true,name:'Gabimaru Touch',uptime:process.uptime()});

    if (req.method === 'POST' && url.pathname === '/api/chess/new') {
      const game = {id:crypto.randomBytes(16).toString('hex'),chess:new Chess(),history:[]};
      chessGames.set(game.id,game);
      return send(res,200,{ok:true,state:chessState(game)});
    }

    if (req.method === 'POST' && url.pathname === '/api/chess/move') {
      const data = await readBody(req), game = chessGames.get(String(data.id || ''));
      if (!game) return send(res,404,{ok:false,error:'المباراة غير موجودة؛ ابدأ مباراة جديدة.'});
      if (game.chess.isGameOver()) return send(res,409,{ok:false,error:'انتهت المباراة.'});
      const before = game.chess.fen();
      let move;
      try { move = game.chess.move({from:data.from,to:data.to,promotion:data.promotion || 'q'}); }
      catch {}
      if (!move) return send(res,400,{ok:false,error:'نقلة غير قانونية.'});
      game.history.push(before);
      return send(res,200,{ok:true,state:chessState(game)});
    }

    if (req.method === 'POST' && url.pathname === '/api/chess/ai-move') {
      const data = await readBody(req);
      const game = chessGames.get(String(data.id || ''));
      if (!game) return send(res,404,{ok:false,error:'المباراة غير موجودة.'});
      if (game.chess.isGameOver()) return send(res,409,{ok:false,error:'انتهت المباراة.'});
      if (game.chess.turn() !== 'b') return send(res,400,{ok:false,error:'ليس دور AI.'});
      const before = game.chess.fen();
      try {
        const level = Math.min(Math.max(parseInt(data.level) || 3, 1), 4);
        const aiMove = aiBestMove(game.chess, level);
        if (!aiMove) return send(res,500,{ok:false,error:'AI لم يجد نقلة.'});
        game.chess.move(aiMove);
        game.history.push(before);
        return send(res,200,{ok:true,state:chessState(game),aiMove:{from:aiMove.from,to:aiMove.to}});
      } catch(e) {
        return send(res,500,{ok:false,error:'AI error: ' + e.message});
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/chess/undo') {
      const data = await readBody(req), game = chessGames.get(String(data.id || ''));
      if (!game) return send(res,404,{ok:false,error:'المباراة غير موجودة.'});
      const fen = game.history.pop();
      if (fen) game.chess.load(fen);
      return send(res,200,{ok:true,state:chessState(game)});
    }

// --- STATIC FILES SERVING ---
if (req.method === 'GET') {
  let filePath = url.pathname;
  if (filePath === '/') filePath = '/chess-menu.html';
  
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  const fullPath = path.join(__dirname, 'public', filePath);
  if (!filePath.includes('..') && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    return fs.createReadStream(fullPath).pipe(res);
  }
}
// ----------------------------    
return send(res,404,{ok:false,error:'NOT_FOUND'});
  } catch (error) {
    console.error('❌ TOUCH SERVER ERROR:', error);
    return send(res,500,{ok:false,error:error.message || String(error)});
  }
});

server.listen(PORT, HOST, () => {
  console.log('🔥 Gabimaru Touch V2');
  console.log('🌐 http://127.0.0.1:' + PORT);
  console.log('♟️ Chess legal-move engine ready');
  console.log('❌⭕ XO touch UI ready');
});

server.on('error', err => {
  console.error('Touch server error:', err.message);
});
