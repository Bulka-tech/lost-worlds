/* Lost Worlds — Way Home (Hollow-Knight vibe)
   Single file: engine + levels + procedural audio (WebAudio)
   Paste as script.js
*/

/* -------------------------
   CONFIG
   ------------------------- */
const TILE = { EMPTY:0, DIRT:1, STONE:2, GRASS:3, SOUL:4, HEART:5, SPAWN:9, ENEMY:8, EXIT:7 };
const TILE_SIZE = 16;
const SCALE = 3;
const VPORT_W = 320;
const VPORT_H = 180;
const GRAVITY = 0.9;
const MAX_FALL = 18;

/* -------------------------
   WebAudio: music and SFX synths
   ------------------------- */
const AudioEngine = (() => {
  let ctx = null;
  let masterGain = null;
  let mute = false;
  let musicNode = null;
  let ambientStart = 0;
  let bossStart = 0;
  function init(){
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.9;
      masterGain.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
  }

  // simple beep fx using oscillator
  function playBeep({ freq=440, dur=0.08, type='sine', gain=0.06, detune=0 } = {}){
    if (!ctx) init();
    if (!ctx || mute) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(masterGain);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  // small noise burst for hits/explosion
  function playNoise({dur=0.12, gain=0.08, color='white'} = {}){
    if (!ctx) init();
    if (!ctx || mute) return;
    const bufferSize = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++){
      data[i] = (Math.random()*2 - 1) * (color === 'white' ? 1 : 0.6);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g); g.connect(masterGain);
    src.start();
  }

  // ambient music: simple layered drones + sparse bell motif
  function startAmbient(){
    if (!ctx) init();
    if (!ctx || mute) return;
    stopMusic();

    const now = ctx.currentTime;

    // drone oscillator 1
    const d1 = ctx.createOscillator();
    d1.type = 'sine';
    d1.frequency.value = 55; // low drone
    const g1 = ctx.createGain();
    g1.gain.value = 0.08;
    d1.connect(g1); g1.connect(masterGain);
    d1.start(now);

    // drone 2 (slightly detuned)
    const d2 = ctx.createOscillator();
    d2.type = 'sine';
    d2.frequency.value = 65.4;
    const g2 = ctx.createGain(); g2.gain.value = 0.045;
    d2.connect(g2); g2.connect(masterGain);
    d2.start(now);

    // sparse bells using periodic scheduled bell hits
    const bellInterval = 5; // seconds
    let bellTimer = 0;
    const bellP = ctx.createScriptProcessor ? ctx.createScriptProcessor(256) : null;

    // create a simple node to stop later
    musicNode = { nodes: [d1,d2], stop() {
      d1.stop(); d2.stop();
      try { if (bellP) bellP.disconnect(); } catch(e){}
    }};

    // schedule bell hits with timeouts (approximate)
    function scheduleBell(){
      if (!musicNode) return;
      const t = ctx.currentTime + (2 + Math.random()*6);
      const freqs = [370, 523, 440, 311];
      const f = freqs[Math.floor(Math.random()*freqs.length)];
      // tiny bell
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (0.5 + Math.random()*1.2);
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8 + Math.random()*1.4);
      const filt = ctx.createBiquadFilter();
      filt.type = 'highpass';
      filt.frequency.value = 300;
      o.connect(filt); filt.connect(g); g.connect(masterGain);
      o.start(t);
      o.stop(t + 2.4);
      // schedule another bell later
      setTimeout(scheduleBell, 2000 + Math.random()*6000);
    }
    scheduleBell();
  }

  function startBossMusic(){
    if (!ctx) init();
    if (!ctx || mute) return;
    stopMusic();
    const now = ctx.currentTime;
    // lower, aggressive drone + pulsing percussive ticks
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 42;
    const g = ctx.createGain(); g.gain.value = 0.07;
    o.connect(g); g.connect(masterGain); o.start(now);

    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.6;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    lfo.start(now);

    // metallic hit loop using periodic noise
    let interval = setInterval(()=>{
      playNoise({dur:0.06, gain:0.06});
      playBeep({freq:220, dur:0.08, gain:0.05, type:'square'});
    }, 520);

    musicNode = { nodes: [o, lfo], stop() { o.stop(); lfo.stop(); clearInterval(interval); } };
  }

  function stopMusic(){
    if (musicNode && musicNode.stop) {
      try { musicNode.stop(); } catch(e){}
      musicNode = null;
    }
  }

  function setMute(v){
    mute = !!v;
    if (mute) stopMusic();
  }

  return {
    init, playBeep, playNoise, startAmbient, startBossMusic, stopMusic, setMute,
    ctxRef: () => ctx
  };
})();

/* -------------------------
   BASIC GAME ENGINE (pixel platformer)
   ------------------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VPORT_W;
canvas.height = VPORT_H;
canvas.style.width = `${VPORT_W * SCALE}px`;
canvas.style.height = `${VPORT_H * SCALE}px`;
canvas.addEventListener('click', ()=> { canvas.focus(); if (AudioEngine.ctxRef() && AudioEngine.ctxRef().state === 'suspended') AudioEngine.ctxRef().resume(); });

/* -------------------------
   LEVELS (dark/moody maps)
   ------------------------- */
const LEVELS = [
  {
    id:0, title:"Waking Hollow", objective:"Reach the faint light on the right.", story:"You wake under cold stone. The air hums.", map:[
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,4,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0],
      [9,0,0,0,1,0,0,0,0,0,0,0,0,1,1,0,0,0,0,8],
      new Array(20).fill(2),
      new Array(20).fill(2)
    ]
  },
  {
    id:1, title:"Shaded Glade", objective:"Find more souls and head deeper.", story:"A quiet grove. Shadows move.", map:[
      [0,0,0,0,4,0,0,0,0,0,0,0,5,0,0,0,0,0],
      [0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,8],
      [9,0,0,0,1,1,0,1,1,0,0,0,0,1,3,1],
      new Array(20).fill(2),
      new Array(20).fill(2)
    ]
  },
  {
    id:2, title:"Cavern of Echoes", objective:"Descend and reach the crystal chamber.", story:"Your footsteps echo. The ground feels alive.", map:[
      [0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0],
      [0,8,0,0,0,0,0,0,0,0,0,4,0,0,0,0],
      [9,0,0,0,1,1,0,1,3,1,0,0,0,0,0,0],
      new Array(16).fill(2),
      new Array(16).fill(2)
    ]
  },
  {
    id:3, title:"Ruined Sanctum", objective:"Solve the rune puzzle to reach the Core.", story:"Ruins whisper ancient patterns.", map:[
      [0,0,0,0,4,0,0,0,0,0,0,0,0,0],
      [0,0,0,5,0,0,0,0,0,0,0,0,8,0],
      [9,0,0,1,1,1,0,1,3,1,0,0,0,0],
      new Array(14).fill(2),
      new Array(14).fill(2)
    ]
  },
  {
    id:4, title:"The Core - Final", objective:"Defeat the Core Guardian and find the portal home.", story:"A heavy pulse fills the air.", map:[
      [0,0,0,0,0,0,4,0,0,0,0,0],
      [9,0,0,0,0,0,0,0,0,0,8,0],
      new Array(12).fill(2),
      new Array(12).fill(2),
      new Array(12).fill(2)
    ]
  }
];

let currentLevel = 0;
let LEVEL_MAP = LEVELS[0].map.map(r=>r.slice());
let cols = LEVEL_MAP[0].length;
let rows = LEVEL_MAP.length;

/* -------------------------
   WORLD, PLAYER, ENTITIES
   ------------------------- */
let cam = { x:0, y:0, shake:0 };
let particles = [];
let enemies = [];
let boss = null;

const player = {
  x: 32, y: 32, w:12, h:16, vx:0, vy:0,
  speed:1.6, maxSpeed:4.2, onGround:false, canDoubleJump:true,
  facing:1, health:5, souls:0, dashCooldown:0, _jumped:false, _used:false
};

/* -------------------------
   AUDIO FX wrappers (use synths)
   ------------------------- */
function sfxJump(){ AudioEngine.playBeep({freq:720, dur:0.08, type:'square', gain:0.06}); }
function sfxLand(){ AudioEngine.playBeep({freq:220, dur:0.06, type:'sine', gain:0.04}); AudioEngine.playNoise({dur:0.06, gain:0.04}); }
function sfxHit(){ AudioEngine.playNoise({dur:0.12, gain:0.08}); AudioEngine.playBeep({freq:180, dur:0.06, type:'sawtooth', gain:0.06}); }
function sfxCollect(){ AudioEngine.playBeep({freq:1100, dur:0.06, type:'sine', gain:0.06}); }
function sfxPortal(){ AudioEngine.playBeep({freq:520, dur:0.18, type:'sine', gain:0.09}); AudioEngine.playNoise({dur:0.2, gain:0.06}); }

/* -------------------------
   UTILS
   ------------------------- */
function rand(min,max){return Math.random()*(max-min)+min;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function rectsIntersect(a,b){ const aw = a.w ?? 4, ah = a.h ?? 4, bw = b.w ?? 4, bh = b.h ?? 4; return a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y; }
function tileAt(px,py){ const tx = Math.floor(px / TILE_SIZE), ty = Math.floor(py / TILE_SIZE); if (ty<0||ty>=rows||tx<0||tx>=cols) return TILE.EMPTY; return LEVEL_MAP[ty][tx] ?? TILE.EMPTY; }
function setTile(tx,ty,val){ if (ty<0||ty>=rows||tx<0||tx>=cols) return; LEVEL_MAP[ty][tx]=val; }
function spawnParticle(x,y,c={color:'#fff',size:1,vx:0,vy:-1,life:40}){ particles.push(Object.assign({x,y,life:40},c)); }

/* -------------------------
   RENDERING & PALETTE (dark)
   ------------------------- */
const palette = {
  bg1:'#041018', bg2:'#071426', dirt:'#3a2b2a', stone:'#4a5058', grass:'#2f6b5f', soul:'#d4f0ff', heart:'#ff8fa0', player:'#cfe8ff', enemy:'#cdaeff', boss:'#ff9b9b'
};
function drawRect(x,y,w,h,color){ ctx.fillStyle = color; ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h)); }

/* -------------------------
   INPUT
   ------------------------- */
let keys = {};
window.addEventListener('keydown', (e) => { keys[e.code]=true; if (['Space','KeyW','ArrowUp'].includes(e.code)) e.preventDefault(); });
window.addEventListener('keyup', (e) => { keys[e.code]=false; });

/* -------------------------
   ENEMY simple patroller
   ------------------------- */
class Enemy {
  constructor(x,y){
    this.x=x; this.y=y; this.w=12; this.h=12; this.vx = rand(0.6,1.2)*(Math.random()<0.5?-1:1); this.vy=0; this.life=2; this.active=true;
  }
  update(){
    this.vy += GRAVITY*0.15; this.vy = clamp(this.vy, -MAX_FALL, MAX_FALL);
    if (tileAt(this.x + (this.vx>0? this.w+1 : -1), this.y + this.h/2) !== TILE.EMPTY) this.vx *= -1;
    this.x += this.vx; this.y += this.vy;
    if (tileAt(this.x + this.w/2, this.y + this.h) !== TILE.EMPTY){
      this.y = Math.floor((this.y + this.h) / TILE_SIZE) * TILE_SIZE - this.h; this.vy = 0;
    }
    if (rectsIntersect(this, player) && this.active){
      hurtPlayer(1); this.vx *= -1; this.active=false; for (let i=0;i<6;i++) spawnParticle(this.x + this.w/2, this.y + this.h/2, {color:palette.enemy, size:2, vx:rand(-1,1), vy:rand(-2,-0.2)}); sfxHit(); setTimeout(()=> this.active=true,600);
    }
  }
  draw(){ drawRect(this.x-cam.x, this.y-cam.y, this.w, this.h, palette.enemy); }
}

/* -------------------------
   BOSS (Core Guardian) — similar to previous but tuned for mood
   ------------------------- */
class CoreGuardian {
  constructor(x,y){
    this.x=x; this.y=y; this.w=64; this.h=64; this.centerX = x + this.w/2; this.centerY = y + this.h/2;
    this.maxHealth = 36; this.health=this.maxHealth; this.phase=0; this.shieldHealth=14; this.projectiles=[]; this.alive=true; this.timer=0;
  }
  receiveHit(d){
    if (this.phase===0){ this.shieldHealth -= d; this.timer += d*6; if (this.shieldHealth<=0){ this.phase=1; AudioEngine.startBossMusic(); showNarrative("Shield Broken","The Core's shield collapses — strike the heart!"); sfxHit(); } return false; }
    this.health -= d; sfxHit();
    if (this.health<=0) this.die();
    if (this.health <= this.maxHealth*0.35 && this.phase<2){ this.phase=2; showNarrative("Core Enraged","Attacks intensify!"); }
    return true;
  }
  die(){ this.alive=false; for (let i=0;i<120;i++) spawnParticle(this.centerX-cam.x + rand(-40,40), this.centerY-cam.y + rand(-40,40), {color:'#ffd6d6', size: rand(2,4), vx:rand(-4,4), vy:rand(-6,-1)}); sfxPortal(); showNarrative("Core Destroyed","A portal opens... Perhaps this leads home."); setTimeout(()=>{ setTile(cols-2, rows-2, TILE.EXIT); }, 600); AudioEngine.stopMusic(); saveProgress(-1); }
  update(dt){
    if (!this.alive) return;
    this.timer += dt * 0.06;
    // spawn homing projectiles more when enraged
    if (Math.random() < (this.phase===2 ? 0.03 : 0.015)){
      const px = this.centerX + rand(-10,10), py = this.centerY + rand(-10,10);
      const angle = Math.atan2(player.y - py, player.x - px);
      const spd = (this.phase===2? rand(2.6,3.4) : rand(1.6,2.4));
      this.projectiles.push({x:px, y:py, vx:Math.cos(angle)*spd + rand(-0.3,0.3), vy:Math.sin(angle)*spd + rand(-0.3,0.3), life:600});
    }
    for (let i=this.projectiles.length-1;i>=0;i--){
      const pr = this.projectiles[i];
      pr.vy += 0.02; pr.x += pr.vx; pr.y += pr.vy; pr.life -= dt;
      if (rectsIntersect(pr, player)){ hurtPlayer(1); this.projectiles.splice(i,1); continue; }
      if (pr.life<=0) this.projectiles.splice(i,1);
    }
  }
  draw(){
    if (!this.alive) return;
    const cx = this.centerX - cam.x, cy = this.centerY - cam.y;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(cx, cy+28, 44, 12, 0, 0, Math.PI*2); ctx.fill();
    // body
    ctx.fillStyle = (this.phase===0? '#ffdfe0' : this.phase===2? '#ffb1b1' : '#ffcfcf');
    ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI*2); ctx.fill();
    // shield ring if phase 0
    if (this.phase===0){
      ctx.strokeStyle = 'rgba(160,210,255,0.9)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, 40,0,Math.PI*2); ctx.stroke();
      // shield bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(ctx, cx-36, cy+36, 72, 8, 2); ctx.fillStyle = '#7fcaff'; ctx.fillRect(cx-36, cy+36, 72 * (this.shieldHealth/14), 8);
    } else {
      // health bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(ctx, cx-40, cy+36, 80, 8, 2); ctx.fillStyle = '#ff9b9b'; ctx.fillRect(cx-40, cy+36, 80 * (this.health/this.maxHealth), 8);
    }
    // draw projectiles
    for (const pr of this.projectiles) drawRect(pr.x-cam.x-2, pr.y-cam.y-2, 4,4, '#ffd88a');
  }
}

/* -------------------------
   LEVEL MANAGER & UI helpers
   ------------------------- */
function showNarrative(title, text, small=null){
  const el = document.getElementById('narrative');
  el.innerHTML = `<strong style="display:block;font-size:16px;margin-bottom:6px">${title}</strong><div style="opacity:0.95;margin-bottom:6px">${text}</div>` + (small? `<div style="opacity:0.6;font-size:12px">${small}</div>` : '');
  el.classList.add('show'); el.style.display='block';
  setTimeout(()=>{ el.classList.remove('show'); el.style.display='none'; }, 3000);
}

function saveProgress(levelIndex = currentLevel){
  try { localStorage.setItem('lostworlds_progress', JSON.stringify({level:levelIndex,ts:Date.now()})); } catch(e){}
}
function loadProgress(){
  try {
    const raw = localStorage.getItem('lostworlds_progress'); if (!raw) return false;
    const obj = JSON.parse(raw); if (obj && typeof obj.level === 'number' && obj.level>=0 && obj.level<LEVELS.length){ loadLevel(obj.level); return true; }
    if (obj && obj.level === -1){ showNarrative("Completed","You already finished the story."); return true; }
  } catch(e){}
  return false;
}

function loadLevel(idx){
  if (idx<0 || idx>=LEVELS.length) return;
  currentLevel = idx;
  LEVEL_MAP = LEVELS[idx].map.map(r => r.slice());
  cols = LEVEL_MAP[0].length; rows = LEVEL_MAP.length;
  enemies = []; boss = null; particles = [];
  spawnPlayerAtMap();
  // spawn enemies from map markers
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      if (LEVEL_MAP[r][c] === TILE.ENEMY){ enemies.push(new Enemy(c*TILE_SIZE, r*TILE_SIZE)); LEVEL_MAP[r][c] = TILE.EMPTY; }
    }
  }
  // if final level, spawn boss
  if (LEVELS[idx].id === 4){ const bx = Math.floor(cols*TILE_SIZE*0.55); const by = Math.floor(rows*TILE_SIZE*0.25); boss = new CoreGuardian(bx, by); AudioEngine.startAmbient(); showNarrative(LEVELS[idx].title, LEVELS[idx].story, LEVELS[idx].objective); AudioEngine.startBossMusic(); } else { AudioEngine.startAmbient(); showNarrative(LEVELS[idx].title, LEVELS[idx].story, LEVELS[idx].objective); }
  cam.x = Math.max(0, player.x - VPORT_W/2); cam.y = Math.max(0, player.y - VPORT_H/2);
  document.getElementById('hp').textContent = player.health; document.getElementById('soulCount').textContent = player.souls; document.getElementById('stageText').textContent = LEVELS[idx].title;
}

/* -------------------------
   GAME FUNCTIONS
   ------------------------- */
function spawnPlayerAtMap(){
  for (let r=0;r<rows;r++){ for (let c=0;c<cols;c++){ if (LEVEL_MAP[r][c] === TILE.SPAWN){ player.x = c*TILE_SIZE + 4; player.y = r*TILE_SIZE - player.h - 2; return; } } }
  player.x = 40; player.y = 40;
}

function hurtPlayer(dmg){
  player.health -= dmg; document.getElementById('hp').textContent = player.health; spawnParticle(player.x - cam.x + player.w/2, player.y - cam.y + player.h/2, {color:'#ff8a8a', size:2, vx:rand(-1,1), vy:rand(-2,-0.2)}); sfxHit(); cam.shake = 6;
  if (player.health <= 0){ showNarrative("You fell...","The world claims you. Restart to try again."); setTimeout(()=> loadLevel(currentLevel), 900); }
}

/* -------------------------
   UPDATE / RENDER LOOP
   ------------------------- */
let last = performance.now();
function loop(now){
  const dt = Math.min(40, now - last); last = now;
  update(dt); render();
  requestAnimationFrame(loop);
}

function update(dt){
  // input
  const left = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const up = keys['Space'] || keys['KeyW'] || keys['ArrowUp'];
  const dash = keys['ShiftLeft'] || keys['ShiftRight'];
  const use = keys['KeyE'];

  if (left){ player.vx -= player.speed; player.facing = -1; }
  if (right){ player.vx += player.speed; player.facing = 1; }
  player.vx *= 0.9; player.vx = clamp(player.vx, -player.maxSpeed, player.maxSpeed);

  // gravity & jump
  player.vy += GRAVITY * 0.6; player.vy = clamp(player.vy, -MAX_FALL, MAX_FALL);
  if (up && !player._jumped){
    if (player.onGround){ player.vy = -8.6; player.onGround=false; player.canDoubleJump=true; sfxJump(); }
    else if (player.canDoubleJump){ player.vy = -7; player.canDoubleJump=false; sfxJump(); }
    player._jumped = true;
  }
  if (!up) player._jumped = false;

  if (dash && player.dashCooldown <= 0 && !player._dashed){ player._dashed = true; player.dashCooldown = 80; player.vx += player.facing * 6; AudioEngine.playBeep({freq:880, dur:0.06, type:'square', gain:0.06}); }
  if (!dash) player._dashed = false;
  if (player.dashCooldown > 0) player.dashCooldown -= dt * 0.06;

  // integrate
  player.x += player.vx; player.y += player.vy;

  // feet collision
  const feet = tileAt(player.x + player.w/2, player.y + player.h + 1);
  if (feet !== TILE.EMPTY){ player.onGround = true; player.canDoubleJump = true; player.y = Math.floor((player.y + player.h) / TILE_SIZE) * TILE_SIZE - player.h; if (Math.abs(player.vy) > 3) sfxLand(); player.vy = 0; } else player.onGround = false;

  // world bounds & falling
  if (player.x < 0) player.x = 0;
  if (player.x + player.w > cols * TILE_SIZE) player.x = cols*TILE_SIZE - player.w;
  if (player.y > rows * TILE_SIZE + 200){ player.health = 0; hurtPlayer(0); }

  // use / mine (E)
  if (use && !player._used){ player._used = true; const dir = player.facing; const tx = Math.floor((player.x + player.w/2 + dir*12)/TILE_SIZE); const ty = Math.floor((player.y + player.h/2)/TILE_SIZE); if (ty>=0 && ty<rows && tx>=0 && tx<cols){ const t = LEVEL_MAP[ty][tx]; if (t === TILE.DIRT || t === TILE.STONE){ LEVEL_MAP[ty][tx] = TILE.EMPTY; for (let i=0;i<10;i++) spawnParticle(tx*TILE_SIZE + rand(0,12), ty*TILE_SIZE + rand(0,12), {color:palette.dirt, size:1, vx:rand(-1,1), vy:rand(-2,-0.2)}); AudioEngine.playBeep({freq:520, dur:0.04, gain:0.045}); if (Math.random()<0.22) LEVEL_MAP[Math.max(0,ty-1)][tx] = TILE.SOUL; } else if (t===TILE.SOUL){ LEVEL_MAP[ty][tx] = TILE.EMPTY; player.souls += 1; document.getElementById('soulCount').textContent = player.souls; sfxCollect(); } else if (t===TILE.HEART){ LEVEL_MAP[ty][tx] = TILE.EMPTY; player.health = Math.min(9, player.health + 1); document.getElementById('hp').textContent = player.health; sfxCollect(); } } }
  if (!use) player._used = false;

  // update enemies
  for (let i=enemies.length-1;i>=0;i--) enemies[i].update();

  // boss update & check hits
  if (boss){ boss.update(dt); if (boss.alive && boss.phase>0){ const coreRect = {x:boss.centerX-20, y:boss.centerY-20, w:40, h:40}; if (rectsIntersect(player, coreRect)){ if (player.vy > 4 || Math.abs(player.vx) > 5){ if (boss.receiveHit(2)){ player.vy = -3; player.vx *= -0.4; } } } } if (!boss.alive){ showNarrative("Portal Awakened","A shimmering portal appears — step through to go home."); } }

  // exit tile check
  const under = tileAt(player.x + player.w/2, player.y + player.h + 1);
  if (under === TILE.EXIT){ sfxPortal(); if (currentLevel + 1 < LEVELS.length) { loadLevel(currentLevel + 1); saveProgress(currentLevel + 1); } else { showNarrative("Home...?", "You step through the portal. The world blurs. Did you find your way home?"); saveProgress(-1); } }

  // camera smoothing
  const targetX = clamp(player.x - VPORT_W/2 + player.w/2, 0, Math.max(0, cols*TILE_SIZE - VPORT_W));
  const targetY = clamp(player.y - VPORT_H/2 + player.h/2, 0, Math.max(0, rows*TILE_SIZE - VPORT_H));
  cam.x += (targetX - cam.x) * 0.12; cam.y += (targetY - cam.y) * 0.12;
  if (cam.shake > 0) { cam.shake *= 0.9; cam.x += rand(-cam.shake, cam.shake); cam.y += rand(-cam.shake, cam.shake); }

  // particles update
  for (let i=particles.length-1;i>=0;i--){ const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life--; if (p.life<=0) particles.splice(i,1); }
}

function render(){
  ctx.clearRect(0,0,VPORT_W,VPORT_H);
  // background
  const g = ctx.createLinearGradient(0,0,0,VPORT_H); g.addColorStop(0, '#071426'); g.addColorStop(1, '#041018'); ctx.fillStyle = g; ctx.fillRect(0,0,VPORT_W,VPORT_H);
  // subtle parallax bands
  for (let i=0;i<6;i++){ ctx.fillStyle = i%2? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.007)'; ctx.fillRect(0, VPORT_H*(i/10), VPORT_W, 2); }
  // tiles
  for (let r=0;r<rows;r++){ for (let c=0;c<cols;c++){ const t = LEVEL_MAP[r][c]; if (t===TILE.EMPTY) continue; const x = c*TILE_SIZE - cam.x; const y = r*TILE_SIZE - cam.y; if (t===TILE.DIRT) drawRect(x,y,TILE_SIZE,TILE_SIZE,palette.dirt); if (t===TILE.STONE) drawRect(x,y,TILE_SIZE,TILE_SIZE,palette.stone); if (t===TILE.GRASS) drawRect(x,y,TILE_SIZE,TILE_SIZE,palette.grass); if (t===TILE.SOUL) drawRect(x+4,y+4,8,8,palette.soul); if (t===TILE.HEART) drawRect(x+4,y+4,8,8,palette.heart); if (t===TILE.SPAWN) drawRect(x+2,y+2,12,12,'rgba(255,255,255,0.02)'); if (t===TILE.EXIT) drawRect(x+2,y+2,12,12,'rgba(255,255,255,0.08)'); } }
  // enemies
  for (const e of enemies) e.draw();
  // boss
  if (boss) boss.draw();
  // player
  drawRect(player.x - cam.x, player.y - cam.y, player.w, player.h, palette.player);
  // player shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(player.x - cam.x + player.w/2, player.y - cam.y + player.h + 6, 10, 4, 0, 0, Math.PI*2); ctx.fill();
  // particles
  for (const p of particles) drawRect(p.x - cam.x, p.y - cam.y, p.size, p.size, p.color);
}

/* -------------------------
   UTIL roundRect for bars
   ------------------------- */
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.closePath(); }

/* -------------------------
   UI buttons / boot
   ------------------------- */
document.getElementById && (() => {
  const bSave = document.getElementById('saveBtn'), bLoad = document.getElementById('loadBtn'), bRestart = document.getElementById('restartBtn'), bMute = document.getElementById('muteBtn');
  if (bSave) bSave.addEventListener('click', ()=> saveProgress());
  if (bLoad) bLoad.addEventListener('click', ()=> { if (!loadProgress()) showNarrative('No Save','No saved game found.'); });
  if (bRestart) bRestart.addEventListener('click', ()=> { player.health=5; player.souls=0; loadLevel(0); });
  if (bMute) bMute.addEventListener('click', ()=> { AudioEngine.setMute(!(bMute.dataset.muted === 'true')); bMute.dataset.muted = (bMute.dataset.muted === 'true' ? 'false' : 'true'); bMute.textContent = (bMute.dataset.muted === 'true' ? 'Unmute' : 'Mute'); });
  if (!loadProgress()) loadLevel(0);
});

/* -------------------------
   START LOOP
   ------------------------- */
requestAnimationFrame(loop);
