import { db } from "../../shared/firebase-config.js";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Vnitřní stav hry
let gameInterval = null; let startTime = 0; let elapsedTime = 0; let flippedCards = []; let lockBoard = false; let matchedPairs = 0; let totalClicks = 0;

// Výchozí nastavení obsahu
let requireEmail = false; let requirePhone = false; let requireSeat = false; let requireGdpr = false; let gdprText = "";
let introTitle = "🧩 Digitální Pexeso"; let introSubtitle = "Srovnej všech 10 dvojic v co nejkratším čase!"; let outroText = "Sleduj plátno v hale v TOP 20!"; let btnStartText = "Spustit hru 🚀";
let labelUser = "Tvoje přezdívka *"; let labelEmail = "Tvůj E-mail *"; let labelPhone = "Telefonní číslo *";
let seatLabel1 = "Sektor"; let seatLabel2 = "Řada"; let seatLabel3 = "Místo";

// Výchozí branding & barvy
let partnerLogoUrl = ""; let partnerMessage = ""; let partnerUrl = "";
let colorBg = "#020617"; let colorForm = "#0f172a"; let bgImageUrl = "";
let colorBtnStartBg = "#38bdf8"; let colorBtnStartText = "#ffffff";

let colorIntroTitle = "#ffffff"; let colorIntroSubtitle = "#94a3b8";
let colorLabelUser = "#ffffff"; let colorLabelEmail = "#ffffff"; let colorLabelPhone = "#ffffff";
let colorSeatLabels = "#ffffff"; let colorOutroText = "#e2e8f0"; colorGdprText = "#38bdf8";

const DEFAULT_CARD_BACK = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&q=80";
const DEFAULT_CARD_FRONTS = ["🍎", "🍌", "🍒", "🍇", "🍊", "🍉", "🍓", "🍍", "🥑", "🥝"];

export async function init(eventId) {
    const gameZone = document.getElementById("gameZone"); if (!gameZone) return;

    // Pomocná funkce pro hardwarový preloading obrázků do cache prohlížeče
    const preloadImage = (url) => {
        return new Promise((resolve) => {
            if (!url || !url.startsWith("http")) return resolve();
            const img = new Image();
            img.src = url;
            img.onload = () => resolve();
            img.onerror = () => resolve(); // Pokud by odkaz selhal, nezasekneme hru
        });
    };

    let cardBack = DEFAULT_CARD_BACK; 
    let cardFronts = [...DEFAULT_CARD_FRONTS];

    // 1. STAŽENÍ KOMPLETNÍ KONFIGURACE A BAREV Z FIRESTORE
    try {
        const eventSnap = await getDoc(doc(db, "events", eventId));
        if (eventSnap.exists() && eventSnap.data().pexesoSettings) {
            const s = eventSnap.data().pexesoSettings;
            requireEmail = s.requireEmail === true; requirePhone = s.requirePhone === true; requireSeat = s.requireSeat === true;
            requireGdpr = s.requireGdpr === true; gdprText = s.gdprText || "";
            
            introTitle = s.introTitle || "🧩 Digitální Pexeso"; introSubtitle = s.introSubtitle || "Srovnej všech 10 dvojic v co nejkratším čase!";
            outroText = s.outroText || "Sleduj plátno v hale v TOP 20!"; btnStartText = s.btnStartText || "Spustit hru 🚀";
            labelUser = s.labelUser || "Tvoje přezdívka *"; labelEmail = s.labelEmail || "Tvůj E-mail *"; labelPhone = s.labelPhone || "Telefonní číslo *";
            seatLabel1 = s.seatLabel1 || "Sektor"; seatLabel2 = s.seatLabel2 || "Řada"; seatLabel3 = s.seatLabel3 || "Místo";
            partnerLogoUrl = s.partnerLogoUrl || ""; partnerMessage = s.partnerMessage || ""; partnerUrl = s.partnerUrl || "";
            
            colorBg = s.colorBg || "#020617"; colorForm = s.colorForm || "#0f172a"; bgImageUrl = s.bgImageUrl || "";
            colorBtnStartBg = s.colorBtnStartBg || "#38bdf8"; colorBtnStartText = s.colorBtnStartText || "#ffffff";

            colorIntroTitle = s.colorIntroTitle || "#ffffff"; colorIntroSubtitle = s.colorIntroSubtitle || "#94a3b8";
            colorLabelUser = s.colorLabelUser || "#ffffff"; colorLabelEmail = s.colorLabelEmail || "#ffffff"; colorLabelPhone = s.colorLabelPhone || "#ffffff";
            colorSeatLabels = s.colorSeatLabels || "#ffffff"; colorOutroText = s.colorOutroText || "#e2e8f0"; colorGdprText = s.colorGdprText || "#38bdf8";

            if (s.backOfCardUrl) cardBack = s.backOfCardUrl;
            if (s.frontImages && s.frontImages.filter(Boolean).length === 10) cardFronts = s.frontImages;
        }
    } catch (e) { console.error(e); }

    // Aktualizujeme stav v preloaderu z public.js
    const tEl = document.getElementById("preloaderText");
    const pEl = document.getElementById("preloaderPercent");
    if (tEl) tEl.textContent = "Optimalizuji a stahuji hrací balíček karet...";
    if (pEl) pEl.textContent = "85%";

    // 🔥 NOVÉ: AGRESIVNÍ PRELOAD ABSOLUTNĚ VŠECH OBRÁZKŮ DO CACHE TELEFONU (Pozadí + Rub + 10 Líců)
    const imagesToPreload = [preloadImage(bgImageUrl), preloadImage(cardBack), preloadImage(partnerLogoUrl)];
    cardFronts.forEach(url => {
        if (url && url.startsWith("http")) imagesToPreload.push(preloadImage(url));
    });
    
    // Počkáme, až se stáhnou úplně všechny obrázky, aby se už nic pomalu nenačítalo
    await Promise.all(imagesToPreload);

    if (pEl) pEl.textContent = "99%";

    // Základní nastavení herní zóny (Vše transparentní, podřízené novému fixnímu pozadí)
    gameZone.style.setProperty("background-color", "transparent", "important");
    gameZone.style.setProperty("background-image", "none", "important");
    gameZone.style.setProperty("min-height", "100vh", "important");
    gameZone.style.setProperty("width", "100%", "important");
    gameZone.style.setProperty("margin", "0", "important");
    gameZone.style.setProperty("padding", "20px 10px", "important");
    gameZone.style.setProperty("box-sizing", "border-box", "important");
    gameZone.style.setProperty("display", "flex", "important");
    gameZone.style.setProperty("flex-direction", "column", "important");
    gameZone.style.setProperty("justify-content", "center", "important");
    gameZone.style.setProperty("align-items", "center", "important");
    gameZone.style.setProperty("position", "relative", "important");
    gameZone.style.setProperty("z-index", "1", "important");

    // 🔥 REVOLUČNÍ FIX POZADÍ: Vytvoříme speciální podkladový div, který Safari nedeformuje
    let bgLayer = document.getElementById("pexesoMobileBgLayer");
    if (!bgLayer) {
        bgLayer = document.createElement("div");
        bgLayer.id = "pexesoMobileBgLayer";
        document.body.appendChild(bgLayer);
    }
    bgLayer.style = `
        position: fixed !important;
        inset: 0 !important;
        z-index: 0 !important;
        background-color: ${colorBg} !important;
        background-image: ${bgImageUrl ? `url('${bgImageUrl}')` : 'none'} !important;
        background-size: cover !important;
        background-position: center !important;
        background-repeat: no-repeat !important;
        pointer-events: none !important;
    `;

    renderRegistrationScreen(gameZone, eventId, cardBack, cardFronts);
}

// --- 👤 FÁZE 1: REGISTRAČNÍ FORMULÁŘ ---
function renderRegistrationScreen(container, eventId, cardBack, cardFronts) {
    container.innerHTML = `
        <div class="pexeso-setup" style="box-sizing:border-box; width:100%; max-width:400px; margin:0 auto; padding:10px; font-family:sans-serif; text-align:center;">
            
            ${partnerLogoUrl ? `
                <div style="text-align:center; margin-bottom:20px; cursor:${partnerUrl ? 'pointer' : 'default'};" ${partnerUrl ? `onclick="window.open('${partnerUrl}', '_blank')"` : ''}>
                    <img src="${partnerLogoUrl}" style="max-height:75px; object-fit:contain; max-width:200px;">
                </div>
            ` : ''}

            <h2 style="color:${colorIntroTitle}; margin:0 0 6px 0; font-size:1.8rem; font-weight:900; text-transform:uppercase; letter-spacing:0.5px;">${introTitle}</h2>
            <p style="color:${colorIntroSubtitle}; font-size:0.85rem; margin:0 0 20px 0; line-height:1.4; font-weight:600;">${introSubtitle}</p>
            
            <div style="background:${colorForm}; padding:22px; border-radius:16px; border:1px solid rgba(255,255,255,0.08); text-align:left; display:flex; flex-direction:column; gap:14px; box-shadow:0 12px 30px rgba(0,0,0,0.4); box-sizing:border-box;">
                
                <div>
                    <label style="display:block; color:${colorLabelUser}; font-size:0.75rem; font-weight:700; margin-bottom:5px; text-transform:uppercase;">${labelUser}</label>
                    <input type="text" id="pexesoUser" style="box-sizing:border-box; width:100%; padding:12px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.15); color:#fff; border-radius:8px; font-size:1rem; font-weight:600; outline:none;">
                </div>

                <div id="pexesoEmailWrapper" style="display: ${requireEmail ? 'block' : 'none'};">
                    <label style="display:block; color:${colorLabelEmail}; font-size:0.75rem; font-weight:700; margin-bottom:5px; text-transform:uppercase;">${labelEmail}</label>
                    <input type="email" id="pexesoEmail" placeholder="jmeno@email.cz" style="box-sizing:border-box; width:100%; padding:12px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.15); color:#fff; border-radius:8px; font-size:1rem; outline:none;">
                </div>

                <div id="pexesoPhoneWrapper" style="display: ${requirePhone ? 'block' : 'none'};">
                    <label style="display:block; color:${colorLabelPhone}; font-size:0.75rem; font-weight:700; margin-bottom:5px; text-transform:uppercase;">${labelPhone}</label>
                    <input type="tel" id="pexesoPhone" placeholder="+420..." style="box-sizing:border-box; width:100%; padding:12px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.15); color:#fff; border-radius:8px; font-size:1rem; outline:none;">
                </div>

                <div id="pexesoSeatWrapper" style="display: ${requireSeat ? 'block' : 'none'};">
                    <label style="display:block; color:${colorSeatLabels}; font-size:0.75rem; font-weight:700; margin-bottom:5px; text-transform:uppercase;">💺 Usazení</label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="pexesoSector" placeholder="${seatLabel1}" style="width:33%; box-sizing:border-box; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.15); padding:10px; border-radius:8px; color:#fff; font-size:0.9rem; text-align:center;">
                        <input type="text" id="pexesoRow" placeholder="${seatLabel2}" style="width:33%; box-sizing:border-box; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.15); padding:10px; border-radius:8px; color:#fff; font-size:0.9rem; text-align:center;">
                        <input type="text" id="pexesoSeat" placeholder="${seatLabel3}" style="width:33%; box-sizing:border-box; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.15); padding:10px; border-radius:8px; color:#fff; font-size:0.9rem; text-align:center;">
                    </div>
                </div>

                <div id="pexesoGdprWrapper" style="display: ${requireGdpr ? 'block' : 'none'}; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); box-sizing:border-box;">
                    <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; font-size:0.8rem; color:#fff; line-height:1.4;">
                        <input type="checkbox" id="pexesoGdpr" style="width:18px; height:18px; margin-top:2px; cursor:pointer; flex-shrink:0;">
                        <span style="opacity:0.9;">Souhlasím se zpracováním osobních údajů.</span>
                    </label>
                    <div style="margin-top:8px; font-size:0.75rem; color:${colorGdprText}; text-decoration:underline; cursor:pointer; font-weight:700;" id="btnShowGdprPopup">📄 Zobrazit podmínky</div>
                </div>

                <button id="btnStartPexeso" style="box-sizing:border-box; width:100%; padding:14px; background:${colorBtnStartBg}; border:1px solid rgba(255,255,255,0.2); color:${colorBtnStartText}; border-radius:10px; font-weight:900; font-size:1.1rem; cursor:pointer; text-transform:uppercase; letter-spacing:1px; box-shadow:0 6px 20px rgba(0,0,0,0.2);">
                    ${btnStartText}
                </button>
                <div id="pexesoError" style="color:#ef4444; font-size:0.8rem; text-align:center; font-weight:600; min-height:18px;"></div>
            </div>
        </div>
    `;

    if (gdprText) document.getElementById("btnShowGdprPopup").addEventListener("click", () => alert(`⚖️ GDPR / PODMÍNKY:\n\n${gdprText}`));

    document.getElementById("btnStartPexeso").addEventListener("click", async () => {
        const userEl = document.getElementById("pexesoUser"); const emailEl = document.getElementById("pexesoEmail"); const phoneEl = document.getElementById("pexesoPhone");
        const sectorEl = document.getElementById("pexesoSector"); const rowEl = document.getElementById("pexesoRow"); const seatEl = document.getElementById("pexesoSeat");
        const gdprEl = document.getElementById("pexesoGdpr"); const errorEl = document.getElementById("pexesoError"); const btn = document.getElementById("btnStartPexeso");

        const username = userEl.value.trim(); const email = emailEl ? emailEl.value.trim() : ""; const phone = phoneEl ? phoneEl.value.trim() : "";
        const sector = sectorEl ? sectorEl.value.trim() : ""; const row = rowEl ? rowEl.value.trim() : ""; const seat = seatEl ? seatEl.value.trim() : "";

        if (!username) { errorEl.textContent = "⚠️ Vyplňte jméno!"; return; }
        if (requireEmail && !validateEmail(email)) { errorEl.textContent = "⚠️ Neplatný e-mail!"; return; }
        if (requirePhone && phone.length < 9) { errorEl.textContent = "⚠️ Neplatný telefon!"; return; }
        if (requireSeat && (!sector || !row || !seat)) { errorEl.textContent = "⚠️ Vyplňte usazení!"; return; }
        if (requireGdpr && gdprEl && !gdprEl.checked) { errorEl.textContent = "⚠️ Potvrďte souhlas s podmínkami!"; return; }

        btn.disabled = true; btn.textContent = "...";
        startPexesoGame(container, eventId, { username, email, phone, sector, row, seat }, cardBack, cardFronts);
    });
}

// --- 🎮 FÁZE 2: SAMOTNÁ HRA ---
function startPexesoGame(container, eventId, extraData, cardBack, cardFronts) {
    elapsedTime = 0; matchedPairs = 0; totalClicks = 0; flippedCards = []; lockBoard = false;

    let deck = [...cardFronts, ...cardFronts]; deck.sort(() => Math.random() - 0.5);

    container.innerHTML = `
        <div style="box-sizing:border-box; width:100%; max-width:440px; margin:0 auto; padding:4px; font-family:sans-serif; height:calc(100vh - 40px); display:flex; flex-direction:column; justify-content:space-between; color:#fff;">
            
            <div style="display:flex; justify-content:space-between; align-items:center; background:${colorForm}; padding:10px 16px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
                <div style="color:#fff; font-size:0.85rem; font-weight:700;">${extraData.username}</div>
                <div style="display:flex; gap:15px; align-items:center;">
                    <div style="color:#fff; opacity:0.8; font-size:0.8rem;">Otočení: <span style="color:#ec4899; font-weight:900;" id="liveClicksCount">0</span></div>
                    <div style="color:#38bdf8; font-family:monospace; font-size:1.1rem; font-weight:900;" id="pexesoTimer">00:00.00</div>
                </div>
            </div>

            <div id="pexesoGrid" style="display:grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(5, 1fr); gap:6px; width:100%; aspect-ratio:4/5; margin:10px 0;">
                ${deck.map((value, index) => {
                    const isUrl = value.startsWith("http");
                    const cardContent = isUrl ? `<img src="${value}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;">` : value;
                    return `
                    <div class="pexeso-card" data-card-value="${value}" data-index="${index}" style="position:relative; width:100%; height:100%; cursor:pointer; transform-style:preserve-3d; transition:transform 0.3s ease; border-radius:8px;">
                        <div style="position:absolute; inset:0; background:url('${cardBack}') center/cover; border:1px solid rgba(255,255,255,0.15); border-radius:8px; backface-visibility:hidden; z-index:2;"></div>
                        <div style="position:absolute; inset:0; background:${colorForm}; border:2px solid #38bdf8; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.8rem; backface-visibility:hidden; transform:rotateY(180deg); z-index:1; overflow:hidden;">
                            ${cardContent}
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>

            <div class="pexeso-partner-banner" style="background:${colorForm}; border:1px solid rgba(255,255,255,0.1); padding:12px 14px; border-radius:12px; display:flex; align-items:center; gap:12px; min-height:60px; box-sizing:border-box;">
                ${partnerLogoUrl ? `<div style="width:45px; height:48px; background:rgba(0,0,0,0.3); border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; cursor:pointer;" onclick="window.open('${partnerUrl}', '_blank')"><img src="${partnerLogoUrl}" style="max-width:100%; max-height:100%; object-fit:contain;"></div>` : ''}
                <div style="flex-grow:1;"><div style="font-size:0.85rem; color:#fff; font-weight:600; line-height:1.4;">${partnerMessage || "Najdi všechny stejné dvojice!"}</div></div>
            </div>
        </div>
    `;

    startTime = Date.now();
    gameInterval = setInterval(() => {
        elapsedTime = (Date.now() - startTime) / 1000;
        const minutes = Math.floor(elapsedTime / 60); const seconds = Math.floor(elapsedTime % 60); const milliseconds = Math.floor((elapsedTime % 1) * 100);
        const timerEl = document.getElementById("pexesoTimer"); if (timerEl) timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    }, 40);

    document.querySelectorAll(".pexeso-card").forEach(card => card.addEventListener("click", () => handleCardClick(card, container, eventId, extraData, cardBack, cardFronts)));
}

function handleCardClick(card, container, eventId, extraData, cardBack, cardFronts) {
    if (lockBoard || card.classList.contains("flipped") || card.classList.contains("matched")) return;
    totalClicks++; const liveClicksEl = document.getElementById("liveClicksCount"); if (liveClicksEl) liveClicksEl.textContent = totalClicks;

    card.style.transform = "rotateY(180deg)"; card.classList.add("flipped"); flippedCards.push(card);

    if (flippedCards.length === 2) {
        lockBoard = true; const [card1, card2] = flippedCards;
        if (card1.dataset.cardValue === card2.dataset.cardValue) {
            card1.classList.add("matched"); card2.classList.add("matched"); flippedCards = []; lockBoard = false; matchedPairs++;
            if (matchedPairs === 10) { clearInterval(gameInterval); finishPexesoGame(container, eventId, extraData); }
        } else {
            setTimeout(() => { card1.style.transform = "rotateY(0deg)"; card2.style.transform = "rotateY(0deg)"; card1.classList.remove("flipped"); card2.classList.remove("flipped"); flippedCards = []; lockBoard = false; }, 800);
        }
    }
}

// --- 🎉 FÁZE 3: ZÁVĚREČNÁ OBRAZOVKA ---
async function finishPexesoGame(container, eventId, extraData) {
    container.innerHTML = `
        <div style="text-align:center; padding:30px 20px; font-family:sans-serif; max-width:400px; margin:0 auto;">
            
            ${partnerLogoUrl ? `
                <div style="text-align:center; margin-bottom:20px; cursor:${partnerUrl ? 'pointer' : 'default'};" ${partnerUrl ? `onclick="window.open('${partnerUrl}', '_blank')"` : ''}>
                    <img src="${partnerLogoUrl}" style="max-height:75px; object-fit:contain; max-width:200px;">
                </div>
            ` : '<h1>🏆</h1>'}

            <h2 style="color:#10b981; margin:10px 0 5px 0; font-size:1.8rem; font-weight:900; text-transform:uppercase;">Done!</h2>
            <p style="color:#fff; opacity:0.7; font-size:0.85rem; margin-bottom:20px;">Tvůj výsledek se ukládá do cloudu...</p>
            
            <div style="background:${colorForm}; border:1px solid rgba(255,255,255,0.1); border-radius:14px; padding:20px; margin-bottom:20px; box-shadow:0 4px 15px rgba(0,0,0,0.3);">
                <div style="font-size:2.4rem; font-weight:900; color:#38bdf8; font-family:monospace; margin-bottom:8px;">${elapsedTime.toFixed(2)}s</div>
                <div style="font-size:0.8rem; color:#fff; opacity:0.8;">Otočení karet: <strong>${totalClicks}x</strong></div>
            </div>

            <p style="font-size:0.95rem; color:${colorOutroText}; margin-bottom:25px; line-height:1.4; font-weight:600;">
                ${outroText}
            </p>

            <button id="btnPlayPexesoAgain" style="box-sizing:border-box; width:100%; padding:14px; background:${colorBtnStartBg}; border:1px solid rgba(255,255,255,0.2); color:${colorBtnStartText}; border-radius:10px; font-weight:700; font-size:0.95rem; cursor:pointer; text-transform:uppercase; letter-spacing:0.5px;">
                🔄 Play again
            </button>
        </div>
    `;

    try {
        await addDoc(collection(db, "events", eventId, "pexeso_leaderboard"), {
            user: extraData.username, email: extraData.email || "", phone: extraData.phone || "", sector: extraData.sector || "", row: extraData.row || "", seat: extraData.seat || "",
            time: parseFloat(elapsedTime.toFixed(2)), clicks: totalClicks, createdAt: serverTimestamp()
        });
    } catch (e) { console.error(e); }

    document.getElementById("btnPlayPexesoAgain").addEventListener("click", () => init(eventId));
}

function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }