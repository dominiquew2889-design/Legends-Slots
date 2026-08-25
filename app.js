(() => {
  "use strict";

  const CONFIG = window.LUCKY_CONFIG || {};
  const STARTING_COINS = 1000;
  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const fmt = n => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString();

  let firebaseReady = false, auth = null, db = null, currentUser = null, isAdmin = false;
  let mode = "guest", slotBet = 10, busy = false, unsubscribePlayer = null, adminPlayers = [];
  let currentSlot = "classic", currentPull = "lucky";

  const guestState = JSON.parse(localStorage.getItem("luckyLegendsGuest") || "null") || {
    coins: STARTING_COINS, stats: { plays: 0, totalWon: 0, biggestWin: 0 }
  };

  const slots = {
    classic: {
      title:"Legendary 3-Reel", machineTitle:"LEGENDARY 3-REEL", icon:"🎰", label:"CLASSIC SLOT",
      subtitle:"Classic line wins", top:"5,000 COINS", reels:3, theme:"",
      symbols:["🍒","🔔","🍀","7️⃣","💎"], weights:[34,27,20,13,6],
      rules:[
        ["💎 💎 💎","100× bet"],["7️⃣ 7️⃣ 7️⃣","50× bet"],["🍀 🍀 🍀","25× bet"],
        ["🔔 🔔 🔔","15× bet"],["🍒 🍒 🍒","10× bet"],["Any 2 matching","2× bet"]
      ]
    },
    wolfpig: {
      title:"Wolf & Piggy Fortune", machineTitle:"WOLF & PIGGY FORTUNE", icon:"🐺", label:"5 REEL FEATURE SLOT",
      subtitle:"Wild wolves • Piggy bank bonuses", top:"8,000 COINS", reels:5, theme:"wolf-theme",
      symbols:["🐷","🏠","🌾","🐺","💰","⭐"], weights:[27,24,20,14,10,5],
      rules:[
        ["3+ 🐺 anywhere","Wolf Wild bonus"],["3+ 💰 anywhere","Piggy Bank bonus"],
        ["5 matching symbols","20× bet"],["4 matching symbols","8× bet"],["3 matching symbols","3× bet"]
      ]
    },
    skywheel: {
      title:"Spin the Sky Wheel", machineTitle:"SPIN THE SKY WHEEL", icon:"🎡", label:"WHEEL BONUS SLOT",
      subtitle:"Land 3 clouds to spin the bonus wheel", top:"10,000 COINS", reels:5, theme:"sky-theme",
      symbols:["☁️","⭐","🌈","🪁","🌙","🎡"], weights:[24,24,20,17,10,5],
      rules:[
        ["3+ ☁️ anywhere","Spin the Sky Wheel"],["5 matching symbols","18× bet"],
        ["4 matching symbols","7× bet"],["3 matching symbols","3× bet"],["Wheel prizes","2× to 50× bet"]
      ]
    },
    neon: {
      title:"Neon Nights", machineTitle:"NEON NIGHTS", icon:"🌙", label:"CASCADE SLOT",
      subtitle:"Wins tumble • Chance to re-hit", top:"7,500 COINS", reels:5, theme:"neon-theme",
      symbols:["💜","⚡","🌙","💎","🎵","👑"], weights:[27,24,20,14,10,5],
      rules:[
        ["3+ matching","Pays and triggers one tumble"],["Second tumble win","+50% bonus"],
        ["5 matching symbols","20× bet"],["4 matching symbols","8× bet"],["3 matching symbols","3× bet"]
      ]
    }
  };

  const pulls = {
    lucky:{
      title:"Lucky Reveal", tag:"LUCKY REVEAL", name:"PULL TAB", cost:20, cls:"",
      desc:"Each ticket costs 20 virtual coins. Reveal all six windows and match symbols.",
      symbols:["🍀","💎","7️⃣","🔔","🍒"],
      key:[["3 matches","80"],["4 matches","200"],["5 matches","500"],["6 matches","2,000"]],
      mode:"match"
    },
    goldrush:{
      title:"Gold Rush Tabs", tag:"GOLD RUSH", name:"GOLD RUSH", cost:25, cls:"gold-ticket",
      desc:"Reveal six windows. Find gold nuggets for instant coin prizes.",
      symbols:["⛏️","🪨","✨","🪙","💰"],
      key:[["1 💰","50"],["2 💰","150"],["3 💰","400"],["4+ 💰","1,500"]],
      mode:"gold"
    },
    party:{
      title:"Party Pop Tabs", tag:"PARTY POP", name:"PARTY POP", cost:25, cls:"party-ticket",
      desc:"Match balloons for prizes. Three 🎉 symbols trigger the Party Pop bonus.",
      symbols:["🎈","🎁","🪩","🎉","🎊"],
      key:[["3 matches","100"],["4 matches","250"],["3 🎉","500 bonus"],["5+ matches","1,200"]],
      mode:"party"
    }
  };

  function saveGuest(){ localStorage.setItem("luckyLegendsGuest", JSON.stringify(guestState)); }
  function cloudConfigLooksReal(){
    const c=CONFIG.FIREBASE_CONFIG||{};
    return c.apiKey && !String(c.apiKey).startsWith("PASTE_") && c.projectId && !String(c.projectId).startsWith("PASTE_");
  }
  function randomInt(max){ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]%max; }
  function weightedPick(symbols, weights){
    const total=weights.reduce((a,b)=>a+b,0); let r=randomInt(total);
    for(let i=0;i<symbols.length;i++){ if(r<weights[i]) return symbols[i]; r-=weights[i]; }
    return symbols[0];
  }
  function toast(message){
    const el=$("#toast"); el.textContent=message; el.classList.add("show");
    clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove("show"),2200);
  }
  function showScreen(name){
    $$(".screen").forEach(el=>el.classList.remove("active"));
    $(`#${name}Screen`)?.classList.add("active");
    $$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.nav===name));
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function getState(){ return mode==="cloud" && window.__cloudPlayer ? window.__cloudPlayer : guestState; }
  function renderState(){
    const s=getState();
    $("#coinBalance").textContent=fmt(s.coins); $("#profileCoins").textContent=fmt(s.coins);
    $("#statPlays").textContent=fmt(s.stats?.plays||0); $("#statWon").textContent=fmt(s.stats?.totalWon||0);
    $("#statBiggest").textContent=fmt(s.stats?.biggestWin||0);
  }
  async function setPlayerState(next){
    if(mode==="cloud"&&currentUser&&db){
      await db.collection("users").doc(currentUser.uid).update({
        coins:Math.max(0,Math.floor(next.coins)),stats:next.stats,
        lastSeen:firebase.firestore.FieldValue.serverTimestamp()
      });
    }else{
      guestState.coins=next.coins; guestState.stats=next.stats; saveGuest(); renderState();
    }
  }
  async function applyGameResult(cost,win){
    const old=getState(); if((old.coins||0)<cost) throw new Error("Not enough coins.");
    const next={coins:Math.max(0,(old.coins||0)-cost+win),stats:{
      plays:(old.stats?.plays||0)+1,totalWon:(old.stats?.totalWon||0)+win,
      biggestWin:Math.max(old.stats?.biggestWin||0,win)
    }};
    await setPlayerState(next);
  }

  function setupSlot(key){
    currentSlot=key; const g=slots[key];
    $("#slotThemeIcon").textContent=g.icon; $("#slotModeLabel").textContent=g.label;
    $("#slotTitle").textContent=g.title; $("#slotSubtitle").textContent=g.subtitle;
    $("#machineTitle").textContent=g.machineTitle; $("#topPrizeValue").textContent=g.top;
    $("#bonusPanel").classList.add("hidden"); $("#slotMessage").textContent="Choose a bet and spin!";
    const rw=$("#reelWindow"); rw.className=`reel-window ${g.reels===5?"five-reels":""} ${g.theme}`.trim();
    rw.innerHTML='<div class="payline"></div>';
    for(let i=0;i<g.reels;i++){
      const d=document.createElement("div"); d.className="reel"; d.id=`reel${i+1}`;
      d.innerHTML=`<span>${g.symbols[(i+1)%g.symbols.length]}</span>`; rw.appendChild(d);
    }
    showScreen("slots");
  }

  function symbolCounts(arr){ return arr.reduce((m,s)=>(m[s]=(m[s]||0)+1,m),{}); }
  function maxCount(arr){ return Math.max(...Object.values(symbolCounts(arr))); }

  function baseFiveReelWin(result,bet,mults={3:3,4:8,5:20}){
    const best=maxCount(result); return bet*(mults[best]||0);
  }

  async function spinSlot(){
    if(busy)return;
    const state=getState(); if((state.coins||0)<slotBet)return toast("You need more coins for that bet.");
    busy=true; $("#spinBtn").disabled=true; $("#bonusPanel").classList.add("hidden");
    $("#slotMessage").className="win-banner"; $("#slotMessage").textContent="Spinning…";
    const game=slots[currentSlot];
    const reels=$$(".reel",$("#reelWindow"));
    reels.forEach(r=>r.classList.add("spinning"));
    const result=Array.from({length:game.reels},()=>weightedPick(game.symbols,game.weights));
    for(let i=0;i<reels.length;i++){
      await new Promise(r=>setTimeout(r,360+i*135));
      reels[i].classList.remove("spinning"); reels[i].innerHTML=`<span>${result[i]}</span>`;
    }

    let win=0, msg="";
    if(currentSlot==="classic"){
      const [a,b,c]=result;
      if(a===b&&b===c){ win=slotBet*({"💎":100,"7️⃣":50,"🍀":25,"🔔":15,"🍒":10}[a]||0); }
      else if(a===b||b===c||a===c) win=slotBet*2;
    }else if(currentSlot==="wolfpig"){
      win=baseFiveReelWin(result,slotBet);
      const c=symbolCounts(result);
      if((c["🐺"]||0)>=3){
        const bonus=slotBet*(5+randomInt(11)); win+=bonus;
        showBonus("WOLF WILD! 🐺",`The wolf went wild for <strong>+${fmt(bonus)}</strong> coins!`,"piggy");
        msg="Wolf Wild bonus!";
      }else if((c["💰"]||0)>=3){
        const bonus=slotBet*(4+randomInt(9)); win+=bonus;
        showBonus("PIGGY BANK BONUS! 🐷",`Piggy cracked the bank for <strong>+${fmt(bonus)}</strong> coins!`,"piggy");
        msg="Piggy Bank bonus!";
      }
    }else if(currentSlot==="skywheel"){
      win=baseFiveReelWin(result,slotBet,{3:3,4:7,5:18});
      const clouds=result.filter(x=>x==="☁️").length;
      if(clouds>=3){
        const wheelMult=[2,3,5,8,10,15,25,50][randomInt(8)];
        const bonus=slotBet*wheelMult; win+=bonus;
        await showWheelBonus(wheelMult,bonus); msg="Sky Wheel bonus!";
      }
    }else if(currentSlot==="neon"){
      win=baseFiveReelWin(result,slotBet);
      if(win>0){
        const tumble=Array.from({length:5},()=>weightedPick(game.symbols,game.weights));
        const tumbleWin=baseFiveReelWin(tumble,slotBet);
        if(tumbleWin>0){
          const extra=Math.floor(tumbleWin*1.5); win+=extra;
          showBonus("NEON TUMBLE! ⚡",`Your second hit paid <strong>+${fmt(extra)}</strong> coins with the 50% tumble boost.`,"cascade");
          msg="Back-to-back tumble!";
        }else{
          showBonus("TUMBLE FEATURE ⚡","Your first win triggered a tumble, but the second drop did not hit.","cascade");
        }
      }
    }

    try{
      await applyGameResult(slotBet,win);
      if(win>0){
        $("#slotMessage").textContent=`${msg?msg+" ":""}WIN +${fmt(win)} COINS`;
        $("#slotMessage").classList.add("win");
        if(win>=slotBet*20)toast("✨ Huge feature win!");
      }else $("#slotMessage").textContent="No win — spin again!";
    }catch(err){toast(err.message||"Could not save game.");}
    finally{busy=false;$("#spinBtn").disabled=false;}
  }

  function showBonus(title,body,type){
    $("#bonusPanelTitle").textContent=title;
    $("#bonusPanelBody").innerHTML= type==="piggy"
      ? `<div class="piggy-bonus"><span>🐷</span><span>💰</span><span>🐺</span></div><div>${body}</div>`
      : `<div class="cascade-note">${body}</div>`;
    $("#bonusPanel").classList.remove("hidden");
  }
  async function showWheelBonus(mult,bonus){
    $("#bonusPanelTitle").textContent="SPIN THE SKY WHEEL!";
    $("#bonusPanelBody").innerHTML=`<div class="wheel-bonus spinning-wheel"></div><div>Wheel spinning…</div>`;
    $("#bonusPanel").classList.remove("hidden");
    await new Promise(r=>setTimeout(r,950));
    $("#bonusPanelBody").innerHTML=`<div class="wheel-bonus"></div><div><strong>${mult}× BET!</strong> +${fmt(bonus)} coins</div>`;
  }

  function setupPull(key){
    currentPull=key; const g=pulls[key];
    $("#pullTag").textContent=g.tag; $("#pullTitle").textContent=g.title; $("#pullDescription").textContent=g.desc;
    $("#ticketGameName").textContent=g.name; $("#ticketCostLabel").textContent=`${g.cost} COINS`;
    $("#ticketBoard").className=`ticket-board ${g.cls}`.trim();
    $("#pullPrizeKey").innerHTML=g.key.map(x=>`<span>${x[0]} = ${x[1]}</span>`).join("");
    resetTicket(); showScreen("pulltabs");
  }
  function resetTicket(){
    const grid=$("#ticketGrid"); grid.innerHTML="";
    for(let i=0;i<6;i++){ const d=document.createElement("div"); d.className="tab-window covered"; d.innerHTML="<span>?</span>"; grid.appendChild(d); }
    $("#ticketResult").textContent="Buy a ticket to play.";
  }

  function makePullTicket(g){
    if(g.mode==="match"){
      const roll=randomInt(1000); let mc=0;
      if(roll<8)mc=6; else if(roll<28)mc=5; else if(roll<78)mc=4; else if(roll<238)mc=3;
      const match=g.symbols[randomInt(g.symbols.length)]; let out=[];
      if(mc){ out=Array(mc).fill(match); while(out.length<6){ let s=g.symbols[randomInt(g.symbols.length)]; if(s===match)s=g.symbols[(g.symbols.indexOf(s)+1)%g.symbols.length]; out.push(s); } }
      else{ while(out.length<6){ const s=g.symbols[randomInt(g.symbols.length)]; if(out.filter(x=>x===s).length<2)out.push(s); } }
      return shuffle(out);
    }
    if(g.mode==="gold"){
      const roll=randomInt(1000); let nuggets=0;
      if(roll<15)nuggets=4; else if(roll<55)nuggets=3; else if(roll<160)nuggets=2; else if(roll<390)nuggets=1;
      let out=Array(nuggets).fill("💰");
      const fillers=["⛏️","🪨","✨","🪙"];
      while(out.length<6)out.push(fillers[randomInt(fillers.length)]);
      return shuffle(out);
    }
    // party
    const roll=randomInt(1000);
    if(roll<45) return shuffle(["🎉","🎉","🎉","🎈","🎁","🪩"]);
    let mc=0; if(roll<75)mc=6; else if(roll<130)mc=5; else if(roll<250)mc=4; else if(roll<470)mc=3;
    const match=["🎈","🎁","🪩","🎊"][randomInt(4)];
    let out=Array(mc).fill(match);
    while(out.length<6){ const s=g.symbols[randomInt(g.symbols.length)]; if(s!==match||out.filter(x=>x===s).length<2)out.push(s); }
    return shuffle(out);
  }
  function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a; }
  function pullPrize(g,ticket){
    const c=symbolCounts(ticket), best=Math.max(...Object.values(c));
    if(g.mode==="match")return ({3:80,4:200,5:500,6:2000})[best]||0;
    if(g.mode==="gold"){ const n=c["💰"]||0; return n>=4?1500:n===3?400:n===2?150:n===1?50:0; }
    if((c["🎉"]||0)>=3)return 500;
    return best>=5?1200:best===4?250:best===3?100:0;
  }

  async function buyTicket(){
    if(busy)return;
    const g=pulls[currentPull], state=getState();
    if((state.coins||0)<g.cost)return toast(`You need ${g.cost} coins for this ticket.`);
    busy=true; $("#buyTicketBtn").disabled=true;
    const ticket=makePullTicket(g), prize=pullPrize(g,ticket), windows=$$(".tab-window",$("#ticketGrid"));
    $("#ticketResult").textContent="Opening ticket…";
    for(let i=0;i<windows.length;i++){
      await new Promise(r=>setTimeout(r,160));
      windows[i].classList.remove("covered"); windows[i].classList.add("reveal");
      windows[i].innerHTML=`<span>${ticket[i]}</span>`;
    }
    try{
      await applyGameResult(g.cost,prize);
      $("#ticketResult").textContent=prize?`WINNER! +${fmt(prize)} COINS`:"No prize on this ticket.";
      if(prize)toast(`🎟️ You won ${fmt(prize)} coins!`);
    }catch(err){toast(err.message||"Could not save ticket.");}
    finally{busy=false;$("#buyTicketBtn").disabled=false;}
  }

  function renderRules(){
    const g=slots[currentSlot]; $("#rulesTitle").textContent=g.title;
    $("#rulesBody").innerHTML=g.rules.map(r=>`<div><span>${r[0]}</span><strong>${r[1]}</strong></div>`).join("");
  }

  function updateAuthUI(){
    const signedIn=!!currentUser;
    $("#signedOutView").classList.toggle("hidden",signedIn); $("#signedInView").classList.toggle("hidden",!signedIn);
    $("#adminNavBtn").classList.toggle("hidden",!isAdmin); $("#openAdminBtn").classList.toggle("hidden",!isAdmin);
    if(signedIn){$("#profileName").textContent=currentUser.displayName||"Player";$("#profileEmail").textContent=currentUser.email||"";}
    renderState();
  }

  async function initFirebase(){
    if(!cloudConfigLooksReal()){console.info("Lucky Legends: Firebase not configured. Guest Mode active.");updateAuthUI();return;}
    try{
      firebase.initializeApp(CONFIG.FIREBASE_CONFIG); auth=firebase.auth(); db=firebase.firestore(); firebaseReady=true;
      auth.onAuthStateChanged(async user=>{
        currentUser=user; isAdmin=!!user&&String(user.email||"").toLowerCase()===String(CONFIG.ADMIN_EMAIL||"").toLowerCase();
        if(unsubscribePlayer){unsubscribePlayer();unsubscribePlayer=null;}
        if(user){
          mode="cloud"; const ref=db.collection("users").doc(user.uid); const snap=await ref.get();
          if(!snap.exists)await ref.set({displayName:user.displayName||"Player",email:user.email||"",coins:STARTING_COINS,stats:{plays:0,totalWon:0,biggestWin:0},createdAt:firebase.firestore.FieldValue.serverTimestamp(),lastSeen:firebase.firestore.FieldValue.serverTimestamp()});
          unsubscribePlayer=ref.onSnapshot(s=>{if(s.exists){window.__cloudPlayer=s.data();renderState();}});
        }else{mode="guest";window.__cloudPlayer=null;}
        updateAuthUI();
      });
    }catch(err){console.error(err);toast("Cloud setup error — Guest Mode is still available.");}
  }
  async function signIn(email,password){if(!firebaseReady)throw new Error("Cloud accounts are not configured yet. See README.md.");await auth.signInWithEmailAndPassword(email,password);}
  async function signUp(name,email,password){
    if(!firebaseReady)throw new Error("Cloud accounts are not configured yet. See README.md.");
    const cred=await auth.createUserWithEmailAndPassword(email,password); await cred.user.updateProfile({displayName:name});
    await db.collection("users").doc(cred.user.uid).set({displayName:name,email,coins:STARTING_COINS,stats:{plays:0,totalWon:0,biggestWin:0},createdAt:firebase.firestore.FieldValue.serverTimestamp(),lastSeen:firebase.firestore.FieldValue.serverTimestamp()});
  }

  async function loadAdminPlayers(){
    if(!isAdmin||!db)return; $("#playerList").innerHTML='<div class="player-row">Loading players…</div>';
    try{const snap=await db.collection("users").limit(100).get();adminPlayers=snap.docs.map(d=>({id:d.id,...d.data()}));$("#adminPlayerCount").textContent=adminPlayers.length;renderAdminPlayers();}
    catch(err){$("#playerList").innerHTML='<div class="player-row">Could not load players. Check Firestore rules.</div>';console.error(err);}
  }
  function renderAdminPlayers(){
    if(!isAdmin)return; const term=$("#playerSearch").value.trim().toLowerCase();
    const list=adminPlayers.filter(p=>!term||String(p.displayName||"").toLowerCase().includes(term)||String(p.email||"").toLowerCase().includes(term));
    $("#playerList").innerHTML="";
    if(!list.length){$("#playerList").innerHTML='<div class="player-row">No players found.</div>';return;}
    list.forEach(p=>{
      const row=document.createElement("div");row.className="player-row";
      row.innerHTML=`<div class="player-main"><div class="player-name"><strong>${escapeHtml(p.displayName||"Player")}</strong><small>${escapeHtml(p.email||p.id)}</small></div><div class="player-coins">🪙 ${fmt(p.coins)}</div></div><div class="adjust-row"><input type="number" min="1" step="1" value="100" aria-label="Coin amount"><button class="add-btn">+ Add</button><button class="remove-btn">− Remove</button></div>`;
      const input=$("input",row);$(".add-btn",row).addEventListener("click",()=>adminAdjust(p.id,Math.abs(Number(input.value)||0)));$(".remove-btn",row).addEventListener("click",()=>adminAdjust(p.id,-Math.abs(Number(input.value)||0)));$("#playerList").appendChild(row);
    });
  }
  async function adminAdjust(uid,delta){
    if(!isAdmin||!db||!delta)return;
    try{const ref=db.collection("users").doc(uid);await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)throw new Error("Player not found.");const oldCoins=Number(snap.data().coins)||0;tx.update(ref,{coins:Math.max(0,Math.floor(oldCoins+delta)),lastAdminAdjustment:delta,lastAdminAdjustmentAt:firebase.firestore.FieldValue.serverTimestamp()});});toast(`${delta>0?"Added":"Removed"} ${fmt(Math.abs(delta))} coins.`);await loadAdminPlayers();}
    catch(err){console.error(err);toast("Admin change failed. Check your rules/admin email.");}
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}

  $$("[data-slot]").forEach(b=>b.addEventListener("click",()=>setupSlot(b.dataset.slot)));
  $$("[data-pull]").forEach(b=>b.addEventListener("click",()=>setupPull(b.dataset.pull)));
  $$("[data-back]").forEach(b=>b.addEventListener("click",()=>showScreen("home")));
  $$("[data-nav]").forEach(btn=>btn.addEventListener("click",()=>{
    if(btn.dataset.nav==="admin"&&!isAdmin)return;
    if(btn.dataset.nav==="slots")setupSlot(currentSlot);
    else if(btn.dataset.nav==="pulltabs")setupPull(currentPull);
    else{showScreen(btn.dataset.nav);if(btn.dataset.nav==="admin")loadAdminPlayers();}
  }));
  $$(".bet-btn").forEach(btn=>btn.addEventListener("click",()=>{slotBet=Number(btn.dataset.bet);$$(".bet-btn").forEach(x=>x.classList.toggle("active",x===btn));$("#spinCost").textContent=`${slotBet} COINS`; }));
  $("#spinBtn").addEventListener("click",spinSlot);
  $("#buyTicketBtn").addEventListener("click",async()=>{resetTicket();await buyTicket();});
  $("#paytableBtn").addEventListener("click",()=>{renderRules();$("#paytableModal").classList.remove("hidden");});
  $("[data-close-paytable]").addEventListener("click",()=>$("#paytableModal").classList.add("hidden"));

  function openAccount(){$("#accountModal").classList.remove("hidden");}
  function closeAccount(){$("#accountModal").classList.add("hidden");}
  $("#accountBtn").addEventListener("click",openAccount);$("[data-close-modal]").addEventListener("click",closeAccount);
  $("#guestBtn").addEventListener("click",()=>{mode="guest";closeAccount();renderState();toast("Guest Mode active on this device.");});
  $$(".auth-tab").forEach(tab=>tab.addEventListener("click",()=>{$$(".auth-tab").forEach(x=>x.classList.toggle("active",x===tab));$("#signInForm").classList.toggle("hidden",tab.dataset.authTab!=="signin");$("#signUpForm").classList.toggle("hidden",tab.dataset.authTab!=="signup");$("#authMessage").textContent="";}));
  $("#signInForm").addEventListener("submit",async e=>{e.preventDefault();$("#authMessage").textContent="Signing in…";try{await signIn($("#signInEmail").value.trim(),$("#signInPassword").value);$("#authMessage").textContent="";closeAccount();toast("Signed in.");}catch(err){$("#authMessage").textContent=err.message;}});
  $("#signUpForm").addEventListener("submit",async e=>{e.preventDefault();$("#authMessage").textContent="Creating account…";try{await signUp($("#signUpName").value.trim(),$("#signUpEmail").value.trim(),$("#signUpPassword").value);$("#authMessage").textContent="";closeAccount();toast("Account created with 1,000 coins!");}catch(err){$("#authMessage").textContent=err.message;}});
  $("#signOutBtn").addEventListener("click",async()=>{if(auth)await auth.signOut();closeAccount();toast("Signed out. Guest Mode restored.");});
  $("#openAdminBtn").addEventListener("click",()=>{if(!isAdmin)return;closeAccount();showScreen("admin");loadAdminPlayers();});
  $("#refreshPlayersBtn").addEventListener("click",loadAdminPlayers);$("#playerSearch").addEventListener("input",renderAdminPlayers);
  $("#accountModal").addEventListener("click",e=>{if(e.target===$("#accountModal"))closeAccount();});
  $("#paytableModal").addEventListener("click",e=>{if(e.target===$("#paytableModal"))$("#paytableModal").classList.add("hidden");});

  setupPull(currentPull); showScreen("home"); renderState(); initFirebase();
})();