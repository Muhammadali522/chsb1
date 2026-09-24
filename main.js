// ----------------- ЭКРАНЫ -----------------
const screens = {menu: menuScreen, info: infoScreen, warn: warnScreen, test: testScreen, result: resultScreen, block: blockScreen, login: loginScreen};

// ----------------- ПРЕДМЕТЫ -----------------
const subjects = [
    {id:"math1", name:"Математика", time:600, level:"Лёгкий"},
    {id:"math2", name:"Математика", time:1200, level:"Средний"},
    {id:"math3", name:"Математика", time:1800, level:"Сложный"},
    {id:"math4", name:"Математика", time:3600, level:"ULTRA HARD"}
];

let currentSubject = null, questions = [], current = 0, timeLeft = 0, timer = null, active = false;
const prevQ = document.getElementById("prevQ");
const nextQ = document.getElementById("nextQ");
const timerSpan = document.getElementById("timer");

prevQ.onclick = () => { if(current>0) current--; showQuestion(); };
nextQ.onclick = () => { if(current<questions.length-1) current++; showQuestion(); };

// ----------------- ЛОГИН -----------------
let userName = localStorage.getItem("userName") || "";

if(!userName) show("login");
else openMenu();

document.getElementById("loginBtn").onclick = () => {
    const input = document.getElementById("userNameInput");
    if(input.value.trim() === "") return alert("Введите имя!");
    userName = input.value.trim();
    localStorage.setItem("userName", userName);
    openMenu();
};

document.getElementById("changeName").onclick = () => {
    localStorage.removeItem("userName");
    show("login");
};

// ----------------- МЕНЮ -----------------
function openMenu() {
    show("menu");
    cards.innerHTML = "";
    subjects.forEach(s => {
        const stats = JSON.parse(localStorage.getItem(s.id) || "{}");
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
            <div class="img"></div>
            <h3>${s.name}</h3>
            <p>Уровень: ${s.level}</p>
            <p>Время: ${s.time/60} мин</p>
            <p>Лучший результат: ${stats.best || 0}%</p>`;
        card.onclick = () => openInfo(s);
        cards.appendChild(card);
    });
}
openMenu();

// ----------------- ОПИСАНИЕ -----------------
function openInfo(subj) {
    currentSubject = subj;
    infoTitle.textContent = `${subj.name} — ${subj.level}`;
    infoDesc.textContent = "Контрольный тест по предмету Математика.";
    infoStats.innerHTML = `<li>Вопросов: 30</li><li>Время: ${subj.time/60} мин</li><li>Уровень: ${subj.level}</li>`;
    show("info");
}
backMenu.onclick = openMenu;
startWarn.onclick = () => show("warn");

// ----------------- ТЕСТ -----------------
startTest.onclick = async () => {
    try {
        await document.documentElement.requestFullscreen();
    } catch (_) {}
    sendStartNotification();
    startExam();
};

function startExam() {
    generateQuestions();
    timeLeft = currentSubject.time;
    current = 0;
    active = true;
    window.__examAntiCheatBlock = block;
    show("test");
    startTimer();
    createNav();
    showQuestion();

    if (window.ExamAntiCheat) ExamAntiCheat.start();

    if (!document.fullscreenElement) {
        block("FULLSCREEN_NOT_ACTIVE");
    }
}

// ----------------- ВОПРОСЫ -----------------
function generateQuestions() {
    questions=[];
    for(let i=0;i<30;i++){
        let a,b,correct;
        switch(currentSubject.level){
            case "Лёгкий": a=rand(1,20); b=rand(1,20); correct=a+b; break;
            case "Средний": a=rand(10,50); b=rand(10,50); correct=a*b; break;
            case "Сложный": a=rand(5,30); b=rand(5,30); correct=a*b+rand(1,10); break;
            case "ULTRA HARD": a=rand(10,50); b=rand(10,50); correct=a*a+b*b+rand(1,20); break;
            default: a=rand(1,20); b=rand(1,20); correct=a+b;
        }
        const answers = shuffle([correct, correct+rand(1,5), correct-rand(1,5), correct+rand(6,10)]);
        let text="";
        switch(currentSubject.level){
            case "Лёгкий": text=`${a} + ${b} = ?`; break;
            case "Средний": text=`${a} × ${b} = ?`; break;
            case "Сложный": text=`${a} × ${b} + ? = ${correct}`; break;
            case "ULTRA HARD": text=`${a}² + ${b}² + ? = ${correct}`; break;
        }
        questions.push({text, correct, answers, user:null});
    }
}

// ----------------- ПОКАЗ ВОПРОСА -----------------
function showQuestion(){
    const q=questions[current];
    qIndex.textContent=current+1;
    questionText.textContent=q.text;
    answers.innerHTML="";
    q.answers.forEach(v=>{
        const btn=document.createElement("button");
        btn.textContent=v;
        if(q.user!==null){
            btn.classList.add("disabled");
            if(v===q.correct) btn.classList.add("correct");
            if(v===q.user && v!==q.correct) btn.classList.add("wrong");
        } else btn.onclick=()=>{ q.user=v; showQuestion(); updateNav(); };
        answers.appendChild(btn);
    });
    updateNav();
}

// ----------------- НАВИГАЦИЯ -----------------
function createNav(){
    nav.innerHTML="";
    for(let i=0;i<30;i++){
        const b=document.createElement("button");
        b.textContent=i+1;
        b.onclick=()=>{ current=i; showQuestion(); };
        nav.appendChild(b);
    }
}
function updateNav(){
    [...nav.children].forEach((b,i)=>{
        b.className="";
        if(i===current) b.classList.add("current");
        else if(questions[i].user===null) b.classList.add("unanswered");
        else if(questions[i].user===questions[i].correct) b.classList.add("correct");
        else b.classList.add("wrong");
    });
}

// ----------------- ТАЙМЕР -----------------
function startTimer(){
    timerSpan.textContent=format(timeLeft);
    timer=setInterval(()=>{
        if(!active) return;
        timeLeft--;
        if(timeLeft<0){ finish(); return; }
        timerSpan.textContent=format(timeLeft);
    },1000);
}

// ----------------- ЗАВЕРШЕНИЕ -----------------
finishBtn.onclick=finish;
function finish(){
    if (!active) return;
    if (window.ExamAntiCheat) ExamAntiCheat.stop();
    clearInterval(timer);
    active=false;

    let c=0,w=0,e=0;
    questions.forEach(q=>{
        if(q.user===null)e++;
        else if(q.user===q.correct)c++;
        else w++;
    });

    const percent=Math.round(c/30*100);
    rCorrect.textContent=c;
    rWrong.textContent=w;
    rEmpty.textContent=e;
    rPercent.textContent=percent;
    rTime.textContent=format(currentSubject.time-timeLeft);

    const saved=JSON.parse(localStorage.getItem(currentSubject.id)||"{}");
    saved.best=Math.max(saved.best||0,percent);
    localStorage.setItem(currentSubject.id,JSON.stringify(saved));

    sendResultNotification();
    show("result");
}
retry.onclick=startExam;
toMenu.onclick=openMenu;

// ----------------- УВЕДОМЛЕНИЯ -----------------
async function sendExamEvent(type, data = {}) {
    const event = {
        type,
        timestamp: new Date().toISOString(),
        userName,
        subject: currentSubject?.id || null,
        url: location.href,
        data
    };

    // Production: configure a same-origin backend endpoint.
    const endpoint = window.EXAM_EVENTS_ENDPOINT;
    if (!endpoint) return;

    try {
        await fetch(endpoint, {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            credentials:"include",
            body:JSON.stringify(event),
            keepalive:true
        });
    } catch (_) {}
}

function sendStartNotification(){
    sendExamEvent("EXAM_STARTED", {
        level: currentSubject?.level || null,
        screen: `${screen.width}x${screen.height}`
    });
}

function sendResultNotification(){
    let c=0,w=0,e=0;
    questions.forEach(q=>{
        if(q.user===null)e++;
        else if(q.user===q.correct)c++;
        else w++;
    });
    sendExamEvent("EXAM_FINISHED", {
        correct:c,
        wrong:w,
        empty:e,
        percent:Math.round(c/30*100)
    });
}

let lastBlockNotification = 0;
function sendBlockNotification(reason = "Нарушение правил экзамена"){
    const now=Date.now();
    if(now-lastBlockNotification<5000) return;
    lastBlockNotification=now;
    sendExamEvent("EXAM_BLOCKED",{reason});
}

// ----------------- АНТИЧИТ -----------------
function block(reason = "Нарушение правил экзамена"){
    if(!active) return;
    active=false;
    if(window.ExamAntiCheat) ExamAntiCheat.stop();
    clearInterval(timer);
    sendBlockNotification(reason);
    show("block");
}

// ----------------- УТИЛИТЫ -----------------
function show(name){
    Object.values(screens).forEach(s=>s.classList.remove("active"));
    screens[name].classList.add("active");
}
function rand(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function shuffle(a){ return a.sort(()=>Math.random()-0.5); }
function format(s){
    const h=String(Math.floor(s/3600)).padStart(2,"0");
    const m=String(Math.floor(s%3600/60)).padStart(2,"0");
    const sec=String(s%60).padStart(2,"0");
    return `${h}:${m}:${sec}`;
}
