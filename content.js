// content.js — ДАННЫЕ ИГРЫ (маркеры, формы, враги, friendship)

/* === ЗАМЕНИ ТЕМА ЗДЕСЬ === */
var CONTENT = {
  topic: "Present Simple vs Continuous vs Perfect (stub)",
  friendship: {
    simple:     ["always","usually","often","sometimes","never","every day","every Monday","on Mondays"],
    continuous: ["now","right now","at the moment","today"],
    perfect:    ["for","since","ever","never","just","already","yet"]
  },
  markers: [
    { id:"ALWAYS",        text:"ALWAYS",        family:"simple"     },
    { id:"USUALLY",       text:"USUALLY",       family:"simple"     },
    { id:"OFTEN",         text:"OFTEN",         family:"simple"     },
    { id:"EVERY MONDAY",  text:"EVERY MONDAY",  family:"simple"     },
    { id:"EVERY DAY",     text:"EVERY DAY",     family:"simple"     },
    { id:"NOW",           text:"NOW",           family:"continuous" },
    { id:"RIGHT NOW",     text:"RIGHT NOW",     family:"continuous" },
    { id:"AT THE MOMENT", text:"AT THE MOMENT", family:"continuous" },
    { id:"FOR 2 YEARS",   text:"FOR 2 YEARS",   family:"perfect"    },
    { id:"SINCE 2024",    text:"SINCE 2024",    family:"perfect"    },
    { id:"FOR 10 YEARS",  text:"FOR 10 YEARS",  family:"perfect"    }
  ],
  verbs: [
    { id:"WORKS",             text:"WORKS",             tense:"simple"     },
    { id:"IS WORKING",        text:"IS WORKING",        tense:"continuous" },
    { id:"HAS WORKED",        text:"HAS WORKED",        tense:"perfect"    },
    { id:"HAS BEEN WORKING",  text:"HAS BEEN WORKING",  tense:"perfect"    },
    { id:"HAVE KNOWN",        text:"HAVE KNOWN",        tense:"perfect"    },
    { id:"ARE KNOWING",       text:"ARE KNOWING",       tense:"continuous" }, /* trap: stative */
    { id:"HAVE BEEN KNOWING", text:"HAVE BEEN KNOWING", tense:"continuous" }  /* trap: stative */
  ],
  enemies: [
    { name:"Дух Привычки", icon:"quill", family:"simple", clue:"every Monday",
      template:"He [V] in the lab [M].",
      acceptM:["EVERY MONDAY","EVERY DAY"], acceptV:["WORKS"],
      why:"every Monday = привычка → Present Simple",
      wrongReplies:["Дух привычки спрашивает: как часто? Ищи маркеры регулярности."] },
    { name:"Дух Сейчас", icon:"eye", family:"continuous", clue:"right now!",
      template:"He [V] in the lab [M].",
      acceptM:["NOW","RIGHT NOW","AT THE MOMENT"], acceptV:["IS WORKING"],
      why:"right now = процесс в момент речи → Present Continuous",
      wrongReplies:["Дух сейчас шепчет: прямо в эту секунду!"] },
    { name:"Дух Длительности", icon:"drop", family:"perfect", clue:"for 2 years",
      template:"He [V] in the lab [M].",
      acceptM:["FOR 2 YEARS","SINCE 2024"], acceptV:["HAS WORKED","HAS BEEN WORKING"],
      why:"for/since = длительность до сейчас → Perfect",
      wrongReplies:["Дух длительности меряет срок: for или since?"] },
    { name:"Stative-Мора", icon:"flame", family:"perfect", clue:"for 10 years",
      template:"They [V] each other [M].",
      acceptM:["FOR 10 YEARS","SINCE 2024"], acceptV:["HAVE KNOWN"],
      why:"for 10 years = длительность, но KNOW — stative: Continuous невозможен",
      wrongReplies:["Мора улыбается: не всё на свете длится."] }
  ]
};
/* === КОНЕЦ ЗАМЕНЫ ТЕМА ЗДЕСЬ === */

var MARKER_ICON = { simple:"star", continuous:"eye", perfect:"drop" };

/* сигилы семей времени для доски врага */
var FAMILY_SEAL = { simple:"sun", continuous:"flame", perfect:"hourglass" };

/* Единый стандарт ключей: text — идентификатор карты ВЕЗДЕ.
   norm/normSet — каноническая форма (trim+toUpperCase); поиски объектов по
   тексту заменены на map-функции (FAM / TEXT2FAM / TEXT2TENSE), построенные
   ОДИН раз нормализованными словарями (norm-ключ -> значение) одновременно
   из CONTENT.markers, CONTENT.verbs и массивов friendship. */
function norm(s){ return String(s == null ? "" : s).toUpperCase().replace(/\s+/g," ").trim(); }
function normSet(list){
  var out = {};
  if(list) for(var i=0;i<list.length;i++) out[norm(list[i])] = true;
  return out;
}

/* --- словари: norm(text) -> family / tense, строятся один раз --- */
var _TEXT2FAM = {}, _TEXT2TENSE = {}, _FAM = {};
(function buildLookups(){
  var i, k;
  /* friendship-массивы первыми: CONTENT-списки перекрывают их ниже */
  var fams = ["simple","continuous","perfect"];
  for(var f=0;f<fams.length;f++){
    var fl = CONTENT.friendship[fams[f]] || [];
    for(i=0;i<fl.length;i++){
      k = norm(fl[i]); if(!_FAM[k]) _FAM[k] = fams[f];
    }
  }
  for(i=0;i<CONTENT.markers.length;i++){
    k = norm(CONTENT.markers[i].text);
    if(k) _TEXT2FAM[k] = CONTENT.markers[i].family;
  }
  for(i=0;i<CONTENT.verbs.length;i++){
    k = norm(CONTENT.verbs[i].text);
    if(k) _TEXT2TENSE[k] = CONTENT.verbs[i].tense;
  }
})();

/* norm(text) -> family маркера (CONTENT.markers, затем friendship) */
function TEXT2FAM(t){ return _TEXT2FAM[norm(t)] || null; }
/* norm(text) -> tense формы (CONTENT.verbs) */
function TEXT2TENSE(t){ return _TEXT2TENSE[norm(t)] || null; }
/* norm(text) -> семья из friendship (simple/continuous/perfect) */
function FAM(t){ return _FAM[norm(t)] || null; }
/* семья маркера: сначала его family из CONTENT, иначе — из friendship */
function famOfMarker(t){ return TEXT2FAM(t) || FAM(t); }

/* friendship-списки хранятся в нижнем регистре ("every Monday") — сравниваем нормализованно */
function friendlyIn(family, word){
  var list = CONTENT.friendship[family] || [];
  for(var i=0;i<list.length;i++) if(norm(list[i]) === norm(word)) return true;
  return false;
}
/* дружба пары (условие (в)): СЕМЬЯ маркера === TENSE формы (строговое совпадение
   simple/continuous/perfect). Никаких дополнительных условий. */
function isFriendlyPairMVP(mText, vText){
  var fam = famOfMarker(mText), tense = TEXT2TENSE(vText);
  return !!(fam && tense && fam === tense);
}

/* Самотест lookup на старте: acceptM/acceptV каждого enemy через карты семейств. */
(function selftestLookups(){
  var es = CONTENT.enemies || [];
  for(var e=0;e<es.length;e++){
    var en = es[e], i, t;
    for(i=0;i<(en.acceptM||[]).length;i++){
      t = en.acceptM[i];
      if(!famOfMarker(t)) console.error("unknown text", en.name, t);
    }
    for(i=0;i<(en.acceptV||[]).length;i++){
      t = en.acceptV[i];
      if(!TEXT2TENSE(t)) console.error("unknown text", en.name, t);
    }
  }
})();

// Конец content.js
