(() => {
  "use strict";

  const CONFIG = window.LUCKY_CONFIG || {};
  const STARTING_COINS = 1000;
  const TICKET_COST = 20;
  const symbols = ["🍒", "🔔", "🍀", "7️⃣", "💎"];
  const symbolWeights = [34, 27, 20, 13, 6];

  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const fmt = n => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString();

  let firebaseReady = false;
  let auth = null;
  let db = null;
  let currentUser = null;
  let isAdmin = false;
  let mode = "guest";
  let slotBet = 10;
  let busy = false;
  let unsubscribePlayer = null;
  let adminPlayers = [];

  const guestState = JSON.parse(localStorage.getItem("luckyLegendsGuest") || "null") || {
    coins: STARTING_COINS,
    stats: { plays: 0, totalWon: 0, biggestWin: 0 }
  };

  function saveGuest() {
    localStorage.setItem("luckyLegendsGuest", JSON.stringify(guestState));
  }

  function cloudConfigLooksReal() {
    const c = CONFIG.FIREBASE_CONFIG || {};
    return c.apiKey && !String(c.apiKey).startsWith("PASTE_") &&
      c.projectId && !String(c.projectId).startsWith("PASTE_");
  }

  function randomInt(max) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] % max;
  }

  function weightedSymbol() {
    const total = symbolWeights.reduce((a, b) => a + b, 0);
    let roll = randomInt(total);
    for (let i = 0; i < symbols.length; i++) {
      if (roll < symbolWeights[i]) return symbols[i];
      roll -= symbolWeights[i];
    }
    return symbols[0];
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function showScreen(name) {
    $$(".screen").forEach(el => el.classList.remove("active"));
    const target = $(`#${name}Screen`);
    if (!target) return;
    target.classList.add("active");
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getState() {
    if (mode === "cloud" && window.__cloudPlayer) return window.__cloudPlayer;
    return guestState;
  }

  function renderState() {
    const state = getState();
    $("#coinBalance").textContent = fmt(state.coins);
    $("#profileCoins").textContent = fmt(state.coins);
    $("#statPlays").textContent = fmt(state.stats?.plays || 0);
    $("#statWon").textContent = fmt(state.stats?.totalWon || 0);
    $("#statBiggest").textContent = fmt(state.stats?.biggestWin || 0);
  }

  async function setPlayerState(next) {
    if (mode === "cloud" && currentUser && db) {
      await db.collection("users").doc(currentUser.uid).update({
        coins: Math.max(0, Math.floor(next.coins)),
        stats: next.stats,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      guestState.coins = next.coins;
      guestState.stats = next.stats;
      saveGuest();
      renderState();
    }
  }

  async function applyGameResult(cost, win) {
    const old = getState();
    if ((old.coins || 0) < cost) throw new Error("Not enough coins.");
    const next = {
      coins: Math.max(0, (old.coins || 0) - cost + win),
      stats: {
        plays: (old.stats?.plays || 0) + 1,
        totalWon: (old.stats?.totalWon || 0) + win,
        biggestWin: Math.max(old.stats?.biggestWin || 0, win)
      }
    };
    await setPlayerState(next);
  }

  function calculateSlotWin(result, bet) {
    const [a,b,c] = result;
    if (a === b && b === c) {
      const mult = { "💎": 100, "7️⃣": 50, "🍀": 25, "🔔": 15, "🍒": 10 }[a] || 0;
      return bet * mult;
    }
    if (a === b || b === c || a === c) return bet * 2;
    return 0;
  }

  async function spinSlot() {
    if (busy) return;
    const state = getState();
    if ((state.coins || 0) < slotBet) return toast("You need more coins for that bet.");
    busy = true;
    $("#spinBtn").disabled = true;
    $("#slotMessage").className = "win-banner";
    $("#slotMessage").textContent = "Spinning…";
    const reels = [$("#reel1"), $("#reel2"), $("#reel3")];
    reels.forEach(r => r.classList.add("spinning"));

    const result = [weightedSymbol(), weightedSymbol(), weightedSymbol()];

    for (let i = 0; i < reels.length; i++) {
      await new Promise(r => setTimeout(r, 480 + i * 260));
      reels[i].classList.remove("spinning");
      reels[i].innerHTML = `<span>${result[i]}</span>`;
    }

    const win = calculateSlotWin(result, slotBet);
    try {
      await applyGameResult(slotBet, win);
      if (win > 0) {
        $("#slotMessage").textContent = `WIN! +${fmt(win)} COINS`;
        $("#slotMessage").classList.add("win");
        if (win >= slotBet * 25) toast("✨ Legendary hit!");
      } else {
        $("#slotMessage").textContent = "No win — spin again!";
      }
    } catch (err) {
      toast(err.message || "Could not save game.");
    } finally {
      busy = false;
      $("#spinBtn").disabled = false;
    }
  }

  function createTicketSymbols() {
    // Prize tiers are produced with controlled rarity; everything is virtual.
    const roll = randomInt(1000);
    let matchCount = 0;
    if (roll < 8) matchCount = 6;          // 0.8%
    else if (roll < 28) matchCount = 5;    // 2.0%
    else if (roll < 78) matchCount = 4;    // 5.0%
    else if (roll < 238) matchCount = 3;   // 16.0%

    const matchSymbol = symbols[randomInt(symbols.length)];
    let out = [];
    if (matchCount) {
      out = Array(matchCount).fill(matchSymbol);
      while (out.length < 6) {
        let s = symbols[randomInt(symbols.length)];
        if (s === matchSymbol) s = symbols[(symbols.indexOf(s) + 1 + randomInt(symbols.length - 1)) % symbols.length];
        out.push(s);
      }
    } else {
      // Ensure no symbol appears 3 times.
      while (out.length < 6) {
        const s = symbols[randomInt(symbols.length)];
        const count = out.filter(x => x === s).length;
        if (count < 2) out.push(s);
      }
    }
    // Fisher-Yates
    for (let i = out.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function pullTabPrize(ticket) {
    const counts = {};
    ticket.forEach(s => counts[s] = (counts[s] || 0) + 1);
    const best = Math.max(...Object.values(counts));
    return ({3:80,4:200,5:500,6:2000})[best] || 0;
  }

  function resetTicket() {
    const grid = $("#ticketGrid");
    grid.innerHTML = "";
    for (let i = 0; i < 6; i++) {
      const d = document.createElement("div");
      d.className = "tab-window covered";
      d.innerHTML = "<span>?</span>";
      grid.appendChild(d);
    }
  }

  async function buyTicket() {
    if (busy) return;
    const state = getState();
    if ((state.coins || 0) < TICKET_COST) return toast("You need 20 coins for a ticket.");
    busy = true;
    $("#buyTicketBtn").disabled = true;
    const ticket = createTicketSymbols();
    const prize = pullTabPrize(ticket);
    const windows = $$(".tab-window", $("#ticketGrid"));
    $("#ticketResult").textContent = "Opening ticket…";

    for (let i = 0; i < windows.length; i++) {
      await new Promise(r => setTimeout(r, 180));
      windows[i].classList.remove("covered");
      windows[i].classList.add("reveal");
      windows[i].innerHTML = `<span>${ticket[i]}</span>`;
    }

    try {
      await applyGameResult(TICKET_COST, prize);
      $("#ticketResult").textContent = prize ? `WINNER! +${fmt(prize)} COINS` : "No prize on this ticket.";
      if (prize) toast(`🎟️ You won ${fmt(prize)} coins!`);
    } catch (err) {
      toast(err.message || "Could not save ticket.");
    } finally {
      busy = false;
      $("#buyTicketBtn").disabled = false;
      setTimeout(() => $$(".tab-window").forEach(x => x.classList.remove("reveal")), 500);
    }
  }

  function updateAuthUI() {
    const signedIn = !!currentUser;
    $("#signedOutView").classList.toggle("hidden", signedIn);
    $("#signedInView").classList.toggle("hidden", !signedIn);
    $("#adminNavBtn").classList.toggle("hidden", !isAdmin);
    $("#openAdminBtn").classList.toggle("hidden", !isAdmin);

    if (signedIn) {
      $("#profileName").textContent = currentUser.displayName || "Player";
      $("#profileEmail").textContent = currentUser.email || "";
    }
    renderState();
  }

  async function initFirebase() {
    if (!cloudConfigLooksReal()) {
      console.info("Lucky Legends: Firebase is not configured. Guest Mode is active.");
      updateAuthUI();
      return;
    }
    try {
      firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      firebaseReady = true;

      auth.onAuthStateChanged(async user => {
        currentUser = user;
        isAdmin = !!user && String(user.email || "").toLowerCase() === String(CONFIG.ADMIN_EMAIL || "").toLowerCase();

        if (unsubscribePlayer) {
          unsubscribePlayer();
          unsubscribePlayer = null;
        }

        if (user) {
          mode = "cloud";
          const ref = db.collection("users").doc(user.uid);
          const snap = await ref.get();
          if (!snap.exists) {
            await ref.set({
              displayName: user.displayName || "Player",
              email: user.email || "",
              coins: STARTING_COINS,
              stats: { plays: 0, totalWon: 0, biggestWin: 0 },
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              lastSeen: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
          unsubscribePlayer = ref.onSnapshot(s => {
            if (s.exists) {
              window.__cloudPlayer = s.data();
              renderState();
            }
          });
        } else {
          mode = "guest";
          window.__cloudPlayer = null;
        }
        updateAuthUI();
      });
    } catch (err) {
      console.error(err);
      toast("Cloud setup error — Guest Mode is still available.");
    }
  }

  async function signIn(email, password) {
    if (!firebaseReady) throw new Error("Cloud accounts are not configured yet. See README.md.");
    await auth.signInWithEmailAndPassword(email, password);
  }

  async function signUp(name, email, password) {
    if (!firebaseReady) throw new Error("Cloud accounts are not configured yet. See README.md.");
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    await db.collection("users").doc(cred.user.uid).set({
      displayName: name,
      email,
      coins: STARTING_COINS,
      stats: { plays: 0, totalWon: 0, biggestWin: 0 },
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function loadAdminPlayers() {
    if (!isAdmin || !db) return;
    $("#playerList").innerHTML = `<div class="player-row">Loading players…</div>`;
    try {
      const snap = await db.collection("users").limit(100).get();
      adminPlayers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      $("#adminPlayerCount").textContent = adminPlayers.length;
      renderAdminPlayers();
    } catch (err) {
      $("#playerList").innerHTML = `<div class="player-row">Could not load players. Check Firestore rules.</div>`;
      console.error(err);
    }
  }

  function renderAdminPlayers() {
    if (!isAdmin) return;
    const term = $("#playerSearch").value.trim().toLowerCase();
    const list = adminPlayers.filter(p =>
      !term ||
      String(p.displayName || "").toLowerCase().includes(term) ||
      String(p.email || "").toLowerCase().includes(term)
    );
    $("#playerList").innerHTML = "";

    if (!list.length) {
      $("#playerList").innerHTML = `<div class="player-row">No players found.</div>`;
      return;
    }

    list.forEach(p => {
      const row = document.createElement("div");
      row.className = "player-row";
      row.innerHTML = `
        <div class="player-main">
          <div class="player-name">
            <strong>${escapeHtml(p.displayName || "Player")}</strong>
            <small>${escapeHtml(p.email || p.id)}</small>
          </div>
          <div class="player-coins">🪙 ${fmt(p.coins)}</div>
        </div>
        <div class="adjust-row">
          <input type="number" min="1" step="1" value="100" aria-label="Coin amount">
          <button class="add-btn">+ Add</button>
          <button class="remove-btn">− Remove</button>
        </div>
      `;
      const input = $("input", row);
      $(".add-btn", row).addEventListener("click", () => adminAdjust(p.id, Math.abs(Number(input.value) || 0)));
      $(".remove-btn", row).addEventListener("click", () => adminAdjust(p.id, -Math.abs(Number(input.value) || 0)));
      $("#playerList").appendChild(row);
    });
  }

  async function adminAdjust(uid, delta) {
    if (!isAdmin || !db || !delta) return;
    try {
      const ref = db.collection("users").doc(uid);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Player not found.");
        const oldCoins = Number(snap.data().coins) || 0;
        tx.update(ref, {
          coins: Math.max(0, Math.floor(oldCoins + delta)),
          lastAdminAdjustment: delta,
          lastAdminAdjustmentAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      toast(`${delta > 0 ? "Added" : "Removed"} ${fmt(Math.abs(delta))} coins.`);
      await loadAdminPlayers();
    } catch (err) {
      console.error(err);
      toast("Admin change failed. Check your rules/admin email.");
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function openAccount() {
    $("#accountModal").classList.remove("hidden");
  }
  function closeAccount() {
    $("#accountModal").classList.add("hidden");
  }

  // Navigation
  $$("[data-open]").forEach(btn => btn.addEventListener("click", () => showScreen(btn.dataset.open)));
  $$("[data-back]").forEach(btn => btn.addEventListener("click", () => showScreen("home")));
  $$("[data-nav]").forEach(btn => btn.addEventListener("click", () => {
    if (btn.dataset.nav === "admin" && !isAdmin) return;
    showScreen(btn.dataset.nav);
    if (btn.dataset.nav === "admin") loadAdminPlayers();
  }));

  // Slot
  $$(".bet-btn").forEach(btn => btn.addEventListener("click", () => {
    slotBet = Number(btn.dataset.bet);
    $$(".bet-btn").forEach(x => x.classList.toggle("active", x === btn));
    $("#spinCost").textContent = `${slotBet} COINS`;
  }));
  $("#spinBtn").addEventListener("click", spinSlot);
  $("#paytableBtn").addEventListener("click", () => $("#paytableModal").classList.remove("hidden"));
  $("[data-close-paytable]").addEventListener("click", () => $("#paytableModal").classList.add("hidden"));

  // Pull tabs
  resetTicket();
  $("#buyTicketBtn").addEventListener("click", async () => {
    resetTicket();
    await buyTicket();
  });

  // Account modal
  $("#accountBtn").addEventListener("click", openAccount);
  $("[data-close-modal]").addEventListener("click", closeAccount);
  $("#guestBtn").addEventListener("click", () => {
    mode = "guest";
    closeAccount();
    renderState();
    toast("Guest Mode active on this device.");
  });

  $$(".auth-tab").forEach(tab => tab.addEventListener("click", () => {
    $$(".auth-tab").forEach(x => x.classList.toggle("active", x === tab));
    $("#signInForm").classList.toggle("hidden", tab.dataset.authTab !== "signin");
    $("#signUpForm").classList.toggle("hidden", tab.dataset.authTab !== "signup");
    $("#authMessage").textContent = "";
  }));

  $("#signInForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("#authMessage").textContent = "Signing in…";
    try {
      await signIn($("#signInEmail").value.trim(), $("#signInPassword").value);
      $("#authMessage").textContent = "";
      closeAccount();
      toast("Signed in.");
    } catch (err) {
      $("#authMessage").textContent = err.message;
    }
  });

  $("#signUpForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("#authMessage").textContent = "Creating account…";
    try {
      await signUp($("#signUpName").value.trim(), $("#signUpEmail").value.trim(), $("#signUpPassword").value);
      $("#authMessage").textContent = "";
      closeAccount();
      toast("Account created with 1,000 coins!");
    } catch (err) {
      $("#authMessage").textContent = err.message;
    }
  });

  $("#signOutBtn").addEventListener("click", async () => {
    if (auth) await auth.signOut();
    closeAccount();
    toast("Signed out. Guest Mode restored.");
  });

  $("#openAdminBtn").addEventListener("click", () => {
    if (!isAdmin) return;
    closeAccount();
    showScreen("admin");
    loadAdminPlayers();
  });

  $("#refreshPlayersBtn").addEventListener("click", loadAdminPlayers);
  $("#playerSearch").addEventListener("input", renderAdminPlayers);

  $("#accountModal").addEventListener("click", e => {
    if (e.target === $("#accountModal")) closeAccount();
  });
  $("#paytableModal").addEventListener("click", e => {
    if (e.target === $("#paytableModal")) $("#paytableModal").classList.add("hidden");
  });

  // Boot
  renderState();
  initFirebase();
})();