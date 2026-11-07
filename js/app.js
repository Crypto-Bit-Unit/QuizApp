/* ============================================================
   STATE
============================================================ */
const $ = id => document.getElementById(id);
const SECTIONS = [
  {key:'MC', label:'Multiple Choice', count:300},
  {key:'TF', label:'True / False', count:300},
  {key:'Short', label:'Enumeration', count:300},
  {key:'Code', label:'Code Analysis', count:300}
];
let quiz=[], idx=0, answers=[], mode='practice', timerId=null, timeLeft=0, totalTime=0;
let shuffleOn=true;
let selectedSections = new Set(['MC','TF','Short','Code']);
let xp=0, streak=0, bestStreak=0, combo=1;
let answered = new Set(); // for skipping already scored
let wrongItems = [];

const LS = {
  get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},
  set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))
};

function shuffleArr(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function norm(s){ return String(s).toLowerCase().trim().replace(/\s+/g,' '); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* ============================================================
   SOUND & FX
============================================================ */
let audioCtx = null;
function ensureAudio(){
  if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, dur=0.1, type='sine', vol=0.12){
  try {
    const ctx = ensureAudio();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch(e){}
}
function sfxCorrect(){
  tone(523.25, 0.1, 'sine', 0.12);
  setTimeout(()=>tone(783.99, 0.15, 'sine', 0.1), 80);
}
function sfxWrong(){
  tone(220, 0.12, 'sawtooth', 0.1);
  setTimeout(()=>tone(164.81, 0.2, 'sawtooth', 0.1), 100);
}
function sfxClick(){ tone(880, 0.04, 'sine', 0.05); }
function sfxLevelUp(){
  [523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,0.15,'sine',0.12),i*80));
}

/* CONFETTI */
const cCanvas = $('confetti');
const cCtx = cCanvas.getContext('2d');
let particles = [];
function resizeCanvas(){ cCanvas.width = innerWidth; cCanvas.height = innerHeight; }
addEventListener('resize', resizeCanvas); resizeCanvas();

const COLORS = ['#38bdf8','#a855f7','#fbbf24','#22c55e','#ef4444','#f472b6','#fb923c'];
function burst(x, y, n=40){
  for (let i=0;i<n;i++){
    particles.push({
      x, y,
      vx: (Math.random()-0.5)*12,
      vy: Math.random()*-10 - 3,
      size: 3 + Math.random()*5,
      color: COLORS[Math.floor(Math.random()*COLORS.length)],
      life: 1, rot: Math.random()*Math.PI, vr:(Math.random()-0.5)*0.3
    });
  }
}
function bigBurst(){
  const cx = innerWidth/2, cy = innerHeight/2;
  for (let i=0;i<80;i++){
    const angle = (Math.PI*2*i)/80;
    const speed = 5 + Math.random()*8;
    particles.push({
      x:cx, y:cy,
      vx: Math.cos(angle)*speed,
      vy: Math.sin(angle)*speed - 3,
      size: 4 + Math.random()*6,
      color: COLORS[Math.floor(Math.random()*COLORS.length)],
      life: 1, rot: Math.random()*Math.PI, vr:(Math.random()-0.5)*0.4
    });
  }
}
function tickConfetti(){
  cCtx.clearRect(0,0,cCanvas.width,cCanvas.height);
  for (let i=particles.length-1; i>=0; i--){
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.35;
    p.vx *= 0.99; p.rot += p.vr;
    p.life -= 0.012;
    if (p.life <= 0 || p.y > cCanvas.height){
      particles.splice(i,1); continue;
    }
    cCtx.save();
    cCtx.globalAlpha = Math.max(0, p.life);
    cCtx.translate(p.x, p.y);
    cCtx.rotate(p.rot);
    cCtx.fillStyle = p.color;
    cCtx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
    cCtx.restore();
  }
  requestAnimationFrame(tickConfetti);
}
tickConfetti();

function haptic(ms=15){ if (navigator.vibrate) navigator.vibrate(ms); }

/* ============================================================
   SETUP
============================================================ */
function buildFilters(){
  const el = $('filters'); el.innerHTML='';
  SECTIONS.forEach(s=>{
    const b = document.createElement('span');
    b.className = 'filter-pill' + (selectedSections.has(s.key)?' on':'');
    b.innerHTML = `${s.label} <span class="count">(${s.count})</span>`;
    b.onclick = ()=>{ sfxClick();
      if (selectedSections.has(s.key)) selectedSections.delete(s.key);
      else selectedSections.add(s.key);
      buildFilters();
    };
    el.appendChild(b);
  });
}
function toggleShuffle(){
  shuffleOn = !shuffleOn;
  $('shuffleBtn').textContent = '🔀 Shuffle ' + (shuffleOn?'ON':'OFF');
  sfxClick();
}
function showBest(){
  const best = LS.get('bestNetQuiz', null);
  if (best){ $('bestCard').style.display='block';
    $('bestScore').textContent = `${best.score}/${best.total} (${Math.round(best.score/best.total*100)}%)`; }
}
function resetBest(){
  if (!confirm('Reset personal best?')) return;
  localStorage.removeItem('bestNetQuiz');
  $('bestCard').style.display='none';
}

/* ============================================================
   QUIZ FLOW
============================================================ */
function startQuiz(){
  if (!selectedSections.size) return alert('Pick at least one section.');
  let pool = QUESTIONS.filter(q => selectedSections.has(q.section));
  if (shuffleOn) pool = shuffleArr(pool.slice());
  const n = +$('count').value;
  quiz = pool.slice(0, Math.min(n, pool.length));
  answers = new Array(quiz.length).fill(null);
  answered = new Set();
  idx = 0;
  mode = $('mode').value;
  xp = 0; streak = 0; bestStreak = 0; combo = 1;

  $('setup').classList.add('hidden');
  $('quiz').classList.remove('hidden');

  if (mode === 'exam'){
    totalTime = (+$('minutes').value || 30) * 60;
    timeLeft = totalTime;
    $('timerRing').classList.remove('hidden');
    updateTimer();
    timerId = setInterval(()=>{
      timeLeft--; updateTimer();
      if (timeLeft <= 0) finish();
    }, 1000);
  }
  render();
}

function render(){
  const item = quiz[idx];
  $('counter').textContent = `Question ${idx+1} / ${quiz.length}`;
  $('prog').style.width = (idx/quiz.length*100) + '%';

  const secClass = item.section.toLowerCase();
  $('sectionBadge').innerHTML = `<span class="badge ${secClass}">${item.section}</span>`;

  $('qText').textContent = item.q;
  $('qCode').innerHTML = '';
  if (item.code){
    const pre = document.createElement('pre');
    const c = document.createElement('code');
    c.textContent = item.code;
    pre.appendChild(c);
    $('qCode').appendChild(pre);
  }

  const optsEl = $('qOpts'); optsEl.innerHTML = '';
  $('qShort').classList.add('hidden');

  if (item.type === 'short'){
    $('qShort').classList.remove('hidden');
    const inp = $('shortInput');
    inp.value = answers[idx] || '';
    inp.oninput = ()=>{
      answers[idx] = inp.value;
      $('nextBtn').disabled = !inp.value.trim();
    };
    setTimeout(()=>inp.focus(), 100);
  } else {
    // --- NEW: Shuffle the options! ---
    let opts = item.type === 'tf' ? ['true','false'] : [...item.opts];
    if (shuffleOn && item.type !== 'tf') {
        opts = shuffleArr(opts); 
    }
    // ---------------------------------

    opts.forEach((opt, i)=>{
      const d = document.createElement('div');
      d.className = 'opt' + (answers[idx] === opt ? ' sel' : '');
      d.dataset.value = opt;
      d.innerHTML = `<span class="num">${i+1}</span><span>${
        item.type==='tf' ? (opt==='true'?'True':'False') : escapeHtml(opt)
      }</span>`;
      d.onclick = ()=>selectOption(opt, d);
      optsEl.appendChild(d);
    });
  }

  $('nextBtn').disabled = answers[idx] === null || answers[idx] === '';
  $('nextBtn').textContent = idx === quiz.length-1 ? '🏁 Finish' : 'Next →';

  updateStatsBar();
}

function selectOption(opt, elem){
  if (mode === 'practice' && answered.has(idx)) return;
  sfxClick();
  const item = quiz[idx];
  answers[idx] = opt;
  const optsEl = $('qOpts');
  [...optsEl.children].forEach(c=>c.classList.remove('sel'));
  elem.classList.add('sel');
  $('nextBtn').disabled = false;

  if (mode === 'practice'){
    const correct = norm(item.answer);
    const userCorrect = norm(opt) === correct;
    [...optsEl.children].forEach(c=>{
      if (norm(c.dataset.value) === correct) c.classList.add('correct');
      else if (c === elem) c.classList.add('wrong');
    });

    if (!answered.has(idx)){
      answered.add(idx);
      if (userCorrect){
        sfxCorrect();
        const rect = elem.getBoundingClientRect();
        burst(rect.left + rect.width/2, rect.top + rect.height/2, 30);
        haptic(20);
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        combo = Math.min(1 + Math.floor(streak/3), 5);
        const gained = 10 * combo;
        xp += gained;
        if (streak > 0 && streak % 5 === 0){
          sfxLevelUp();
          showToast(`🔥 ${streak} streak! +${gained} XP`);
        }
        $('comboStat').classList.add('active');
        setTimeout(()=>$('comboStat').classList.remove('active'), 500);
      } else {
        sfxWrong();
        haptic([10,50,10]);
        streak = 0; combo = 1;
      }
      updateStatsBar();
    }
  } else {
    haptic(10);
  }
}

function updateStatsBar(){
  $('xpVal').textContent = xp;
  $('streakVal').textContent = streak;
  $('comboVal').textContent = '×' + combo;
}

function updateTimer(){
  const m = Math.floor(Math.max(0,timeLeft)/60);
  const s = Math.max(0,timeLeft)%60;
  $('timerTxt').textContent = `${m}:${String(s).padStart(2,'0')}`;
  const circ = 2 * Math.PI * 23;
  const pct = timeLeft / totalTime;
  $('timerCircle').style.strokeDasharray = circ;
  $('timerCircle').style.strokeDashoffset = circ * (1 - pct);
  $('timerRing').classList.toggle('warning', pct < 0.3 && pct >= 0.1);
  $('timerRing').classList.toggle('danger', pct < 0.1);
}

function nextQ(){
  if (idx < quiz.length-1){ idx++; render(); }
  else finish();
}

function toastEl(){
  let t = $('toast');
  if (!t){
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-100px);background:linear-gradient(135deg,#38bdf8,#a855f7);color:#001018;padding:12px 24px;border-radius:12px;font-weight:800;z-index:10000;box-shadow:0 8px 32px rgba(56,189,248,.5);transition:transform .4s cubic-bezier(.34,1.56,.64,1);';
    document.body.appendChild(t);
  }
  return t;
}
function showToast(msg){
  const t = toastEl();
  t.textContent = msg;
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.style.transform = 'translateX(-50%) translateY(-100px)', 1800);
}

/* ============================================================
   FINISH / RESULTS
============================================================ */
function finish(){
  clearInterval(timerId);
  $('quiz').classList.add('hidden');
  $('results').classList.remove('hidden');

  let correct = 0;
  wrongItems = [];
  const sectionStats = {}; // {MC: {correct, total}, ...}

  quiz.forEach((item, i)=>{
    if (!sectionStats[item.section]) sectionStats[item.section] = {correct:0, total:0};
    sectionStats[item.section].total++;

    const ans = answers[i];
    let ok = false;
    if (item.type === 'short'){
      if (ans && item.validate) ok = item.validate(ans);
      else {
        const a = norm(ans || '');
        const accept = (item.accept || []).map(norm);
        ok = a === norm(item.answer) || accept.includes(a);
      }
    } else {
      ok = norm(ans) === norm(item.answer);
    }
    if (ok){ correct++; sectionStats[item.section].correct++; }
    else wrongItems.push(item);
  });

  const pct = Math.round(correct/quiz.length*100);

  // animate score
  animateNumber($('scoreText'), 0, correct, 1200, v => v);

  // grade
  let grade, gradeColor;
  if (pct >= 90){ grade='🏆 Outstanding!'; gradeColor='var(--gold)'; }
  else if (pct >= 80){ grade='🌟 Great job!'; gradeColor='var(--ok)'; }
  else if (pct >= 70){ grade='👍 Good work'; gradeColor='var(--accent)'; }
  else if (pct >= 60){ grade='📚 Keep practicing'; gradeColor='var(--dim)'; }
  else { grade='💪 More study needed'; gradeColor='var(--bad)'; }
  $('gradeText').textContent = `${grade} · ${pct}%`;
  $('gradeText').style.color = gradeColor;

  // achievements
  const achs = [];
  if (pct === 100) achs.push('💯 Perfect Score');
  if (pct >= 90) achs.push('⭐ 90%+');
  if (bestStreak >= 10) achs.push(`🔥 ${bestStreak} Streak`);
  if (xp >= 200) achs.push('⚡ XP Master');
  if (quiz.length === 100) achs.push('🎯 Full Exam');
  if (mode === 'exam') achs.push('⏱ Timed Mode');
  $('achievements').innerHTML = achs.map(a=>`<span class="ach">${a}</span>`).join('');

  // breakdown
  const bd = $('breakdown');
  bd.innerHTML = '<div class="muted" style="margin-bottom:8px; font-weight:700">BY SECTION</div>';
  Object.entries(sectionStats).forEach(([sec, s])=>{
    const p = Math.round(s.correct/s.total*100);
    bd.innerHTML += `
      <div class="bd-row">
        <div class="label">${sec}</div>
        <div class="bd-bar"><div data-w="${p}"></div></div>
        <div class="bd-score">${s.correct}/${s.total}</div>
      </div>`;
  });
  setTimeout(()=>{
    bd.querySelectorAll('.bd-bar > div').forEach(d=>{
      d.style.width = d.dataset.w + '%';
    });
  }, 200);

  // review
  const review = $('review'); review.innerHTML = '';
  quiz.forEach((item, i)=>{
    const ans = answers[i];
    let ok = false;
    if (item.type === 'short'){
      if (ans && item.validate) ok = item.validate(ans);
      else {
        const a = norm(ans || '');
        const accept = (item.accept || []).map(norm);
        ok = a === norm(item.answer) || accept.includes(a);
      }
    } else ok = norm(ans) === norm(item.answer);

    const div = document.createElement('div');
    div.className = 'review-item' + (ok ? ' ok' : '');
    div.innerHTML = `
      <strong>${i+1}. ${escapeHtml(item.q)}</strong>
      ${item.code ? `<pre><code>${escapeHtml(item.code)}</code></pre>` : ''}
      <div class="muted">Your answer: <b style="color:${ok?'var(--ok)':'var(--bad)'}">${escapeHtml(String(ans ?? '—'))}</b></div>
      <div class="muted">Correct: <b style="color:var(--ok)">${escapeHtml(item.answer)}</b></div>
    `;
    review.appendChild(div);
  });

  // retry-wrong button visibility
  $('retryWrongBtn').style.display = wrongItems.length ? 'inline-block' : 'none';

  // best score
  const best = LS.get('bestNetQuiz', null);
  if (!best || correct > best.score){
    LS.set('bestNetQuiz', {score:correct, total:quiz.length});
    showToast('🎉 New personal best!');
  }

  // confetti for high scores
  if (pct >= 80){
    setTimeout(()=>{ bigBurst(); sfxLevelUp(); }, 200);
  }
}

function animateNumber(el, from, to, dur, fmt){
  const start = performance.now();
  function frame(t){
    const p = Math.min(1, (t-start)/dur);
    const eased = 1 - Math.pow(1-p, 3);
    el.textContent = fmt(Math.round(from + (to-from)*eased));
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function retryWrong(){
  if (!wrongItems.length) return;
  quiz = shuffleArr(wrongItems.slice());
  answers = new Array(quiz.length).fill(null);
  answered = new Set();
  idx = 0;
  xp = 0; streak = 0; bestStreak = 0; combo = 1;
  mode = 'practice';
  $('results').classList.add('hidden');
  $('quiz').classList.remove('hidden');
  $('timerRing').classList.add('hidden');
  render();
}

/* ============================================================
   KEYBOARD
============================================================ */
document.addEventListener('keydown', e=>{
  if ($('quiz').classList.contains('hidden')) return;
  const item = quiz[idx]; if (!item) return;
  if (item.type !== 'short' && e.key >= '1' && e.key <= '4'){
    const opts = $('qOpts').children;
    const i = +e.key - 1;
    if (opts[i]) opts[i].click();
  }
  if (e.key === 'Enter' && !$('nextBtn').disabled && document.activeElement.tagName !== 'TEXTAREA'){
    nextQ();
  }
});

/* ============================================================
   INIT
============================================================ */
buildFilters();
showBest();
