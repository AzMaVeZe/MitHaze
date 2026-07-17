// sfx.js - מודול אפקטים קוליים ורטט למשחק "מתחזה"
// כל הצלילים מסונתזים ב-Web Audio API - ללא קבצי אודיו חיצוניים.
// שימוש: SFX.play('turn') / SFX.toggle() / SFX.enabled
(function () {
  'use strict';

  var STORAGE_KEY = 'mithaze_sfx';
  var MASTER_VOLUME = 0.25; // ווליום צנוע

  var ctx = null;        // AudioContext (נוצר רק אחרי אינטראקציית משתמש)
  var masterGain = null; // GainNode ראשי - כל הצלילים עוברים דרכו

  // --- מצב מופעל/כבוי (נשמר ב-localStorage, ברירת מחדל: מופעל) ---
  var enabled = true;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch (e) { /* localStorage חסום - נשארים במצב מופעל */ }

  // --- יצירת/שחרור ה-AudioContext (מדיניות autoplay של iOS/Android) ---
  function ensureContext() {
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        masterGain = ctx.createGain();
        masterGain.gain.value = MASTER_VOLUME;
        masterGain.connect(ctx.destination);
      }
      // אם הדפדפן השעה את הקונטקסט - מנסים להמשיך אותו בכל נגינה
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      return ctx;
    } catch (e) {
      return null;
    }
  }

  // מאזינים חד-פעמיים לשחרור האודיו באינטראקציה הראשונה
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (evt) {
    document.addEventListener(evt, function unlock() {
      ensureContext();
      document.removeEventListener(evt, unlock);
    }, { once: true, passive: true });
  });

  // --- כלי עזר לסינתזה ---

  // טון בודד: תדר (אפשר גליסנדו), משך, עוצמה, צורת גל, זמן התחלה יחסי
  function tone(opts) {
    var t0 = ctx.currentTime + (opts.at || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.dur);
    }
    // מעטפת עוצמה: עלייה מהירה ודעיכה אקספוננציאלית (בלי קליקים)
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.vol || 0.5, t0 + (opts.attack || 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain).connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  // פרץ רעש קצר (לתיפוף/קליקים) דרך באפר אקראי
  function noise(opts) {
    var t0 = ctx.currentTime + (opts.at || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * opts.dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = opts.filterType || 'lowpass';
    filter.frequency.value = opts.filterFreq || 1000;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.vol || 0.4, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(filter).connect(gain).connect(masterGain);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  // --- הגדרות הצלילים ---
  var SOUNDS = {
    // קליק רך - הפיכת קלף
    tap: function () {
      tone({ freq: 900, freqEnd: 500, dur: 0.06, type: 'sine', vol: 0.4 });
      noise({ dur: 0.03, filterFreq: 3000, filterType: 'highpass', vol: 0.15 });
    },
    // שני צלילים עולים - "קיבלת תפקיד"
    role: function () {
      tone({ freq: 523.25, dur: 0.12, type: 'triangle', vol: 0.5 });          // דו
      tone({ freq: 783.99, dur: 0.18, type: 'triangle', vol: 0.5, at: 0.12 }); // סול
    },
    // פעמון משולש נעים - "תורך!"
    turn: function () {
      [659.25, 830.61, 987.77].forEach(function (f, i) { // מי, סול#, סי
        tone({ freq: f, dur: 0.25, type: 'sine', vol: 0.5, at: i * 0.14 });
        tone({ freq: f * 2, dur: 0.2, type: 'sine', vol: 0.15, at: i * 0.14 }); // נצנוץ אוקטבה
      });
    },
    // בום נמוך ודרמטי - ההצבעה מתחילה
    vote: function () {
      tone({ freq: 150, freqEnd: 40, dur: 0.45, type: 'sine', vol: 0.9, attack: 0.005 });
      noise({ dur: 0.15, filterFreq: 400, vol: 0.5 });
    },
    // ארפג'ו ניצחון - חמישה צלילים עולים (~1 שניה)
    win: function () {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) { // דו-מי-סול-דו-מי
        tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.45, at: i * 0.13 });
        tone({ freq: f, dur: 0.3, type: 'sine', vol: 0.2, at: i * 0.13 + 0.01 });
      });
      tone({ freq: 1318.5, dur: 0.5, type: 'sine', vol: 0.3, at: 0.65 }); // צליל סיום מתמשך
    },
    // "וואה-וואה" יורד - הפסד
    lose: function () {
      tone({ freq: 350, freqEnd: 250, dur: 0.3, type: 'sawtooth', vol: 0.3 });
      tone({ freq: 250, freqEnd: 130, dur: 0.38, type: 'sawtooth', vol: 0.3, at: 0.3 });
    },
    // פופ קטן - שחקן הצטרף ללובי
    join: function () {
      tone({ freq: 400, freqEnd: 900, dur: 0.09, type: 'sine', vol: 0.45 });
    },
    // סוויפ מתח ואז מכה - חשיפת תוצאות במסך המנחה
    reveal: function () {
      tone({ freq: 200, freqEnd: 800, dur: 0.4, type: 'sawtooth', vol: 0.2 });         // סוויפ עולה
      tone({ freq: 880, dur: 0.25, type: 'triangle', vol: 0.5, at: 0.42 });            // מכה
      tone({ freq: 110, freqEnd: 55, dur: 0.25, type: 'sine', vol: 0.6, at: 0.42 });   // בס תומך
      noise({ dur: 0.1, filterFreq: 2000, vol: 0.3, at: 0.42 });
    }
  };

  // --- דפוסי רטט תואמים (מילישניות) ---
  var VIBRATIONS = {
    tap: 15,
    role: [30, 40, 30],
    turn: [80, 50, 80, 50, 150],
    vote: [60, 30, 60],
    win: [50, 50, 50, 50, 200],
    lose: [200],
    join: null, // ללא רטט - בדרך כלל מסך מנחה
    reveal: [40, 60, 120]
  };

  // הפעלת רטט עם בדיקת תמיכה - לעולם לא זורק שגיאה
  function vibrate(pattern) {
    if (!pattern) return;
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) { /* מתעלמים */ }
  }

  // --- API ציבורי ---
  window.SFX = {
    get enabled() { return enabled; },

    // הפעלה/כיבוי + שמירה ב-localStorage
    toggle: function () {
      enabled = !enabled;
      try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
      } catch (e) { /* מתעלמים */ }
      return enabled;
    },

    // נגינת צליל + רטט תואם. בטוח לקריאה בכל שלב - לעולם לא זורק
    play: function (name) {
      if (!enabled || !SOUNDS[name]) return;
      vibrate(VIBRATIONS[name]);
      try {
        if (ensureContext()) SOUNDS[name]();
      } catch (e) { /* Web Audio נכשל - הרטט כבר הופעל */ }
    }
  };
})();
