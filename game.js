// game.js — основная механика игры

"use strict";

/* ================= WEB AUDIO ДВИЖОК =================
   AudioContext создаётся ЛЕНИВО и только после первого жеста (unlocked):
   до жеста playSfx — тихий no-op, без создания контекста и без
   предупреждений "AudioContext was not allowed to start". */
var audioCtx = null;
var masterGain = null;
var muted = false;
var VOLUME = 0.2;
var unlocked = false;

function ensureAudio(){
  if(!unlocked) return false;   // до первого жеста — не создаём контекст
  if(audioCtx) return true;
  var AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return false;
  try{
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = VOLUME;
    masterGain.connect(audioCtx.destination);
  }catch(e){
    audioCtx = null;
    return false;
  }
  return true;
}

// один короткий осциллятор: тон, тип, старт(сек от now), длительность, частотный glide
function tone(freq, type, delay, dur, glideTo, peak){
  if(!audioCtx || !masterGain) return;
  var t0 = audioCtx.currentTime + delay;
  var osc = audioCtx.createOscillator();
  var g = audioCtx.createGain();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if(glideTo){
    osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + dur);
  }
  var p = (peak == null ? 1 : peak);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(p, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// шумовой всплеск (для выдоха свечи)
function noiseBurst(delay, dur, cutoffFreq, peak){
  if(!audioCtx || !masterGain) return;
  var t0 = audioCtx.currentTime + delay;
  var len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
  var buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  var data = buf.getChannelData(0);
  for(var i=0;i<len;i++){
    data[i] = (Math.random()*2-1) * (1 - i/len);
  }
  var src = audioCtx.createBufferSource();
  src.buffer = buf;
  var filt = audioCtx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(cutoffFreq, t0);
  filt.frequency.exponentialRampToValueAtTime(Math.max(cutoffFreq*0.25, 40), t0+dur);
  var g = audioCtx.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(masterGain);
  src.start(t0);
}

/* ============ playSfx(name): card, flip, hit, miss, win, candle ============ */
function playSfx(name){
  if(muted || !unlocked) return;   // до первого жеста — тихий no-op
  if(!ensureAudio()) return;
  if(audioCtx.state === "suspended"){
    audioCtx.resume();
  }
  switch(name){
    case "card":   // скольжение карты по дереву
      tone(320, "triangle", 0,    0.09, 210, 0.9);
      noiseBurst(0.01, 0.07, 2600, 0.35);
      break;
    case "flip":   // щелчок переворота
      tone(660, "square", 0,   0.05, 480, 0.5);
      tone(990, "sine",   0.03,0.06, 740, 0.6);
      break;
    case "hit":    // глухое попадание
      tone(150, "sine", 0, 0.16, 60, 1);
      noiseBurst(0, 0.08, 900, 0.5);
      break;
    case "miss":   // промах — спад
      tone(300, "sawtooth", 0, 0.22, 120, 0.4);
      break;
    case "win":    // победный перебор
      tone(523.25, "sine", 0,     0.14, null, 0.8); // до
      tone(659.25, "sine", 0.12,  0.14, null, 0.8); // ми
      tone(783.99, "sine", 0.24,  0.16, null, 0.8); // соль
      tone(1046.5, "triangle", 0.36, 0.34, null, 0.9); // до-октава
      break;
    case "candle": // выдох/вспышка свечи
      noiseBurst(0, 0.3, 1400, 0.5);
      tone(90, "sine", 0, 0.25, 55, 0.5);
      break;
    default:
      break;
  }
}
window.playSfx = playSfx; // доступно из консоли для отладки

/* ================= UI ================= */
var btnSound = document.getElementById("btn-sound");
var btnNewRun = document.getElementById("btn-newrun");
var tableFlip = document.getElementById("tableFlip");
var FLIP_MS = 900; // синхронно с transition .9s

btnSound.addEventListener("click", function(){
  muted = !muted;
  if(masterGain){
    masterGain.gain.value = muted ? 0 : VOLUME;
  }
  btnSound.textContent = muted ? "\u2715 Звук: выкл" : "\u266A Звук: вкл";
  if(muted){
    btnSound.classList.add("muted");
  }else{
    btnSound.classList.remove("muted");
    playSfx("card"); // подтверждение включения
  }
});

// заглушка: игровой логики нет — только звук и лёгкая вибрация кнопки
btnNewRun.addEventListener("click", function(){
  playSfx("card");
});

/* ================= ПЕРЕВОРОТ СТОЛА =================
   Триггеры: только window.flipTable() (вызывает игровая логика) и клавиша F (отладка).
   Клик по канту — убран полностью. */
var flipping = false;
var fightActive = false;   /* бой активен: дух/доска/HP видны только на грани боя */
function flipTable(){
  if(flipping) return;
  flipping = true;
  tableFlip.classList.add("no-pan"); // на время переворота грани глухи к кликам
  tableFlip.classList.toggle("flipped");
  /* слой комнаты (дух/HP) и боевые оверлеи грани — только на грани боя */
  var mapSide = tableFlip.classList.contains("flipped");
  document.body.classList.toggle("table-map-side", mapSide);
  document.body.classList.toggle("map-active", mapSide);
  document.body.classList.toggle("battle-active", !mapSide && fightActive);
  playSfx("flip");
  setTimeout(function(){
    flipping = false;
    tableFlip.classList.remove("no-pan");
    /* ЭТАП 6.5: если стол приземлился на грань карты — снимем залипший busy,
       иначе pointerup-обработчик карты (if(state.busy) return) глушит клики
       по следующей колонке после любого сбоя/прерванного возврата. */
    if(mapSide && window.clearMapBusy) window.clearMapBusy();
  }, FLIP_MS);
}
window.flipTable = flipTable; // для будущих этапов / игровой логики
/* ЭТАП 6.3: мост для IIFE боя/карты — принудительно завершить переворот из
   ЕДИНСТВЕННОЙ области, где живёт flipping (записи flipping=false в banish()/
   travelTo() были no-op и заливали guard кнопки [Вернуться на карту]). */
window.forceFlipEnd = function(){
  flipping = false;
  tableFlip.classList.remove("no-pan");
};


// триггер: клавиша KeyF (отладка)
document.addEventListener("keydown", function(e){
  if(e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.altKey){
    flipTable();
  }
});

/* ================= КАРТЫ: иконки, makeCard, рука, раздача ================= */
var SVGNS = "http://www.w3.org/2000/svg";

/* Набор stroke-SVG иконок (2-4 path, без заливок; гравюрный штих) */
var ICONS = {
  candle: [
    "M10 27 h10",
    "M11.5 27 v-9 a1.5 1.5 0 0 1 3 -0 c0.6 2.2 2.4 2.6 3 0 a1.5 1.5 0 0 1 3 0 v9",
    "M16 15.4 c-1.8 -2.4 1.8 -3.6 0 -7.4 c-1.8 3.8 1.8 5 0 7.4 z"
  ],
  quill: [
    "M6 26 q9 -2.5 13.2 -15.2",
    "M10 21.5 q7.5 -2 11.2 -12.5 q1.2 8.5 -6.2 13.5 q-2.6 1.6 -5 1.6 z",
    "M6 26 l2.2 -2.2"
  ],
  drop: [
    "M16 5.5 C16 5.5 8.5 14.5 8.5 19.5 a7.5 7.5 0 0 0 15 0 C23.5 14.5 16 5.5 16 5.5 z",
    "M12.5 19.5 a3.5 3.5 0 0 0 3.5 3.5"
  ],
  eye: [
    "M4 16 q12 -10.5 24 0 q-12 10.5 -24 0 z",
    "circle:16,16,4.2",
    "circle:16,16,1.2"
  ],
  flame: [
    "M16 4 C10.5 11.5 8.5 14.5 8.5 18.5 a7.5 7.5 0 0 0 15 0 C23.5 14.5 21.5 11.5 16 4 z",
    "M16 12.5 c-2.4 3 -3.4 4.4 -3.4 6.2 a3.4 3.4 0 0 0 6.8 0 c0 -1.8 -1 -3.2 -3.4 -6.2 z"
  ],
  book: [
    "M16 8.2 C12.5 5.8 8 5.8 5 6.8 V24 c3 -1 7.5 -1 11 1.4 c3.5 -2.4 8 -2.4 11 -1.4 V6.8 c-3 -1 -7.5 -1 -11 1.4 z",
    "M16 8.2 V25.4",
    "M8 11.5 h4.5",
    "M19.5 11.5 H24"
  ],
  key: [
    "circle:10.5,10.5,4.5",
    "M13.8 13.8 L24 24",
    "M20 20 l-2.6 2.6",
    "M22.4 17.6 l-2.6 2.6"
  ],
  star: [
    "M16 4.5 L18.9 12.1 L27 12.4 L20.7 17.5 L23 25.5 L16 20.7 L9 25.5 L11.3 17.5 L5 12.4 L13.1 12.1 Z"
  ],
  /* этап 4.1: сигилы семей времени для доски врага */
  sun: [ /* simple — солнце с лучами / циферблат */
    "circle:16,16,6",
    "circle:16,16,1.4",
    "M16 3.5 V7",
    "M16 25 v3.5",
    "M3.5 16 H7",
    "M25 16 h3.5",
    "M7.2 7.2 l2.5 2.5",
    "M22.3 22.3 l2.5 2.5",
    "M24.8 7.2 l-2.5 2.5",
    "M9.7 22.3 l-2.5 2.5"
  ],
  hourglass: [ /* perfect — песочные часы */
    "M9 4 h14 M9 28 h14",
    "M11 4 c0 6 5 8 5 12 c0 -4 5 -6 5 -12",
    "M11 28 c0 -6 5 -8 5 -12 c0 4 5 6 5 12"
  ]
};

function buildIcon(name){
  var paths = ICONS[name] || ICONS.candle;
  var svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("class", "card-icon");
  svg.setAttribute("aria-hidden", "true");
  for(var i=0;i<paths.length;i++){
    var d = paths[i], el;
    if(d.indexOf("circle:") === 0){
      var p = d.slice(7).split(",");
      el = document.createElementNS(SVGNS, "circle");
      el.setAttribute("cx", p[0]);
      el.setAttribute("cy", p[1]);
      el.setAttribute("r", p[2]);
    }else{
      el = document.createElementNS(SVGNS, "path");
      el.setAttribute("d", d);
    }
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", "var(--ink)");
    el.setAttribute("stroke-width", "1.7");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    svg.appendChild(el);
  }
  return svg;
}

/* лента типа: полоска 3px + мелкая подпись. MARKER=--candle, VERB=--wax, RELIC=--bone */
var TYPE_COLOR = { MARKER:"var(--candle)", VERB:"var(--wax)", RELIC:"var(--bone)" };

/* makeCard({text,type,icon}) -> DOM-узел с двумя гранями; .flipped на узле = показать лицо */
function makeCard(data){
  var card = document.createElement("div");
  card.className = "card";
  card.setAttribute("data-type", data.type || "MARKER");

  var inner = document.createElement("div");
  inner.className = "card-inner";

  /* рубашка (лицевая по умолчанию — карты сдаются рубашкой вверх) */
  var back = document.createElement("div");
  back.className = "card-face card-back";
  var seal = document.createElement("div");
  seal.className = "seal";
  var sigil = document.createElementNS(SVGNS, "svg");
  sigil.setAttribute("viewBox", "0 0 32 32");
  sigil.setAttribute("aria-hidden", "true");
  var sigPaths = ["M12 26 h8", "M13.5 26 v-6.5 a1.5 1.5 0 0 1 5 0 V26",
                  "M17 18 c-2 -2.6 2 -4 0 -7.6 c-2 3.6 2 5 0 7.6 z"];
  for(var s=0;s<sigPaths.length;s++){
    var pe = document.createElementNS(SVGNS, "path");
    pe.setAttribute("d", sigPaths[s]);
    pe.setAttribute("fill", "none");
    pe.setAttribute("stroke", "var(--candle)");
    pe.setAttribute("stroke-width", "1.6");
    pe.setAttribute("stroke-linecap", "round");
    pe.setAttribute("stroke-linejoin", "round");
    sigil.appendChild(pe);
  }
  seal.appendChild(sigil);
  back.appendChild(seal);

  /* лицо: пергамент, двойная рамка, одна гравюра, лента типа, название капсом */
  var front = document.createElement("div");
  front.className = "card-face card-front";
  front.appendChild(buildIcon(data.icon || "candle"));
  var typeRow = document.createElement("div");
  typeRow.className = "card-type";
  var bar = document.createElement("span");
  bar.className = "bar";
  bar.style.setProperty("--tc", TYPE_COLOR[data.type] || TYPE_COLOR.MARKER);
  var tl = document.createElement("span");
  tl.className = "tl";
  tl.textContent = data.type || "MARKER";
  typeRow.appendChild(bar);
  typeRow.appendChild(tl);
  var name = document.createElement("div");
  name.className = "card-name";
  name.textContent = data.text || "";
  front.appendChild(typeRow);
  front.appendChild(name);

  inner.appendChild(back);   /* rotateY(180) */
  inner.appendChild(front);
  card.appendChild(inner);
  return card;
}
window.makeCard = makeCard; // для будущих этапов

var handEl = document.getElementById("hand");

function layoutFan(){
  /* этап 4.1: ровный ряд без дуги — все карты вертикальны (rotate 0),
     лёгкий случайный наклон ±1.5deg как у лежащих карт; смещение по Y убрано */
  var cards = handEl.children, n = cards.length;
  for(var i=0;i<n;i++){
    if(!cards[i].hasAttribute("data-tilt")){
      cards[i].setAttribute("data-tilt", ((Math.random()*3) - 1.5).toFixed(2));
    }
    cards[i].style.setProperty("--rot", cards[i].getAttribute("data-tilt") + "deg");
    cards[i].style.setProperty("--dy", "0px");
  }
}

/* делегирование: все слушатели — на контейнере руки.
   Клик по карте руки = СЫГРАТЬ её в свой слот на карте врага (этап 3).
   e.stopPropagation() — клики карт НИКОГДА не доходят до стола/флипа. */
handEl.addEventListener("click", function(e){
  e.stopPropagation();
  var card = e.target.closest ? e.target.closest(".card") : null;
  if(!card) return;
  playCard(card);
});
/* тап = подъём (hover покрывает мышь; .lift дополняет для touch) */
handEl.addEventListener("touchstart", function(e){
  e.stopPropagation();
  var t = e.target.closest ? e.target.closest(".card") : null;
  if(t) t.classList.add("lift");
}, {passive:true});
handEl.addEventListener("touchend", function(e){
  e.stopPropagation();
  var lifted = handEl.querySelectorAll(".card.lift");
  for(var i=0;i<lifted.length;i++) lifted[i].classList.remove("lift");
}, {passive:true});

/* ================= ПЫЛЬ-ЧАСТИЦЫ (6-8 шт) ================= */
var scene = document.getElementById("scene");
var MOTES = 7;
for(var i=0;i<MOTES;i++){
  var m = document.createElement("div");
  m.className = "mote";
  var size = 2 + (i % 3);           // 2..4 px
  m.style.width = size + "px";
  m.style.height = size + "px";
  m.style.left = (8 + Math.random()*84).toFixed(1) + "%";
  m.style.top = (30 + Math.random()*55).toFixed(1) + "%";
  m.style.animationDuration = (16 + Math.random()*14).toFixed(1) + "s";
  m.style.animationDelay = (-Math.random()*20).toFixed(1) + "s";
  scene.appendChild(m);
}

/* свечи иногда «дышат» звуком — очень тихо, без речи; только после жеста */
var AMBIENT_SOUNDS = ["candle"];
function scheduleAmbient(){
  setTimeout(function(){
    if(unlocked && !muted && !document.hidden){
      playSfx(AMBIENT_SOUNDS[0]);
    }
    scheduleAmbient();
  }, 9000 + Math.random()*9000);
}
scheduleAmbient();

/* ЗВУК ПО ЖЕСТУ: AudioContext создаётся лениво и только после первого
   pointerdown/keydown. До жеста playSfx — тихий no-op (раздача до клика
   идёт без звука — это норма, предупреждений в консоли нет). */
function unlock(){
  unlocked = true;
  if(audioCtx && audioCtx.state === "suspended"){ audioCtx.resume(); }
}
window.addEventListener("pointerdown", unlock, {once:true});
window.addEventListener("keydown", unlock, {once:true});

/* ================================================================
   ===================== ЭТАП 3: БОЙ С ДУХАМИ ======================
   ================================================================ */

var ghostEl       = document.getElementById("ghost");
var ghostNameEl   = document.getElementById("ghostName");
var boardSlotEl   = document.getElementById("enemyBoardSlot");
var boardEl       = document.getElementById("enemyBoard");
var ebClueEl      = document.getElementById("ebClue");
var ebSentenceEl  = document.getElementById("ebSentence");
var explainInnerEl= document.getElementById("explainInner");
var fixedLineEl   = document.getElementById("fixedLine");
var whyLineEl     = document.getElementById("whyLine");
var hpRowEl       = document.getElementById("hpRow");
var overlayWin    = document.getElementById("overlayWin");
var overlayLose   = document.getElementById("overlayLose");
var winPhraseEl   = document.getElementById("winPhrase");
var winWhyEl      = document.getElementById("winWhy");

var MAX_HP = 6, HP_PER_ENEMY = 2;
var state = {
  enemyIdx: 0,
  hp: MAX_HP,
  hits: 0,
  busy: false,          /* блокировка кликов на время анимаций/оверлеев */
  entering: false,      /* реентри-гард диспетчера enterNode (этап 5.3) */
  banished: false,      /* бой завершён изгнанием — ждём [Вернуться на карту] */
  played: { M:null, V:null },   /* карты, лежащие в слотах */
  slots:  { M:null, V:null }    /* DOM слотов */
};

function currentEnemy(){ return CONTENT.enemies[state.enemyIdx % CONTENT.enemies.length]; }
/* счётчик раздач: каждая новая рука получает уникальный cid — защита от
   наложений stale-таймаутов предыдущих раздач на новые карты */
var dealSeq = 0;

/* ---------- HP-свечи ---------- */
function buildHpRow(){
  hpRowEl.innerHTML = "";
  for(var i=0;i<MAX_HP;i++){
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("class", "hp-candle");
    svg.setAttribute("aria-hidden", "true");
    var body = document.createElementNS(SVGNS, "path");
    body.setAttribute("d", "M11 28 h10 M12.5 28 v-9 a1.5 1.5 0 0 1 5 0 V28");
    body.setAttribute("fill", "none");
    body.setAttribute("stroke-width", "2");
    body.setAttribute("stroke-linecap", "round");
    body.setAttribute("class", "hp-stroke");
    var flame = document.createElementNS(SVGNS, "path");
    flame.setAttribute("d", "M16 6 c-2.6 3.6 -4 5.4 -4 7.4 a4 4 0 0 0 8 0 c0 -2 -1.4 -3.8 -4 -7.4 z");
    flame.setAttribute("class", "hp-flame");
    svg.appendChild(body); svg.appendChild(flame);
    hpRowEl.appendChild(svg);
  }
}
function renderHp(){
  var icons = hpRowEl.children;
  for(var i=0;i<icons.length;i++){
    if(i < state.hp) icons[i].classList.remove("out");
    else icons[i].classList.add("out");
  }
}
function snuffHp(){
  state.hp--;
  var idx = Math.max(state.hp, 0);
  renderHp();
  var icons = hpRowEl.children;
  if(icons[idx]){
    icons[idx].classList.add("goout");
    setTimeout(function(){ icons[idx].classList.remove("goout"); }, 550);
  }
}

/* этап 4.1: улика — РЕЛИКТ "Лупа". По умолчанию выключен: табличка не рендерится,
   на доске только шаблон + сигил семьи времени. Тумблер [Лупа] на верхней панели. */
var lupaOn = false;

function renderClue(enemy){
  if(lupaOn){
    ebClueEl.textContent = "\u00AB" + enemy.clue + "\u00BB";
    ebClueEl.removeAttribute("hidden");
  }else{
    ebClueEl.setAttribute("hidden", "");
    ebClueEl.textContent = "";
  }
}

/* ---------- доска-надпись врага: шаблон с inline-пропусками + сигил семьи ---------- */
function buildEnemyBoard(enemy){
  state.slots.M = null; state.slots.V = null;

  /* переиспользуем статичную разметку доски из HTML */
  boardSlotEl.classList.remove("banished");
  boardEl.classList.remove("flash");
  ghostEl.classList.remove("banished");
  renderClue(enemy);   /* этап 4.1: по умолчанию скрыта (реликт "Лупа") */

  /* предложение-шаблон: слова + слоты [M]/[V] (170x110, пунктир) в одну-две строки */
  ebSentenceEl.innerHTML = "";
  var parts = enemy.template.split(/\[(M|V)\]/);
  /* split даёт: [pre, GROUP, mid, GROUP, post] при наличии обоих маркеров */
  var seq = [];
  for(var p=0;p<parts.length;p++){
    if(p % 2 === 0){
      if(parts[p]) seq.push({ t:"text", v:parts[p] });
    }else{
      seq.push({ t:"slot", kind:parts[p] });
    }
  }
  for(var s=0;s<seq.length;s++){
    if(seq[s].t === "text"){
      var word = document.createElement("span");
      word.className = "eb-word";
      word.textContent = seq[s].v.trim();
      ebSentenceEl.appendChild(word);
    }else{
      var box = document.createElement("span");
      box.className = "slot-box";
      box.setAttribute("data-slot", seq[s].kind);
      var lab = document.createElement("span");
      lab.className = "slot-label";
      lab.textContent = "[" + seq[s].kind + "]";
      box.appendChild(lab);
      ebSentenceEl.appendChild(box);
      state.slots[seq[s].kind] = box;
    }
  }
  /* этап 4.1: сигил семьи времени — гравюра СПРАВА от шаблона (не слот, не трогает проверку) */
  var seal = document.createElement("span");
  seal.className = "eb-seal";
  seal.setAttribute("aria-hidden", "true");
  var sealName = FAMILY_SEAL[enemy.family] || FAMILY_SEAL[norm(enemy.family).toLowerCase()] || "sun";
  var sealSvg = buildIcon(sealName);
  sealSvg.setAttribute("class", "");   /* стиль даёт .eb-seal svg --ink-штрих */
  seal.appendChild(sealSvg);
  ebSentenceEl.appendChild(seal);
  /* рестарт анимации «швыряния» доски */
  void boardEl.offsetWidth;
  fitFaceHeights();
}

/* этап 3.9/4.2: явная высота стола в px из JS (flex-колонка комнаты).
   Формула совпадает с исходной spec-высотой min(74vh,760px); при нехватке
   вертикали стол ужимается так, чтобы колонка [дух → стол → HP] целиком
   помещалась во вьюпорт без скролла и ряд HP не сталкивался с подсказкой. */
function fitFaceHeights(){
  var h = window.innerHeight || document.documentElement.clientHeight || 760;
  var faceH = Math.max(520, Math.min(Math.round(h * 0.86), 760));
  /* резерв колонки: дух (~100px) + HP-ряд (~72px) + зазоры + нижняя подсказка (~34px) */
  var reserve = 210;
  if (h - faceH < reserve){
    faceH = Math.max(440, h - reserve);
  }
  document.documentElement.style.setProperty("--face-h", faceH + "px");
  /* этап 4.2 п.4: при нехватке высоты уменьшаем padding HP-ряда, но НЕ иконки (<30px) */
  var tight = (h - faceH) < 170;
  var roomEl = document.getElementById("scene");
  if (roomEl) roomEl.classList.toggle("hp-tight", tight);
  syncRoomDeco();
}

/* этап 4.2: комната стала flex-колонкой — стол больше не guaranteed top:50%.
   Пятна света и свечи (слой комнаты, absolute) выравниваются по ФАКТИЧЕСКОЙ
   вертикали стола; свечи стоят основанием НА нижней кромке грани (перекрывая кант). */
function syncRoomDeco(){
  var anchor = document.querySelector(".table-anchor");
  var roomEl = document.getElementById("scene");
  if (!anchor || !roomEl) return;
  /* до измерения глушим анимации трансформом (flameDance scale), иначе
     offsetHeight «прыгает» между кадрами и свечи дрожат при ресайзе */
  var candles = roomEl.querySelectorAll(".candle");
  for (var i = 0; i < candles.length; i++){
    candles[i].style.transition = "none";
    candles[i].style.bottom = "auto";
    candles[i].style.top = "-9999px";        /* вывод из потока измерения: height стабилен */
  }
  var r = anchor.getBoundingClientRect();
  var cy = r.top + r.height / 2;
  var bottomY = r.bottom + Math.round((r.height / 2) * (1 - 0.9848)); /* проекция нижней кромки с наклоном */
  document.documentElement.style.setProperty("--face-top", Math.round(r.top) + "px");
  roomEl.classList.add("table-centered");
  roomEl.querySelectorAll(".warm-pool").forEach(function(el){ el.style.top = Math.round(cy) + "px"; });
  for (var j = 0; j < candles.length; j++){
    var candH = candles[j].offsetHeight || 160;   /* измеряем ДО простановки top */
    candles[j].style.top = Math.round(bottomY - candH + 14) + "px"; /* основание слегка перекрывает кант */
  }
}

function hideBattleMsg(){ explainInnerEl.classList.remove("show"); }
function showBattleMsg(html, whyHtml){
  fixedLineEl.innerHTML = html;
  whyLineEl.innerHTML = whyHtml || "";
  explainInnerEl.classList.add("show");
}
function esc(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function fixedSentenceHtml(mText, vText, hlM, hlV){
  var e = currentEnemy();
  var m = hlM ? ("<span class=\"ins\">" + esc(mText) + "</span>") : esc(mText);
  var v = hlV ? ("<span class=\"ins\">" + esc(vText) + "</span>") : esc(vText);
  return e.template.replace("[M]", m).replace("[V]", v);
}

/* ---------- бой: вход в бой, раздача, игра карт ---------- */
var dealWatchdog = null;
function startFight(){
  state.busy = false;
  state.banished = false;
  fightActive = true;                  /* бой активен: battle-active включает рендер грани боя */
  document.body.classList.add("battle-active");
  if(tableFlip.classList.contains("flipped")) flipTable(); /* с карты — на грань боя */
  state.hits = 0;
  state.played.M = null; state.played.V = null;
  hideBattleMsg();
  overlayWin.classList.remove("show");
  overlayLose.classList.remove("show");
  var enemy = currentEnemy();
  fightActive = true;                  /* держим флаг/класс актуальными и при рестарте */
  document.body.classList.add("battle-active");
  ghostNameEl.textContent = enemy.name;
  buildHpRow();
  renderHp();
  buildEnemyBoard(enemy);
  handEl.innerHTML = "";
  dealSeq++;                       /* глушим хвосты таймаутов предыдущей раздачи */
  setTimeout(function(){ dealBattleHand(enemy); }, 650);
  /* самостраховка: через 600мс ПОСЛЕ запланованной раздачи (650мс) рука должна быть живой;
     в норме не срабатывает — warn появляется только при реальной проблеме */
  if(dealWatchdog) clearTimeout(dealWatchdog);
  dealWatchdog = setTimeout(function(){
    dealWatchdog = null;
    if(handEl && !handEl.children.length){
      console.warn("hand empty after battle start — re-dealing");
      dealBattleHand(currentEnemy());
    }
  }, 1900);
}

/* рука: ГАРАНТИЯ 1 маркер из acceptM + 1 форма из acceptV + 2-3 трапа; face-up, стаггером.
   Трапы берутся только те, что НЕ образуют с уже взятой верной парой скрытое решение
   (иначе "неверный" набор карт мог бы засчитаться как удар).
   Ключ — text карты везде: acceptM/acceptV содержат text, сравнение по norm(text);
   НИКАКИХ find(...).text — только строки и map-функции FAM/TEXT2FAM/TEXT2TENSE. */
function inAccept(list, t){
  var n = norm(t);
  for(var i=0;i<list.length;i++) if(norm(list[i]) === n) return true;
  return false;
}
/* решение = (а)+(б)+(в) — те же проверки, что в checkSlots */
function isSolution(enemy, mText, vText){
  return inAccept(enemy.acceptM, mText) &&
         inAccept(enemy.acceptV, vText) &&
         isFriendlyPairMVP(mText, vText);
}

function randFrom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

/* страховка пула: пустой пул = console.error + фолбэк на полный список */
function safePool(arr, name){
  if(!arr || !arr.length){
    console.error("empty pool: " + name);
    return null;
  }
  return arr;
}

function pickBattleCards(enemy){
  /* верные пулы — СТРОКИ текстов (не объекты) */
  var okM = [], okV = [], i;
  for(i=0;i<CONTENT.markers.length;i++){
    if(inAccept(enemy.acceptM, CONTENT.markers[i].text)) okM.push(CONTENT.markers[i].text);
  }
  for(i=0;i<CONTENT.verbs.length;i++){
    if(inAccept(enemy.acceptV, CONTENT.verbs[i].text)) okV.push(CONTENT.verbs[i].text);
  }
  var needM = null, needV = null;
  var pm = safePool(okM, "okM");
  if(pm) needM = randFrom(pm);
  else if(CONTENT.markers.length) needM = CONTENT.markers[0].text;
  var pv = safePool(okV, "okV");
  if(pv) needV = randFrom(pv);
  else if(CONTENT.verbs.length) needV = CONTENT.verbs[0].text;
  if(!needM || !needV) throw new Error("CONTENT incomplete: no markers/verbs to deal");

  /* семьи/тензы через map-функции; если чего-то нет — error + фолбэк, НО не краш */
  var famNeed   = TEXT2FAM(needM) || FAM(needM);
  var tenseNeed = TEXT2TENSE(needV);
  if(!famNeed || !tenseNeed){
    console.error("UNKNOWN TEXT IN CONTENT", { needM: needM, needV: needV });
    if(!famNeed)   famNeed   = "simple";
    if(!tenseNeed) tenseNeed = "simple";
  }

  var chosen = [ { text:needM, kind:"M", fam:famNeed }, { text:needV, kind:"V", tense:tenseNeed } ];

  /* трапы: маркеры чужой семьи + формы чужого тенза (исключая acceptV) */
  var traps = [];
  for(i=0;i<CONTENT.markers.length;i++){
    var mt = CONTENT.markers[i].text;
    if(norm(mt) === norm(needM)) continue;
    if(famOfMarker(mt) === famNeed) continue;          /* только family !== famNeed */
    /* трап-маркер не должен в паре с ВЕРНОЙ формой руки дать скрытое решение */
    if(isSolution(enemy, mt, needV)) continue;
    traps.push({ text:mt, kind:"M", fam:famOfMarker(mt) });
  }
  for(i=0;i<CONTENT.verbs.length;i++){
    var vt = CONTENT.verbs[i].text;
    if(norm(vt) === norm(needV)) continue;
    if(inAccept(enemy.acceptV, vt)) continue;          /* исключаем acceptV */
    if(TEXT2TENSE(vt) === tenseNeed) continue;         /* только tense !== tenseNeed */
    /* трап-форма не должна в паре с ВЕРНЫМ маркером руки дать скрытое решение */
    if(isSolution(enemy, needM, vt)) continue;
    traps.push({ text:vt, kind:"V", tense:TEXT2TENSE(vt) });
  }
  var pt = safePool(traps, "traps");
  if(pt){
    pt.sort(function(){ return Math.random() - 0.5; });
    var nTraps = 2 + (Math.random() < 0.5 ? 0 : 1); /* 2-3 трапа */
    for(i=0;i<nTraps && i<pt.length;i++) chosen.push(pt[i]);
  }
  /* перемешать порядок в руке */
  chosen.sort(function(){ return Math.random() - 0.5; });
  return chosen;
}

/* фолбэк-рука при крахе раздачи: строки напрямую, без поиска объектов */
var FALLBACK_HAND = ["ALWAYS", "NOW", "FOR 2 YEARS", "WORKS", "IS WORKING"];

function dealFallbackHand(){
  handEl.innerHTML = "";
  var nodes = [];
  for(var i=0;i<FALLBACK_HAND.length;i++){
    var t = FALLBACK_HAND[i];
    var fam = TEXT2FAM(t);           // маркер <=> имеет семью в CONTENT.markers
    var isM = !!fam;
    var c = makeCard({
      text: t,
      type: isM ? "MARKER" : "VERB",
      icon: isM ? (MARKER_ICON[fam] || "candle") : "book"
    });
    c.setAttribute("data-kind", isM ? "M" : "V");
    c.setAttribute("data-id", t);
    c.classList.add("flipped");
    c.style.setProperty("--i", i);
    c.style.setProperty("--dx", "140%");
    c.style.setProperty("--dy", "-110%");
    c.style.opacity = "0";
    handEl.appendChild(c);
    nodes.push(c);
  }
  layoutFan();
  void handEl.offsetWidth;
  var seq = ++dealSeq;
  for(var j=0;j<nodes.length;j++){
    nodes[j].style.setProperty("--dx", "0px");
    nodes[j].style.opacity = "1";
    (function(node, idx, mySeq){
      setTimeout(function(){
        if(mySeq !== dealSeq) return;
        playSfx("card");
        node.classList.add("dealt");
        if(idx === nodes.length - 1) state.busy = false;
      }, idx * 120);
    })(nodes[j], j, seq);
  }
}

function showGameError(err){
  var pre = document.getElementById("gameError");
  if(!pre){
    pre = document.createElement("pre");
    pre.id = "gameError";
    pre.className = "game-error";
    document.body.appendChild(pre);
  }
  pre.textContent = "GAME ERROR: " + (err && err.message ? err.message : String(err));
}

function dealBattleHand(enemy){
  try{
    handEl.innerHTML = "";
    var picks = pickBattleCards(enemy);
    if(!picks || !picks.length){
      throw new Error("pickBattleCards returned empty hand");
    }
    var nodes = [];
    for(var i=0;i<picks.length;i++){
      var p = picks[i], isM = p.kind === "M";
      /* карта создаётся НАПРЯМУЮ из строки p.text — без .find(...).text */
      var c = makeCard({
        text: p.text,
        type: isM ? "MARKER" : "VERB",
        icon: isM ? (MARKER_ICON[p.fam] || "candle") : "book"
      });
      c.setAttribute("data-kind", isM ? "M" : "V");
      c.setAttribute("data-id", p.text);   /* ключ карты = text */
      c.classList.add("flipped");            /* сдаётся face-up */
      c.style.setProperty("--i", i);
      c.style.setProperty("--dx", "140%");  /* старт: условная колода сверху-справа */
      c.style.setProperty("--dy", "-110%");
      c.style.opacity = "0";
      handEl.appendChild(c);
      nodes.push(c);
    }
    layoutFan();
    void handEl.offsetWidth;
    var seq = ++dealSeq;
    for(var j=0;j<nodes.length;j++){
      nodes[j].style.setProperty("--dx", "0px");
      nodes[j].style.opacity = "1";
      nodes[j].setAttribute("data-cid", seq + "-" + j);
      (function(node, idx, mySeq){
        setTimeout(function(){
          if(mySeq !== dealSeq) return;   /* устаревшая раздача — не трогаем новые карты */
          playSfx("card");
          node.classList.add("dealt");
          if(idx === nodes.length - 1){
            setTimeout(function(){
              if(mySeq === dealSeq) state.busy = false;
            }, 260);
          }
        }, idx * 120);
      })(nodes[j], j, seq);
    }
    /* аварийный релиз: если стаггер не дожил (race), рука всё равно откроется */
    setTimeout(function(){
      if(seq === dealSeq && handEl.contains(nodes[nodes.length - 1])) state.busy = false;
    }, nodes.length * 120 + 700);
  }catch(err){
    console.error("dealBattleHand failed:", err);
    showGameError(err);
    dealFallbackHand();
  }
}

function shakeEl(el){
  el.classList.remove("shake");
  void el.offsetWidth; /* рестарт анимации классом */
  el.classList.add("shake");
  setTimeout(function(){ el.classList.remove("shake"); }, 950);
}

/* клик по карте руки = сыграть: перелёт в СВОЙ слот (MARKER→[M], VERB→[V]) */
function playCard(card){
  if(state.busy || state.banished) return;
  if(!card.parentNode || !card.parentNode.classList.contains("hand")) return;
  var kind = card.getAttribute("data-kind");
  if(!kind) return;
  var slot = state.slots[kind];
  if(!slot) return;
  if(slot.firstChild && state.played[kind]){
    /* слот занят — shake и возврат (карта остаётся в руке) */
    shakeEl(slot);
    shakeEl(card);
    return;
  }
  state.busy = true;
  card.classList.remove("selected", "lift", "dealt");
  card.classList.add("in-slot");
  card.style.removeProperty("--dx");
  card.style.removeProperty("--dy");
  card.style.removeProperty("--rot");
  card.style.removeProperty("--i");
  slot.textContent = "";
  slot.classList.add("filled");
  slot.appendChild(card);
  state.played[kind] = card;
  playSfx("card");
  layoutFan();
  setTimeout(function(){
    state.busy = false;
    checkSlots();
  }, 480);   /* перелёт карты в слот (.5s) — проверка после морфа */
}

/* возврат сыгранной карты в руку (после промаха): полноразмерная, с анимацией обратного полёта */
function returnCard(kind){
  var card = state.played[kind];
  if(!card) return;
  /* если бой уже завершён (изгнание/поражение) — карта не возвращается в руку,
     а удаляется: рука очищается вместе с боем */
  if(state.banished || state.hp <= 0){
    if(card.parentNode) card.parentNode.removeChild(card);
    state.played[kind] = null;
    var s0 = state.slots[kind];
    if(s0){ s0.classList.remove("filled"); s0.innerHTML = "<span class=\"slot-label\">[" + kind + "]</span>"; }
    return;
  }
  var slot = state.slots[kind];
  slot.classList.remove("filled");
  slot.innerHTML = "<span class=\"slot-label\">[" + kind + "]</span>";
  card.classList.remove("in-slot");
  handEl.appendChild(card);
  void handEl.offsetWidth;               /* рука уже посчитала веер (--rot/--dy) */
  card.style.setProperty("--dx", "0px"); /* старт: позиция слота -> transition летит обратно */
  card.style.setProperty("--dy", "0px");
  card.classList.add("dealt");
  state.played[kind] = null;
}

/* ---------- ПРОВЕРКА: оба слота заняты (data-id = text карты) ----------
   Порядок проверок СТРОГО (ЭТАП 6.2 ЧАСТЬ B — диагноз по типу ошибки):
     (а) norm(маркер) ∈ normSet(enemy.acceptM) — иначе diagnosis="marker":
         "Маркер «X» (семья F1) не подходит улике духа: этот дух — семья F2,
          его маркеры: [список acceptM]." + вкусовая строка wrongReplies ниже;
     (б) norm(формы) ∈ normSet(enemy.acceptV) — иначе diagnosis="verb"
         (маркер верный): "Маркер верный, но форма «Y» — семья F2;
          улика духа просит семью F1." (acceptV не раскрывать);
     (в) family маркера === tense формы — иначе правило дружбы с фактическими семьями. */
function checkSlots(){
  var mCard = state.played.M, vCard = state.played.V;
  if(!mCard || !vCard) return;
  var enemy = currentEnemy();
  var mText = mCard.getAttribute("data-id");
  var vText = vCard.getAttribute("data-id");

  var setM = normSet(enemy.acceptM);
  var setV = normSet(enemy.acceptV);
  var okA = !!setM[norm(mText)];   /* (а) улика/маркер принят духом */
  if(!okA){ landMiss("marker", enemy, mText, vText); return; }
  var okB = !!setV[norm(vText)];   /* (б) форма принята духом */
  if(!okB){ landMiss("verb", enemy, mText, vText); return; }
  var okC = isFriendlyPairMVP(mText, vText); /* (в) семья маркера === tense формы */

  if(okC){
    landHit(mText, vText, enemy);
  }else{
    /* (а)+(б) пройдены, нарушено только (в) -> правило дружбы */
    landMiss("friendship", enemy, mText, vText);
  }
}

/* УДАР: вспышка --candle на доске, исправленная фраза + why на полосе объяснения */
function landHit(mText, vText, enemy){
  playSfx("hit");
  state.hits++;
  boardEl.classList.remove("flash");
  void boardEl.offsetWidth;
  boardEl.classList.add("flash");
  showBattleMsg(
    fixedSentenceHtml(mText, vText, true, true),
    esc(enemy.why)
  );
  state.busy = true;
  setTimeout(function(){
    if(state.hits >= HP_PER_ENEMY){
      banish(enemy, mText, vText);
    }else if(!state.banished){
      /* дух отряхивается: слоты очищаются, карты уходят, рука пересдаётся.
         ЭТАП 6.5: ветка живёт только если бой ЕЩЁ НЕ завершён изгнанием —
         иначе бан на 2-м ударе гоняется вразнобой с этим хвостовым таймером
         (двойная раздача / залипший busy ломали кнопку возврата). */
      clearSlots();
      handEl.innerHTML = "";
      dealSeq++;                   /* новые карты не получат удары старых таймеров */
      dealBattleHand(currentEnemy());
    }
  }, 1100);
}

function clearSlots(){
  var kinds = ["M","V"];
  for(var k=0;k<2;k++){
    var card = state.played[kinds[k]];
    if(card){
      card.parentNode.removeChild(card);
      state.played[kinds[k]] = null;
    }
    var slot = state.slots[kinds[k]];
    if(slot){
      slot.classList.remove("filled");
      slot.innerHTML = "<span class=\"slot-label\">[" + kinds[k] + "]</span>";
    }
  }
}

  /* Промах (ЭТАП 6.2 ЧАСТЬ B): shake слотов, карты возвращаются в руку,
   гаснет свеча HP, объяснение = СТРУКТУРНЫЙ диагноз по типу ошибки.
   Строка с полной фразой (подстановка пары) рендерится ТОЛЬКО на ударе и
   в оверлее изгнания — на промахе в .explain НЕТ сыгранной пары, только диагноз:
     "marker"     -> не тот маркер: список acceptM духа + вкусовая wrongReplies;
     "verb"       -> маркер верный, но форма не та (acceptV НЕ раскрываем);
     "friendship" -> правило дружбы с фактическими семьями обеих карт. */
function missDiagHtml(kind, enemy, mText, vText){
  var famWant = enemy.family || famOfMarker(enemy.acceptM[0]) || "simple";
  if(kind === "marker"){
    var famM = famOfMarker(mText) || "?";
    var list = enemy.acceptM.join(", ");
    var wr = enemy.wrongReplies;
    var flavor = (wr && wr.length) ? esc(wr[Math.floor(Math.random()*wr.length)]) : "";
    return "<div class=\"fixed-line\">\u041C\u0430\u0440\u043A\u0435\u0440 \u00AB" + esc(mText) +
           "\u00BB (\u0441\u0435\u043C\u044C\u044F " + esc(famM) +
           ") \u043D\u0435 \u043F\u043E\u0434\u0445\u043E\u0434\u0438\u0442 \u0443\u043B\u0438\u043A\u0435 \u0434\u0443\u0445\u0430: \u044D\u0442\u043E\u0442 \u0434\u0443\u0445 \u2014 \u0441\u0435\u043C\u044C\u044F " +
           esc(famWant) + ", \u0435\u0433\u043E \u043C\u0430\u0440\u043A\u0435\u0440\u044B: [" + esc(list) + "]." +
           (flavor ? "</div><div class=\"why-line\">" + flavor : "") + "</div>";
  }
  if(kind === "verb"){
    var tenseV = TEXT2TENSE(vText) || "?";
    return "<div class=\"fixed-line\">\u041C\u0430\u0440\u043A\u0435\u0440 \u0432\u0435\u0440\u043D\u044B\u0439, \u043D\u043E \u0444\u043E\u0440\u043C\u0430 \u00AB" + esc(vText) +
           "\u00BB \u2014 \u0441\u0435\u043C\u044C\u044F " + esc(tenseV) +
           "; \u0443\u043B\u0438\u043A\u0430 \u0434\u0443\u0445\u0430 \u043F\u0440\u043E\u0441\u0438\u0442 \u0441\u0435\u043C\u044C\u044E " + esc(famWant) + ".</div>";
  }
  /* friendship: как раньше, с фактическими семьями обеих карт */
  var fam   = famOfMarker(mText) || "simple";
  var tense = TEXT2TENSE(vText) || fam;
  var want  = fam.charAt(0).toUpperCase() + fam.slice(1);
  return "<div class=\"fixed-line\">MARK \u00AB" + esc(mText) + "\u00BB (\u0441\u0435\u043C\u044C\u044F " + esc(fam) +
         ") \u043D\u0435 \u0434\u0440\u0443\u0436\u0438\u0442 \u0441 FORM \u00AB" + esc(vText) + "\u00BB (" + esc(tense) +
         "): " + esc(fam) + " \u043F\u0440\u043E\u0441\u0438\u0442 \u0444\u043E\u0440\u043C\u0443 \u0441\u0435\u043C\u044C\u044E " + want + ".</div>";
}
function landMiss(diagKind, enemy, mText, vText){
  playSfx("miss");
  shakeEl(state.slots.M);
  shakeEl(state.slots.V);
  explainInnerEl.innerHTML = missDiagHtml(diagKind, enemy, mText, vText);
  explainInnerEl.classList.add("show");
  state.busy = true;
  setTimeout(function(){
    returnCard("M");
    returnCard("V");
    snuffHp();
    layoutFan();
    if(state.hp <= 0){
      setTimeout(showDefeat, 400);
    }else{
      state.busy = false;
    }
  }, 620);
}

/* ИЗГНАНИЕ: 2 удара — дух тускнеет (opacity .5), доска гаснет вместе с ним,
   оверлей-свиток; [Вернуться на карту] завершает бой и возвращает на карту */
function banish(enemy, mText, vText){
  playSfx("win");
  state.banished = true;
  ghostEl.classList.add("banished");
  boardSlotEl.classList.add("banished");
  handEl.innerHTML = "";
  dealSeq++;
  state.busy = false;
  flipping = false;
  tableFlip.classList.remove("no-pan");
  winPhraseEl.innerHTML = fixedSentenceHtml(mText, vText, true, true);
  winWhyEl.textContent = enemy.why;
  setTimeout(function(){ overlayWin.classList.add("show"); }, 500);
}

function showDefeat(){
  overlayLose.classList.add("show");
}

var btnNextEnemy = document.getElementById("btnNextEnemy");
/* ЭТАП 6.1: слушатель кнопки оверлея изгнания — ДЕЛЕГИРОВАНИЕМ на контейнере
   оверлея (#overlayWin), чтобы не умирал при перерендере панели/кнопки. */

/* ---------- ЭТАП 6.1: returnToMap — ЕДИНСТВЕННЫЙ возврат с грани боя на карту.
   Все ссылки (делегированный слушатель #btnNextEnemy, debug-алиас) идут через
   guard и эту функцию; состояние чистится здесь же. ---------- */
function canReturnToMap(){
  var ba = document.body.classList.contains("battle-active");
  var b  = state.banished === true;
  var bu = !state.busy;
  var ok = ba && b && bu;
  console.log("[canReturnToMap] battle-active=" + ba, "banished=" + b, "busy=" + state.busy, "result=" + ok);
  if(!ok){
    console.warn("[return-guard] blocked:",
      "battle-active=" + ba, "banished=" + b, "busy=" + state.busy);
  }
  return ok;
}
/* ЭТАП 6.7 (тесты): программный бан для браузерного прогона цикла
   бой → изгнание → возврат; игровой поток его не использует. */
window.__testBanish = function(mText, vText){
  var enemy = currentEnemy();
  if(!enemy) return false;
  banish(enemy, mText || enemy.acceptM[0], vText || enemy.acceptV[0]);
  return true;
};
window.__run = run;   /* только для тестов: seed/act/num */

function returnToMap(){
  console.log("[returnToMap] called, run.inNode=", run.inNode);
  var nd = run.inNode;

  /* очистка боя: сначала убираем карты из DOM через clearSlots (пока ссылки живы),
     и только потом обнуляем state.played */
  state.banished = false;
  state.hits     = 0;
  clearSlots();
  state.played.M = null;
  state.played.V = null;
  handEl.innerHTML = "";
  dealSeq++;
  if(window.forceFlipEnd) window.forceFlipEnd();
  ghostEl.classList.remove("banished");
  boardSlotEl.classList.remove("banished");
  hideBattleMsg();
  overlayWin.classList.remove("show");

  /* нет узла — просто возвращаемся на карту */
  if(!nd){
    travelTo(null, true);
    fightActive = false;
    document.body.classList.remove("battle-active");
    state.busy = false;
    return;
  }

  /* босс — завершение акта */
  if(nd.type === "boss"){
    run.inNode = null;
    fightActive = false;
    document.body.classList.remove("battle-active");
    state.busy = false;
    completeAct();
    return;
  }

  /* ГЛАВНОЕ ИСПРАВЛЕНИЕ:
     обновляем состояние карты СРАЗУ — до начала переворота.
     Иначе в окне 900–980 мс (flip уже закончился, finishBack ещё не сработал)
     боевой узел оставался .open, и клик по нему перезапускал тот же бой. */
  nd.traveled = true;
  run.cur     = nd;
  renderMapStates();            /* боевой узел → traveled+current, его соседи → open */

  /* финальная зачистка — выполняется по окончании переворота */
  var finishBack = function(){
    /* ЗАЩИТА ОТ ГОНОК (исправляет баг со вторым боем и "Новым run"):
       если за эти 980 мс пользователь уже успел кликнуть следующий узел (run.inNode сменился)
       или нажать "Новый run" (run.inNode = null), НЕЛЬЗЯ затирать состояние нового боя! */
    if(run.inNode !== nd) return;

    fightActive = false;
    document.body.classList.remove("battle-active");
    state.busy = false;
    run.inNode = null;          /* открывает клики по карте для пользователя */
    centerNode(nd, true);
  };

  if(tableFlip.classList.contains("flipped")){
    console.log("[returnToMap] already on map, calling finishBack sync");
    finishBack();
  }else{
    console.log("[returnToMap] on battle side, calling flipTable");
    flipTable();
    setTimeout(finishBack, FLIP_MS + 80);
  }
}

var btnRestartFight = document.getElementById("btnRestartFight");
btnRestartFight.addEventListener("click", function(e){
  e.stopPropagation();
  if(state.busy) return;
  state.busy = true;
  overlayLose.classList.remove("show");
  playSfx("card");
  state.hp = MAX_HP;
  /* этап 5: если бой шёл по маршруту карты — поражение откатывает к узлу,
     враг не листается; вне маршрута — перезапуск с того же духа */
  if(run.inNode){
    run.phase = 0;
    setTimeout(function(){ beginRunFight(); }, 250);
  }else{
    setTimeout(startFight, 250);
  }
});

/* Новый run — заглушка панели (этап 5 переопределяет обработчик на карту) */
btnNewRun.addEventListener("click", function(){
  state.enemyIdx = 0;
  state.hp = MAX_HP;
  state.busy = false;
  overlayWin.classList.remove("show");
  overlayLose.classList.remove("show");
  startFight();
});

/* этап 4.1: тумблер реликта "Лупа" (тест до этапа 7): включает табличку-улику на доске */
var btnLupa = document.getElementById("btn-lupa");
btnLupa.addEventListener("click", function(e){
  e.stopPropagation();
  lupaOn = !lupaOn;
  btnLupa.textContent = lupaOn ? "\uD83D\uDD0D Лупа: вкл" : "\uD83D\uDD0D Лупа: выкл";
  btnLupa.setAttribute("aria-pressed", lupaOn ? "true" : "false");
  renderClue(currentEnemy());
  playSfx("card");
});

/* ================================================================
   ================= ЭТАП 5: КАРТА АКТА (ГРАНЬ .face-map) ==========
   Горизонтальный путь слева направо: col 0 старт ... col 11 босс.
   Детерминированная генерация: seed = run*100 + act.
   ================================================================ */

var mapPanEl    = document.getElementById("mapPan");
var mapScrollEl = document.getElementById("mapScroll");
var mapLinesEl  = document.getElementById("mapLines");
var mapHeadEl   = document.getElementById("mapHead");

/* ---------- ЭТАП 5.3/5.4: ЛЕГЕНДА КАРТЫ (левый нижний угол .face-map) ----------
   Функция buildLegend() ОПРЕДЕЛЯЕТСЯ здесь, но ВЫЗЫВАЕТСЯ в буте ПОСЛЕ
   renderMap() и обёрнута в try/catch: падение легенды не отменяет рендер карты. */
function buildLegend(){
  var legendEl = document.getElementById("mapLegend");
  var gridEl   = document.getElementById("legendGrid");
  var btnEl    = document.getElementById("legendBtn");
  if(!legendEl || !gridEl || !btnEl) return;
  function row(glyphName, label){
    var r = document.createElement("div");
    r.className = "lg-row";
    r.appendChild(buildGlyph(glyphName));
    var t = document.createElement("span");
    t.textContent = label;
    r.appendChild(t);
    return r;
  }
  function dot(cls, label){
    var r = document.createElement("div");
    r.className = "lg-row";
    var d = document.createElement("span");
    d.className = "lg-dot" + (cls ? " " + cls : "");
    r.appendChild(d);
    var t = document.createElement("span");
    t.textContent = label;
    r.appendChild(t);
    return r;
  }
  /* глиф+подпись капсом: ТЕ ЖЕ строки типов, что создаёт генератор карты
     (fight/elite/event/rest/shop/chest/boss) — единый источник MAP_GLYPHS
     через buildGlyph/glyphSubs. Состояния рисуются отдельными mini-SVG. */
  gridEl.appendChild(row("fight", "БОЙ"));
  gridEl.appendChild(row("elite", "ЭЛИТА"));
  gridEl.appendChild(row("event", "СОБЫТИЕ"));
  gridEl.appendChild(row("rest",  "ПРИВАЛ"));
  gridEl.appendChild(row("shop",  "ЛАВКА"));
  gridEl.appendChild(row("chest", "СУНДУК"));
  gridEl.appendChild(row("boss",  "БОСС"));
  /* разделитель + состояния узла: mini-SVG без buildGlyph (в словаре
     таких ключей нет) — кольцо/пульс/блёклый круг, как у .map-node */
  var sep = document.createElement("div");
  sep.className = "lg-sep";
  gridEl.appendChild(sep);
  gridEl.appendChild(dot("cur",   "ТЕКУЩИЙ"));
  gridEl.appendChild(dot("pulse", "ДОСТУПНЫЙ"));
  gridEl.appendChild(dot("faded", "ПРОЙДЕННЫЙ"));
  /* <1200px: свёрнута в "?" — клик раскрывает/сворачивает */
  btnEl.addEventListener("click", function(e){
    e.stopPropagation();
    playSfx("card");
    legendEl.classList.toggle("open");
  });
}

var COLS = 12, COL_W = 172, PAD_X = 60;
var SHEET_W = PAD_X * 2 + (COLS - 1) * COL_W;   /* 2040px — шире грани → pan по X */

/* ---------- состояние пути (объявлено рано: обработчики боя ссылаются на run) ---------- */
var run = { num:1, act:1, maxAct:3, map:null, cur:null, inNode:null, pending:[], phase:0, resting:false };

/* ---------- seeded PRNG (mulberry32): детерминированность по seed ---------- */
function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- семплер врагов (интерфейс под этап 4.5, на заглушках CONTENT) ---------- */
var THEME_WEIGHTS = {
  1: { simple:.4, continuous:.4 },                       /* остальное .2 */
  2: { future:.35, perfect:.35 },                        /* остальное .3 */
  3: null                                                /* без весов */
};
function enemyTheme(e){
  /* topic/trap читаем если есть, иначе игнорируем (заглушки) */
  if(typeof e.topic === "string"){
    var t = e.topic.toLowerCase();
    var fams = ["simple","continuous","perfect","future"];
    for(var i=0;i<fams.length;i++) if(t.indexOf(fams[i]) >= 0) return fams[i];
  }
  if(e.family) return String(e.family).toLowerCase();
  return "simple";
}
function weightedPick(rng, list, weights){
  if(!list || !list.length) return null;
  if(!weights){ return list[Math.floor(rng()*list.length)]; }
  var total = 0, wts = [], i, w;
  for(i=0;i<list.length;i++){
    w = weights[enemyTheme(list[i])] || 0.15;
    wts.push(w); total += w;
  }
  var r = rng() * total;
  for(i=0;i<list.length;i++){ r -= wts[i]; if(r <= 0) return list[i]; }
  return list[list.length-1];
}
/* seeded-shuffle (Фишер–Йетс через rng) */
function seededShuffle(rng, list){
  var a = list.slice(), i, j, tmp;
  for(i=a.length-1;i>0;i--){
    j = Math.floor(rng()*(i+1));
    tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}
/* sampleEnemies(act, count, seed): count без повторов внутри акта;
   пул исчерпан = перетасовка сброса (resample). Возвращает массив объектов врагов. */
function sampleEnemies(act, count, seed){
  var rng = mulberry32((seed|0)*7919 + act*104729);
  var pool = CONTENT.enemies.slice();
  var out = [];
  for(var k=0;k<count;k++){
    if(!pool.length){ pool = CONTENT.enemies.slice(); }   /* сброс исчерпан — перетасовка */
    var shuffled = seededShuffle(rng, pool);
    var pickE = weightedPick(rng, shuffled, THEME_WEIGHTS[act] || null);
    pool.splice(pool.indexOf(pickE), 1);
    out.push(pickE);
  }
  return out;
}
/* элита: враг с trap:true (заглушка: Stative-Мора); fallback — последний в CONTENT */
function eliteEnemy(){
  for(var i=0;i<CONTENT.enemies.length;i++) if(CONTENT.enemies[i].trap) return CONTENT.enemies[i];
  var st = null;
  for(var j=0;j<CONTENT.enemies.length;j++) if(/stative/i.test(CONTENT.enemies[j].name||"")) st = CONTENT.enemies[j];
  return st || CONTENT.enemies[CONTENT.enemies.length-1];
}

/* ---------- генерация карты акта ---------- */
function genMap(runNum, act, seedOverride){
  var seed = (seedOverride !== undefined) ? seedOverride : (runNum * 100 + act);
  var rng = mulberry32(seed);
  var nodes = [], edges = [], c, i, j;

  for(c=0;c<COLS;c++){
    var n;
    if(c === 0) n = 1;
    else if(c === COLS-1) n = 1;
    else n = 1 + Math.floor(rng()*4);            /* col 1-10: 1-4 узла */
    var col = [];
    for(i=0;i<n;i++){
      col.push({
        id:"c"+c+"_"+i, col:c, row:i,
        x:PAD_X + c*COL_W,
        y:(n===1) ? 0.5 : (0.16 + 0.68*(i/(n-1))),
        type:null, enemy:null, el:null
      });
    }
    nodes.push(col);
  }

  /* форвард-рёбра: каждый узел col 0..10 → 1-2 случайных узла следующей колонки */
  for(c=0;c<COLS-1;c++){
    for(i=0;i<nodes[c].length;i++){
      var outs = 1 + (rng() < 0.45 ? 1 : 0);
      outs = Math.min(outs, nodes[c+1].length);
      var targets = seededShuffle(rng, nodes[c+1].slice()).slice(0, outs);
      for(j=0;j<targets.length;j++) edges.push({ from:nodes[c][i], to:targets[j] });
    }
  }
  /* обратный проход: докидываем входящие тем, у кого ноль (гарантия достижимости) */
  for(c=COLS-1;c>=1;c--){
    for(i=0;i<nodes[c].length;i++){
      var hasIn = false;
      for(j=0;j<edges.length;j++) if(edges[j].to === nodes[c][i]){ hasIn = true; break; }
      if(!hasIn){
        var prev = nodes[c-1];
        edges.push({ from:prev[Math.floor(rng()*prev.length)], to:nodes[c][i] });
      }
    }
  }

  /* типы узлов */
  function flat(from, to){
    var arr = [];
    for(var cc=from;cc<=to;cc++) arr = arr.concat(nodes[cc]);
    return arr;
  }
  function rollType(c, rngFn){
    var r = rngFn();
    if(c >= 1 && c <= 4){                     /* бой 70 / событие 20 / сундук 10 */
      if(r < .7) return "fight"; if(r < .9) return "event"; return "chest";
    }
    /* col 6-9 базово: бой 50 / элита 15 / событие 15 / сундук 12 / привал 8 */
    if(r < .5) return "fight"; if(r < .65) return "elite"; if(r < .8) return "event";
    if(r < .92) return "chest"; return "rest";
  }
  for(c=1;c<=4;c++) for(i=0;i<nodes[c].length;i++) nodes[c][i].type = rollType(c, rng);
  for(c=6;c<=9;c++) for(i=0;i<nodes[c].length;i++) nodes[c][i].type = rollType(c, rng);
  for(i=0;i<nodes[10].length;i++) nodes[10][i].type = (rng() < .5 ? "fight" : "elite");

  /* гарантированный привал: col 5 или 6 */
  var restA = (rng() < .5) ? 5 : 6;
  nodes[restA][Math.floor(rng()*nodes[restA].length)].type = "rest";
  /* гарантированный привал перед боссом: col 9 или 10 */
  var restB = (rng() < .5) ? 9 : 10;
  nodes[restB][Math.floor(rng()*nodes[restB].length)].type = "rest";
  /* ровно одна лавка в col 3-4 и ровно одна в col 7-8 */
  function placeShop(lo, hi){
    var cand = flat(lo, hi);
    var pickN = cand[Math.floor(rng()*cand.length)];
    pickN.type = "shop";
    for(var k=0;k<cand.length;k++) if(cand[k] !== pickN && cand[k].type === "shop") cand[k].type = "fight";
  }
  placeShop(3,4); placeShop(7,8);
  /* col 5 не может стать ничем иным, кроме как было задано roll'ом (col 5 вне правил типов) */
  for(i=0;i<nodes[5].length;i++){
    if(nodes[5][i].type !== "rest" && nodes[5][i].type !== "shop"){
      nodes[5][i].type = (rng() < .7) ? "fight" : (rng() < .5 ? "event" : "chest");
    }
  }
  nodes[0][0].type = "start";
  nodes[COLS-1][0].type = "boss";

  /* семплирование врагов: обычный бой — 1, элита — trap-враг, босс — 3 фазы из остатка пула */
  var battleSeq = sampleEnemies(act, 24, seed);
  var bIdx = 0;
  var bossPool = seededShuffle(rng, CONTENT.enemies.slice());
  var bi = 0;
  function nextBoss(){ var e = bossPool[bi % bossPool.length]; bi++; return e; }
  for(c=0;c<COLS;c++) for(i=0;i<nodes[c].length;i++){
    var nd = nodes[c][i];
    if(nd.type === "fight"){
      nd.enemy = battleSeq[bIdx++ % battleSeq.length];
      nd.phases = [nd.enemy];
    }else if(nd.type === "elite"){
      nd.enemy = eliteEnemy();
      nd.phases = [nd.enemy];
    }else if(nd.type === "boss"){
      /* этап 6: босс-узел пока = обычный бой с одним врагом
         (3 фазы подряд вернутся вместе с полным боссом) */
      nd.phases = [nd.enemy];
    }
  }

  return { seed:seed, nodes:nodes, edges:edges };
}

/* ---------- граф карты: утилиты ---------- */
function allNodes(){
  var arr = [];
  if(!run.map) return arr;
  for(var c=0;c<run.map.nodes.length;c++) arr = arr.concat(run.map.nodes[c]);
  return arr;
}
function outgoing(node){
  var res = [];
  for(var i=0;i<run.map.edges.length;i++) if(run.map.edges[i].from === node) res.push(run.map.edges[i]);
  return res;
}
function openEdges(){
  var res = [];
  if(run.cur){
    var oe = outgoing(run.cur);
    for(var i=0;i<oe.length;i++) if(!oe[i].to.traveled) res.push(oe[i]);
  }
  return res;
}

/* ---------- рендер листа карты + состояния (этап 5.1) ----------
   renderMapStates(): пересчёт available-узлов; вызывается при генерации
   карты, после возврата из боя и после любого изменения current. */
function renderMap(){
  /* чистим старые узлы/печать (svg-линии и заголовок переиспользуем) */
  var old = mapScrollEl.querySelectorAll(".map-node,.map-start");
  for(var o=0;o<old.length;o++) old[o].parentNode.removeChild(old[o]);
  while(mapLinesEl.firstChild) mapLinesEl.removeChild(mapLinesEl.firstChild);
  mapScrollEl.style.width = SHEET_W + "px";
  mapHeadEl.textContent = "АКТ " + run.act + " · ПУТЬ К ДУХАМ · seed " + run.map.seed;

  /* линии-нити: горизонтальные bezier пунктиром (viewBox 0..100 по высоте,
      preserveAspectRatio="none" растягивает нормализованные Y на всю грань) */
  mapLinesEl.setAttribute("viewBox", "0 0 " + SHEET_W + " 100");
  for(var e=0;e<run.map.edges.length;e++){
    var ed = run.map.edges[e];
    var x1 = ed.from.x, y1 = 12 + ed.from.y*76;
    var x2 = ed.to.x,   y2 = 12 + ed.to.y*76;
    var mx = (x1+x2)/2;
    var pth = document.createElementNS(SVGNS, "path");
    pth.setAttribute("d", "M"+x1+" "+y1+" C "+mx+" "+y1+" "+mx+" "+y2+" "+x2+" "+y2);
    pth.setAttribute("class", "mline m-future");
    pth.setAttribute("vector-effect", "non-scaling-stroke");
    mapLinesEl.appendChild(pth);
    ed.el = pth;
  }
  /* узлы */
  var list = allNodes();
  for(var i=0;i<list.length;i++){
    var nd = list[i];
    var div = document.createElement("div");
    div.className = "map-node";
    div.setAttribute("data-nid", nd.id);
    div.style.left = nd.x + "px";
    div.style.top = (12 + nd.y*76) + "%";
    if(nd.type === "boss") div.classList.add("boss");
    if(nd.type !== "start") div.appendChild(buildGlyph(nd.type));
    var pulse = document.createElement("span");
    pulse.className = "flame-pulse";
    div.appendChild(pulse);
    mapScrollEl.appendChild(div);
    nd.el = div;
  }
  /* сургучная печать START слева */
  var st = document.createElement("div");
  st.className = "map-start";
  st.style.left = nodes0x() + "px";
  st.style.top = (12 + run.map.nodes[0][0].y*76) + "%";
  var sealDiv = document.createElement("span");
  sealDiv.className = "wax-seal";
  st.appendChild(sealDiv);
  st.appendChild(document.createTextNode("START"));
  mapScrollEl.appendChild(st);

  renderMapStates();
}
function nodes0x(){ return run.map.nodes[0][0].x; }

/* ЕДИНЫЙ КЛАСС ДОСТУПНОСТИ (этап 5.2): ставится renderMapStates(),
   проверяется только обработчиком pointerup на .face-map. */
var OPEN = "open";
function availableNodes(){
  var res = [], list = allNodes();
  for(var i=0;i<list.length;i++){
    if(list[i] !== run.cur && isOpenNode(list[i])) res.push(list[i]);
  }
  return res;
}
function renderMapStates(){
  var i, list = allNodes();
  for(i=0;i<list.length;i++){
    var nd = list[i], cl = nd.el.classList;
    cl.remove("traveled","current",OPEN);
    if(nd.traveled) cl.add("traveled");
    if(run.cur && nd === run.cur) cl.add("current");   /* текущий — всегда, даже старт */
    else if(isOpenNode(nd)) cl.add(OPEN);              /* available: следующий шаг из current */
  }
  for(i=0;i<run.map.edges.length;i++){
    var ed = run.map.edges[i];
    if(!ed.el) continue;
    var cls = "mline ";
    if(ed.from.traveled && ed.to.traveled) cls += "m-traveled";
    else if((run.cur && ed.from === run.cur) && !ed.to.traveled) cls += "m-open";
    else cls += "m-future";
    ed.el.setAttribute("class", cls);
  }
  /* самотест единого класса доступности (этап 5.2) */
  console.assert(
    mapScrollEl.querySelectorAll(".map-node." + OPEN).length === availableNodes().length,
    "open class mismatch"
  );
}
function isOpenNode(nd){
  var oe = openEdges();
  for(var i=0;i<oe.length;i++) if(oe[i].to === nd) return true;
  return false;
}

/* ---------- PAN по X: drag мышью/тачем + колесо; clamp по краям ---------- */
var panX = 0, panAnim = null;
function panMin(){ return Math.min(0, (mapPanEl.clientWidth || 800) - SHEET_W); }
function applyPan(){
  panX = Math.max(panMin(), Math.min(0, panX));
  mapScrollEl.style.transform = "translateX(" + Math.round(panX) + "px)";
}
function centerNode(nd, animate){
  var avail = mapPanEl.clientWidth || 800;
  var target = avail/2 - nd.x;
  target = Math.max(panMin(), Math.min(0, target));
  if(!animate){ panX = target; applyPan(); return; }
  if(panAnim) cancelAnimationFrame(panAnim);
  var from = panX, t0 = performance.now(), DUR = 600;
  (function step(now){
    var k = Math.min(1, (now - t0)/DUR);
    k = 1 - Math.pow(1-k, 3);                    /* ease-out cubic */
    panX = from + (target - from)*k;
    applyPan();
    if(k < 1) panAnim = requestAnimationFrame(step);
    else panAnim = null;
  })(performance.now());
}
/* drag (pointer events: мышь + тач одним кодом).
   ВАЖНО (этап 5.2): НЕ используем setPointerCapture и НЕ делаем
   preventDefault/stopPropagation в pointerdown — capture ретаргетит
   события на контейнер и гасит активацию узлов. pointermove висит на
   window, чтобы drag не терялся за пределами панели. */
var dragging = false, dragStartX = 0, dragStartY = 0, dragStartPan = 0, dragMoved = false;
mapPanEl.addEventListener("pointerdown", function(e){
  if(tableFlip.classList.contains("no-pan")) return;
  /* НЕ setPointerCapture, НЕ preventDefault/stopPropagation — иначе
     браузер ретаргетит/гасит события и тап по узлу не доходит (этап 5.2) */
  dragging = true; dragMoved = false;
  dragStartX = e.clientX; dragStartY = e.clientY; dragStartPan = panX;
  mapPanEl.classList.add("dragging");
  
});
window.addEventListener("pointermove", function(e){
  if(!dragging) return;
  var dx = e.clientX - dragStartX;
  if(Math.abs(dx) > 6 || Math.abs(e.clientY - dragStartY) > 6) dragMoved = true;
  if(!dragMoved) return;              /* до порога 6px — это ещё тап, не pan */
  panX = dragStartPan + dx;
  applyPan();
});
function endDrag(){
  if(!dragging) return;
  dragging = false;
  mapPanEl.classList.remove("dragging");
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
/* колесо на грани карты = горизонтальный скролл */
mapPanEl.addEventListener("wheel", function(e){
  if(!tableFlip.classList.contains("flipped")) return;
  e.preventDefault();
  var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  panX -= d * 1.4;
  applyPan();
}, {passive:false});
/* ---------- АКТИВАЦИЯ УЗЛОВ КАРТЫ (этап 5.2): ЧЕРЕЗ POINTERUP, НЕ CLICK ----------
   Делегирование на контейнере .face-map. В pointerdown НЕ лезем в capture и
   не отменяем дефолт — там живёт только pan-drag. Слушатель 'click' для
   активации убран совсем: после setPointerCapture/pan браузер может ретаргетить
   или погасить click, поэтому решаем исход тапа сами на pointerup.
   ЕДИНЫЙ КЛАСС ДОСТУПНОСТИ: OPEN (см. ниже) — его ставит renderMapStates(),
   его же проверяет этот обработчик. */
function findNodeByEl(nodeEl){
  var list = allNodes();
  for(var i=0;i<list.length;i++) if(list[i].el === nodeEl) return list[i];
  return null;
}
function shakeNode(el){
  el.classList.remove("node-shake");
  void el.offsetWidth;                 /* перезапуск анимации */
  el.classList.add("node-shake");
  setTimeout(function(){ el.classList.remove("node-shake"); }, 950);
}
mapPanEl.addEventListener("pointerup", function(e){
  var wasDrag = dragMoved;
  dragMoved = false;                   /* сброс в любом случае */
  if(location.search.indexOf("debug") !== -1){
    console.log("[map-debug] pointerup target:", e.target, "dragMoved:", wasDrag);
  }
  if(wasDrag) return;                  /* отпускание после pan — не активация */
  if(flipping || tableFlip.classList.contains("no-pan")) return; /* время переворота: грани глухи */
  var nodeEl = (e.target && e.target.closest) ? e.target.closest(".map-node") : null;
  if(!nodeEl && document.elementFromPoint){
    nodeEl = document.elementFromPoint(e.clientX, e.clientY);
    nodeEl = nodeEl && nodeEl.closest ? nodeEl.closest(".map-node") : null;
  }
  if(location.search.indexOf("debug") !== -1){
    console.log("[map-debug] resolved node:", nodeEl);
  }
  if(!nodeEl) return;                            /* дерево/нити — ничего */
  if(!nodeEl.classList.contains(OPEN)){          /* будущий/пройденный/текущий */
    playSfx("hit");
    shakeNode(nodeEl);
    return;
  }
  var nd = findNodeByEl(nodeEl);
  if(!nd) return;
  window.startBattle(nd);              /* тонкий алиас на enterNode — единственную точку входа */
});
mapPanEl.addEventListener("pointercancel", function(){ dragMoved = false; });

/* ---------- оверлей-заглушка (привал / акт завершён / run завершён) ---------- */
var overlayGeneric = document.getElementById("overlayGeneric");
var ogTitleEl = document.getElementById("ogTitle");
var ogBodyEl  = document.getElementById("ogBody");
var ogBtn     = document.getElementById("btnOgAction");
var ogAction = null;
function showGeneric(title, body, btnLabel, action){
  ogTitleEl.textContent = title;
  ogBodyEl.innerHTML = body;
  ogBtn.textContent = btnLabel;
  ogAction = action;
  overlayGeneric.classList.add("show");
}
function hideGeneric(){ overlayGeneric.classList.remove("show"); }
ogBtn.addEventListener("click", function(e){
  e.stopPropagation();
  playSfx("card");
  hideGeneric();
  if(ogAction){ var a = ogAction; ogAction = null; a(); }
});

/* ---------- поток: вход в узел → бой → возврат ---------- */
/* ЕДИНЫЙ ДИСПЕТЧЕР ВХОДА В УЗЕЛ (этап 5.3).
   enterNode — единственная точка входа; ветвление по node.type:
     battle/elite/boss → beginFight(node)   (семплирование, доска, рука, flipTable)
     rest/shop/event/chest → openRoom(node) (комнатные свитки-заглушки)
   НИГДЕ внутри (ни в enterNode, ни в beginFight/openRoom) нет вызовов
   window.startBattle или повторного enterNode — взаимная рекурсия
   startBattle ⇄ enterNode устранена. window.startBattle — тонкий алиас. */
function beginFight(nd){
  run.inNode = nd;
  run.pending = (nd.phases && nd.phases.length) ? nd.phases.slice() : [nd.enemy];
  run.phase = 0;
  state.banished = false;
  document.body.classList.add("battle-active");
  beginRunFight();                   /* стартует бой + flipTable на грань боя */
}
function openRoom(nd){
  if(nd.type === "rest"){ doRest(nd); return; }
  playSfx("card");
  showGeneric(
    nd.type === "shop" ? "Лавка" : (nd.type === "event" ? "Событие" : "Сундук"),
    "Эта комната придёт в этапе 6.",
    "Пройти",
    function(){ travelTo(nd, true); }
  );
}
function enterNode(nd){
  if(state.entering) return;         /* реентри-гард: один вход за тап */
  state.entering = true;
  try{
    if(location.search.indexOf("debug") !== -1){
      window.__enterCount = (window.__enterCount || 0) + 1;
      console.log("[enter] #" + window.__enterCount, nd.id, nd.type);
    }
    if(nd.type === "start") return;
    if(nd.type === "fight" || nd.type === "elite" || nd.type === "boss"){ beginFight(nd); return; }
    openRoom(nd);
  }finally{
    state.entering = false;
  }
}
function beginRunFight(){
  /* текущий враг из очереди узла → в боевой state (механику боя не трогаем) */
  var en = run.pending[run.phase];
  state.enemyIdx = CONTENT.enemies.indexOf(en);
  if(state.enemyIdx < 0) state.enemyIdx = 0;
  startFight();                      /* рендер идёт через battle-active, переворот уже сделан */
}
/* после изгнания: [Вернуться на карту] завершает бой.
   Боевые и элитные узлы = один враг за узел; босс = 3 фазы подряд (run.pending). */
function afterBanish(){
  var nd = run.inNode;
  if(nd && run.phase + 1 < run.pending.length){
    run.phase++;
    playSfx("card");
    beginRunFight();
    return;
  }
  returnToMap();
}
function travelTo(nd, silent){
  if(!nd){                            /* ЭТАП 6.6: возврат без узла — просто flip на карту */
    if(!tableFlip.classList.contains("flipped")){
      flipTable();
      setTimeout(function(){ if(window.clearMapBusy) window.clearMapBusy(); }, FLIP_MS + 60);
    }
    return;
  }
  if(run.cur){ run.cur.traveled = true; }
  run.cur = nd;
  /* ЭТАП 6.5: run.inNode НЕ сбрасываем до переворота — он нужен guard'у и
     финальной очистке в returnToMap(); battle-active держится через
     fightActive (не через inNode), а inNode чистится после приземления. */
  if(!silent) playSfx("candle");
  /* ЭТАП 6.2 ЧАСТЬ A(4): снятие блокировки при переходе на карту — иначе
     pointerup-обработчик карты (if(state.busy) return) глушит клики,
     и следующая колонка после возврата неактивна.
     ЭТАП 6.3: flipping=false убрано — это внешняя переменная другой IIFE,
     no-op; flipTable() ниже сам управляет флагом. */
  state.busy = false;
  tableFlip.classList.remove("no-pan");
  if(tableFlip.classList.contains("flipped")){
    run.inNode = null;
    renderMapStates();
    centerNode(nd, true);
  }else{
    flipTable();
    setTimeout(function(){
      run.inNode = null;
      renderMapStates();
      centerNode(nd, true);
    }, FLIP_MS + 60);
  }
}
/* ЭТАП 6.5: страховка от залипшего busy — flipTable при приземлении на грань
   карты зовёт этот мост, если бой уже завершён (banished снят / вне боя). */
window.clearMapBusy = function(){
  if(!document.body.classList.contains("battle-active") && !state.banished){
    state.busy = false;
  }
};
function doRest(nd){
  playSfx("win");
  var gained = Math.min(MAX_HP - state.hp, 2);   /* +2 свечи, не выше потолка */
  state.hp = Math.min(MAX_HP, state.hp + 2);
  renderHp();
  showGeneric(
    "Отдых",
    "Тёплая свеча у костра. Восстановлено свечей: <b>" + gained + "</b>.<br>Остальные комнаты придут в этапе 6.",
    "В путь",
    function(){ travelTo(nd, false); }
  );
}
function completeAct(){
  if(run.cur){ run.cur.traveled = true; }
  if(run.act >= run.maxAct){
    showGeneric(
      "Run завершён",
      "Все три акта позади. Тьма отступила… пока.<br>(Продолжение — в будущих этапах.)",
      "Новый run",
      function(){ newRun(); }
    );
    return;
  }
  showGeneric(
    "Акт завершён",
    "Духи акта " + run.act + " изгнаны. Открывается новый путь.",
    "Следующий акт",
    function(){ nextAct(); }
  );
}
function nextAct(){
  run.act++;
  run.map = genMap(run.num, run.act);
  run.cur = run.map.nodes[0][0];
  run.cur.traveled = true;
  renderMap();
  centerNode(run.cur, false);
  if(!tableFlip.classList.contains("flipped")) flipTable();
}
function newRun(){
  run.num++;
  if(run.num > 999) run.num = 1;
  run.act = 1;
  run.inNode = null; run.pending = []; run.phase = 0;
  state.hp = MAX_HP;
  renderHp();
  run.map = genMap(run.num, run.act);
  run.cur = run.map.nodes[0][0];
  run.cur.traveled = true;
  renderMap();
  centerNode(run.cur, false);
  if(!tableFlip.classList.contains("flipped")) flipTable();
}

/* ЭТАП 6.8 (ПРАВКА 4): ЕДИНЫЙ ПРЯМОЙ слушатель на btnNextEnemy.
   Делегирование на overlayWin УДАЛЁНО полностью (дубль). Кнопка статична в
   DOM (перерендера панели нет), поэтому прямой слушатель надёжен.
   GUARD первой строкой: реагирует ТОЛЬКО когда бой реально активен на грани
   боя и дух изгнан — синтезированный после тапа click вне этого состояния
   безвреден. state.busy=true НЕ ставим — returnToMap() сам чистит busy. */
btnNextEnemy.addEventListener("click", function(e){
  console.log("[btnNextEnemy] click detected");
  e.stopPropagation();
  if(!canReturnToMap()){
    console.log("[btnNextEnemy] guard blocked");
    return;
  }
  console.log("[btnNextEnemy] guard passed");
  overlayWin.classList.remove("show");
  playSfx("card");
  returnToMap();
});


/* [Новый run] — теперь настоящий: генерирует карту и выходит на неё.
   Обработчик-заглушка этапа 3 снимается заменой узла (гарантированно). */
(function(){
  var clone = btnNewRun.cloneNode(true);
  btnNewRun.parentNode.replaceChild(clone, btnNewRun);
  btnNewRun = clone;
  btnNewRun.addEventListener("click", function(){
    playSfx("card");
    hideBattleMsg();
    overlayWin.classList.remove("show");
    overlayLose.classList.remove("show");
    hideGeneric();
    fightActive = false;
    document.body.classList.remove("battle-active");
    newRun();
  });
})();

/* отладочные ссылки для автотестов (не используются игрой) */
window.__battle = {
  CONTENT: CONTENT,
  state: state,
  startFight: startFight,
  currentEnemy: currentEnemy,
  pickBattleCards: pickBattleCards,
  /* ЭТАП 6.2 ЧАСТЬ C (тесты): программный прогон проверки пары и диагноз */
  checkSlots: checkSlots,
  missDiagHtml: missDiagHtml,
  /* ЭТАП 6.2 ЧАСТЬ C (тесты): пересборка карты с фиксированным seed
     (для гарантии боевого узла в col1); НЕ для игровой логики. */
  setMapSeed: function(seed){
    run.map = genMap(run.num, run.act, seed);
    run.cur = run.map.nodes[0][0];
    run.cur.traveled = true;
    run.inNode = null;
    renderMap();
    centerNode(run.cur, false);
  },
  lupaOn: function(v){
    if(v !== undefined){
      lupaOn = !!v;
      btnLupa.textContent = lupaOn ? "\uD83D\uDD0D Лупа: вкл" : "\uD83D\uDD0D Лупа: выкл";
      btnLupa.setAttribute("aria-pressed", lupaOn ? "true" : "false");
      renderClue(currentEnemy());
    }
    return lupaOn;
  }
};
window.__map = {
  genMap: genMap,
  sampleEnemies: sampleEnemies,
  run: run,
  renderMap: renderMap,
  centerNode: centerNode,
  get pan(){ return panX; },
  set pan(v){ panX = v; applyPan(); },
  sheetW: function(){ return SHEET_W; },
  availableNodes: availableNodes,   /* единый список доступных (класс OPEN) */
  OPEN: OPEN
};

/* selftest проходимости: 10 сгенерированных карт в console.log */
function verifyMap(m){
  var reachable = {}, frontier = [m.nodes[0][0]];
  reachable[m.nodes[0][0].id] = true;
  while(frontier.length){
    var nd = frontier.pop();
    var oe = [];
    for(var i=0;i<m.edges.length;i++) if(m.edges[i].from === nd) oe.push(m.edges[i].to);
    for(var j=0;j<oe.length;j++) if(!reachable[oe[j].id]){ reachable[oe[j].id] = true; frontier.push(oe[j]); }
  }
  var counts = {};
  for(var c=0;c<m.nodes.length;c++){
    counts[c] = m.nodes[c].length;
    for(var k=0;k<m.nodes[c].length;k++){
      if(!reachable[m.nodes[c][k].id]) return "unreachable node " + m.nodes[c][k].id;
      if(c > 0 && c < m.nodes.length-1){
        var hasIn = false;
        for(var e=0;e<m.edges.length;e++) if(m.edges[e].to === m.nodes[c][k]) hasIn = true;
        if(!hasIn) return "no incoming " + m.nodes[c][k].id;
      }
    }
  }
  if(!counts[0] === 1 && counts[0] !== 1) {}
  var rests = [], shops = [];
  for(var r=0;r<m.nodes.length;r++) for(var s=0;s<m.nodes[r].length;s++){
    if(m.nodes[r][s].type === "rest") rests.push(r);
    if(m.nodes[r][s].type === "shop") shops.push(r);
  }
  var okRest = rests.some(function(x){return x===5||x===6;}) && rests.some(function(x){return x===9||x===10;});
  var okShop = shops.filter(function(x){return x>=3&&x<=4;}).length === 1 &&
               shops.filter(function(x){return x>=7&&x<=8;}).length === 1;
  if(!okRest) return "rest placement broken";
  if(!okShop) return "shop placement broken";
  return "OK";
}
function logMaps(){
  for(var i=0;i<10;i++){
    var m = genMap(1, i+1);
    console.log("[MAPTEST " + (i+1) + "] seed=" + m.seed + " cols=" +
      m.nodes.map(function(col){return col.length;}).join(",") + " → " + verifyMap(m));
  }
}

/* ресайз: пересчитать масштаб глубины доски и полосы объяснения + clamp пана */
var resizeT = null;
window.addEventListener("resize", function(){
  if(resizeT) clearTimeout(resizeT);
  resizeT = setTimeout(function(){
    fitFaceHeights();
    applyPan();
    if(run.cur && tableFlip.classList.contains("flipped")) centerNode(run.cur, false);
  }, 200);
});

/* ================= BOOT (этап 4.3 + 5.4): старт = ГРАНЬ КАРТЫ =================
   До первой отрисовки: генерация карты акта 1, current = узел старта,
   available = узлы колонки 1 (соединённые со стартом). Никакого авто-боя
   и авто-раздачи: рука/доска рендерятся только при входе в бой через
   flipTable()/startBattle(node). */
/* window error-обработчик (этап 5.4): падение любой фазы не оставляет
   «пустой стол» без диагностики — пишем ошибку и показываем её на экране. */
window.addEventListener("error", function(ev){
  try{
    console.error("[game-error]", ev.message, ev.filename, ev.lineno);
    var pre = document.getElementById("gameError");
    if(!pre){
      pre = document.createElement("pre");
      pre.id = "gameError";
      pre.style.cssText = "position:fixed;left:8px;bottom:64px;z-index:9999;" +
        "max-width:70vw;font:12px/1.4 monospace;color:#e8dcc8;" +
        "background:rgba(11,16,22,.92);border:1px solid #3a4d63;padding:8px 10px;" +
        "pointer-events:none;white-space:pre-wrap;";
      document.body.appendChild(pre);
    }
    pre.textContent += "\n[game-error] " + ev.message + " @:" + ev.lineno;
  }catch(_e){}
});
fitFaceHeights();                 /* явная высота граней до первого рендера */
run.map = genMap(run.num, run.act);
run.cur = run.map.nodes[0][0];    /* текущий = старт */
run.cur.traveled = true;
fightActive = false;              /* бой не активен — дух/доска/HP скрыты */
document.body.classList.remove("battle-active");
tableFlip.classList.add("flipped"); /* начальная грань = КАРТА (.flipped) */
document.body.classList.add("table-map-side", "map-active");
renderMap();                      /* внутри вызывает renderMapStates: current=старт, open=col 1 */
centerNode(run.cur, false);       /* старт центрируется сразу */
/* ПОРЯДОК БУТА (этап 5.4): карта рисуется ПЕРВОЙ; buildLegend() вызывается
   в самом конце скрипта (после объявления всех зависимостей), обёрнутый
   в try/catch — падение легенды не отменяет уже отрисованную карту. */

/* этап 5.3: window.startBattle — ТОЛЬКО тонкий алиас на enterNode
   (единый диспетчер входа). Никакой рекурсии: внутри enterNode/beginFight/
   openRoom вызовов startBattle/enterNode нет; pointerup карты зовёт enterNode. */
window.startBattle = function(node){
  if(!node || state.busy) return;
  if(location.search.indexOf("debug") !== -1){ console.log("startBattle:", node.id, node.type); }
  enterNode(node);
};

/* ---------- ЭТАП 5.4: РЕНДЕР НИТЕЙ — часть единого обновления состояний ----------
   Вызывается из renderMapStates() (ниже): после возврата из боя нити тоже
   перекрашиваются (m-traveled / m-open / m-future), а не остаются «будущими». */
function renderEdgeStates(){
  if(!run.map) return;
  for(var e=0;e<run.map.edges.length;e++){
    var ed = run.map.edges[e];
    if(!ed.el) continue;
    var cls = "mline ";
    if(ed.from.traveled && ed.to.traveled) cls += "m-traveled";
    else if((run.cur && ed.from === run.cur) && !ed.to.traveled) cls += "m-open";
    else cls += "m-future";
    if(ed.el.getAttribute("class") !== cls) ed.el.setAttribute("class", cls);
  }
}

/* самотест единства классов (этап 5.2): open-класс совпадает со списком available */
function assertOpenSync(){
  console.assert(
    mapScrollEl.querySelectorAll(".map-node." + OPEN).length === availableNodes().length,
    "open class mismatch"
  );
}

/* ---------- финальный бут: легенда ПОСЛЕ готовой карты, автотесты ---------- */
try{ buildLegend(); }catch(err){ console.error("legend build failed:", err); }
assertOpenSync();
if(location.search.indexOf("debug") !== -1){ logMaps(); }

// Конец game.js
