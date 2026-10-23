// glyphs.js — SVG-ГЛИФЫ

/* ---------- гравюрные глифы узлов карты (stroke-only, 2-4 субпути) ----------
   Каждый элемент массива — ОДИН полный path-строка (начинается с M/m)
   либо "circle:x,y,r". Никакого split по пробелам. */
var MAP_GLYPHS = {
  fight: [          /* скрещённые перья */
    "M9 23 L23 9",
    "M8.5 10.5 L23 23",
    "M9 23 q1.5 -4 4.5 -6",
    "M23 9 q-4 -1.5 -6 1.5",
    "M23 23 q-1.5 -4 -4.5 -6",
    "M8.5 10.5 q4 -1.5 6 1.5"
  ],
  elite: [          /* череп-перо */
    "circle:16,13,6",
    "M12.5 18 v4 h7 v-4",
    "circle:13.8,12.5,1.1",
    "circle:18.2,12.5,1.1",
    "M16 19.5 v2.5"
  ],
  event: [          /* вопросительный знак */
    "M12.5 12 a3.6 3.6 0 1 1 5.4 3.1 c-1.6 1 -1.9 1.7 -1.9 3.4",
    "circle:16,22.6,1.1"
  ],
  rest: [           /* пламя */
    "M16 5 C11 11.5 9 14.5 9 18 a7 7 0 0 0 14 0 C23 14.5 21 11.5 16 5 z",
    "M16 13 c-2 2.6 -2.8 3.8 -2.8 5.3 a2.8 2.8 0 0 0 5.6 0 c0 -1.5 -.8 -2.7 -2.8 -5.3 z"
  ],
  shop: [           /* чернильница */
    "M10 14 h12 v9 a2 2 0 0 1 -2 2 h-8 a2 2 0 0 1 -2 -2 z",
    "M12.5 14 v-2.5 h7 V14",
    "M16 18 v4"
  ],
  chest: [          /* ларец */
    "M8 15 a8 4.5 0 0 1 16 0",
    "M8 15 v9 h16 v-9",
    "M8 19 h16",
    "circle:16,19,1.3"
  ],
  boss: [           /* глаз в двойном кольце (увеличенный узел) */
    "circle:16,16,13",
    "circle:16,16,9.5",
    "M9 16 q7 -6 14 0 q-7 6 -14 0 z",
    "circle:16,16,2.2"
  ]
};
/* GUARD (этап 5.4): отсутствующий глиф больше никогда не роняет бут —
   возвращаем фолбэк-глиф (простая свеча, 3 субпути) и пишем console.error. */
function fallbackGlyph(){
  return [
    "M13 26 h6",
    "M13 26 v-9 h6 v9",
    "M16 17 c-2.4 -3 -2.4 -4.8 0 -8 c2.4 3.2 2.4 5 0 8 z"
  ];
}
function glyphSubs(name){
  var g = MAP_GLYPHS[name];
  if(!g){ console.error('unknown glyph: ' + name); return fallbackGlyph(); }
  return g;
}
/* ЕДИНЫЙ ИСТОЧНИК ГЛИФОВ: узлы карты рисуются через glyphSubs(type),
   легенда обязана звать ТОЛЬКО её и с ТЕМИ ЖЕ type-строками генератора
   (fight/elite/event/rest/shop/chest/boss). */
function glyphFor(type){ return glyphSubs(type); }
function buildGlyph(name){
  var subs = glyphSubs(name);
  var svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  var built = [];
  for(var i=0;i<subs.length;i++){
    var s = subs[i], el;
    if(s.indexOf("circle:") === 0){
      var p = s.slice(7).split(",");
      el = document.createElementNS(SVGNS, "circle");
      el.setAttribute("cx", p[0]); el.setAttribute("cy", p[1]); el.setAttribute("r", p[2]);
    }else{
      el = document.createElementNS(SVGNS, "path");
      el.setAttribute("d", s);   /* ПОЛНАЯ строка субпути — один раз, без split */
      built.push(s);
    }
    el.setAttribute("class", "mn-glyph");
    svg.appendChild(el);
  }
  /* самотест собранных d */
  for(var t=0;t<built.length;t++){
    console.assert(/^\s*[Mm]/.test(built[t]) && /\s/.test(built[t].trim()), 'broken glyph d: '+built[t]);
  }
  return svg;
}

// Конец glyphs.js
