import { db } from "../../shared/firebase-config.js";
import { 
    doc, 
    getDoc, 
    collection, 
    addDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Vnitřní stav hry
let gameInterval = null;
let startTime = 0;
let elapsedTime = 0;
let flippedCards = [];
let lockBoard = false;
let matchedPairs = 0;
let totalClicks = 0;
let requireEmail = false;

// Výchozí zástupné obrázky (lze později v adminu nahrazovat skrze pexesoSettings)
const DEFAULT_CARD_BACK = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&q=80"; // Elegantní abstraktní rub
const DEFAULT_CARD_FRONTS = [
    "🍎", "🍌", "🍒", "🍇", "🍊", "🍉", "🍓", "🍍", "🥑", "🥝" // 10 vestavěných dvojic pro okamžitý start
];

export async function init(eventId) {
    const gameZone = document.getElementById("gameZone");
    if (!gameZone) return;

    // 1. NAČTENÍ KONFIGURACE Z ADMINU (E-mail a obrázky)
    try {
        const eventSnap = await getDoc(doc(db, "events", eventId));
        if (eventSnap.exists()) {
            const eventData = eventSnap.data();
            if (eventData.pexesoSettings) {
                requireEmail = eventData.pexesoSettings.requireEmail === true;
            }
        }
    } catch (e) {
        console.error("Chyba načítání pexeso konfigurace:", e);
    }

    // 2. RENDER FÁZE 1: REGISTRACE / ÚVODNÍ OBRAZOVKA
    renderRegistrationScreen(gameZone, eventId);
}

// --- 👤 FÁZE 1: REGISTRAČNÍ FORMULÁŘ ---
function renderRegistrationScreen(container, eventId) {
    container.innerHTML = `
        <div class="pexeso-setup" style="box-sizing:border-box; width:100%; max-width:400px; margin:0 auto; padding:20px; font-family:sans-serif; text-align:center;">
            <h2 style="color:#fff; margin-bottom:5px; font-size:1.6rem;">🧩 Digitální Pexeso</h2>
            <p style="color:#94a3b8; font-size:0.85rem; margin-bottom:25px;">Srovnej všech 10 dvojic v co nejkratším čase!</p>
            
            <div style="text-align:left; margin-bottom:15px;">
                <label style="display:block; color:#38bdf8; font-size:0.75rem; font-weight:700; letter-spacing:1px; margin-bottom:6px; text-transform:uppercase;">Tvoje přezdívka</label>
                <input type="text" id="pexesoUser" placeholder="Zadej jméno..." maxlength="15" style="box-sizing:border-box; width:100%; padding:14px; background:#0f172a; border:2px solid #334155; color:#fff; border-radius:10px; font-size:1rem; font-weight:600; outline:none;">
            </div>

            <div id="pexesoEmailWrapper" style="text-align:left; margin-bottom:25px; display: ${requireEmail ? 'block' : 'none'};">
                <label style="display:block; color:#ec4899; font-size:0.75rem; font-weight:700; letter-spacing:1px; margin-bottom:6px; text-transform:uppercase;">Tvůj E-mail (pro výhru)</label>
                <input type="email" id="pexesoEmail" placeholder="jmeno@email.cz" style="box-sizing:border-box; width:100%; padding:14px; background:#0f172a; border:2px solid #334155; color:#fff; border-radius:10px; font-size:1rem; font-weight:600; outline:none;">
            </div>

            <button id="btnStartPexeso" style="box-sizing:border-box; width:100%; padding:16px; background:linear-gradient(to right, #38bdf8, #ec4899); color:#fff; border:none; border-radius:12px; font-weight:800; font-size:1.1rem; cursor:pointer; box-shadow:0 10px 20px rgba(56,189,248,0.2); text-transform:uppercase; letter-spacing:1px;">
                Spustit hru 🚀
            </button>
            <div id="pexesoError" style="color:#ef4444; font-size:0.85rem; margin-top:12px; font-weight:600; min-height:18px;"></div>
        </div>
    `;

    document.getElementById("btnStartPexeso").addEventListener("click", async () => {
        const userEl = document.getElementById("pexesoUser");
        const emailEl = document.getElementById("pexesoEmail");
        const errorEl = document.getElementById("pexesoError");
        const btn = document.getElementById("btnStartPexeso");

        const username = userEl.value.trim();
        const email = emailEl ? emailEl.value.trim() : "";

        if (!username) {
            errorEl.textContent = "⚠️ Vyplň svoji přezdívku!";
            userEl.style.borderColor = "#ef4444";
            return;
        }

        if (requireEmail && !validateEmail(email)) {
            errorEl.textContent = "⚠️ Zadej platnou e-mailovou adresu!";
            if (emailEl) emailEl.style.borderColor = "#ef4444";
            return;
        }

        // 🔥 NOVÝ PRELOADER: Vynutíme stažení obrázků před startem
        btn.disabled = true;
        btn.textContent = "⏳ Stahuji karty (0/11)...";
        errorEl.style.color = "#38bdf8";
        errorEl.textContent = "Pleskám balíček dohromady, vydrž vteřinku...";

        try {
            // 1. Stáhneme si aktuální URL adresy z Firebase
            const eventSnap = await getDoc(doc(db, "events", eventId));
            let urlsToLoad = [];
            if (eventSnap.exists() && eventSnap.data().pexesoSettings) {
                const settings = eventSnap.data().pexesoSettings;
                if (settings.backOfCardUrl) urlsToLoad.push(settings.backOfCardUrl);
                if (settings.frontImages) urlsToLoad.push(...settings.frontImages.filter(Boolean));
            }

            // 2. Proženeme pole přes asynchronní preloader obrázků
            let loadedCount = 0;
            const preloadPromises = urlsToLoad.map(url => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.src = url;
                    img.onload = () => {
                        loadedCount++;
                        btn.textContent = `⏳ Stahuji karty (${loadedCount}/${urlsToLoad.length})...`;
                        resolve();
                    };
                    img.onerror = () => resolve(); // Pokud nějaký obrázek selže, neblokujeme celou hru
                });
            });

            await Promise.all(preloadPromises);
            
        } catch (e) {
            console.error("Preload selhal, startuji nouzově:", e);
        }

        // Vše staženo a nacachováno v paměti -> hra se vykreslí instantně s načtenými fotkami!
        startPexesoGame(container, eventId, username, email);
    });
}

// --- 🎮 FÁZE 2: SAMOTNÁ HRA (MŘÍŽKA 4x5) ---
async function startPexesoGame(container, eventId, username, email) {
    elapsedTime = 0;
    matchedPairs = 0;
    totalClicks = 0;
    flippedCards = [];
    lockBoard = false;

    // Výchozí hodnoty
    let cardBack = DEFAULT_CARD_BACK;
    let cardFronts = [...DEFAULT_CARD_FRONTS];

    // 🔥 TADY JE TA ZMĚNA: Vytáhneme ostrá data z Firebase
    try {
        const eventSnap = await getDoc(doc(db, "events", eventId));
        if (eventSnap.exists()) {
            const eventData = eventSnap.data();
            if (eventData.pexesoSettings) {
                if (eventData.pexesoSettings.backOfCardUrl) cardBack = eventData.pexesoSettings.backOfCardUrl;
                // Pokud admin nahrál všech 10 vlastních obrázků, použijeme je
                if (eventData.pexesoSettings.frontImages && eventData.pexesoSettings.frontImages.filter(Boolean).length === 10) {
                    cardFronts = eventData.pexesoSettings.frontImages;
                }
            }
        }
    } catch (e) { console.error(e); }

    // Vytvoření balíčku 20 karet z našich pročištěných obrázků
    let deck = [...cardFronts, ...cardFronts];
    deck.sort(() => Math.random() - 0.5);

    // Vygenerování herního layoutu (Výměna DEFAULT_CARD_BACK za dynamický cardBack a líc za obrázek)
    container.innerHTML = `
        <div style="box-sizing:border-box; width:100%; max-width:440px; margin:0 auto; padding:10px; font-family:sans-serif; height:calc(100vh - 80px); display:flex; flex-direction:column; justify-content:space-between;">
            
            <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:10px 16px; border-radius:12px; border:1px solid #1e293b;">
                <div style="color:#94a3b8; font-size:0.8rem; font-weight:600;">Hráč: <span style="color:#fff;">${username}</span></div>
                <div style="color:#38bdf8; font-family:monospace; font-size:1.1rem; font-weight:800;" id="pexesoTimer">00:00.00</div>
            </div>

            <div id="pexesoGrid" style="display:grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(5, 1fr); gap:8px; width:100%; aspect-ratio:4/5; margin:15px 0;">
                ${deck.map((value, index) => {
                    // Kontrola, zda je hodnota emoji nebo URL odkaz na obrázek
                    const isUrl = value.startsWith("http");
                    const cardContent = isUrl ? `<img src="${value}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;">` : value;

                    return `
                    <div class="pexeso-card" data-card-value="${value}" data-index="${index}" style="position:relative; width:100%; height:100%; cursor:pointer; transform-style:preserve-3d; transition:transform 0.4s ease; border-radius:8px; transform: rotateY(0deg);">
                        
                        <div style="position:absolute; inset:0; background:url('${cardBack}') center/cover, #1e293b; border:2px solid #334155; border-radius:8px; backface-visibility:hidden; z-index:2;"></div>
                        
                        <div style="position:absolute; inset:0; background:#0f172a; border:2px solid #38bdf8; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.8rem; backface-visibility:hidden; transform:rotateY(180deg); z-index:1; overflow:hidden;">
                            ${cardContent}
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>

            <div style="text-align:center; color:#64748b; font-size:0.7rem; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Najdi všechny stejné symboly</div>
        </div>
    `;

    // Nastartování stopek na setiny sekundy
    startTime = Date.now();
    gameInterval = setInterval(() => {
        elapsedTime = (Date.now() - startTime) / 1000;
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = Math.floor(elapsedTime % 60);
        const milliseconds = Math.floor((elapsedTime % 1) * 100);
        
        const timerEl = document.getElementById("pexesoTimer");
        if (timerEl) {
            timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
        }
    }, 40);

    // Připojení event listenerů na klikání karet
    document.querySelectorAll(".pexeso-card").forEach(card => {
        card.addEventListener("click", () => handleCardClick(card, container, eventId, username, email));
    });
}

// LOGIKA KLIKNUTÍ KARTY
function handleCardClick(card, container, eventId, username, email) {
    if (lockBoard || card.classList.contains("flipped") || card.classList.contains("matched")) return;

    totalClicks++;
    
    // 3D rotace pomocí CSS transformace
    card.style.transform = "rotateY(180deg)";
    card.classList.add("flipped");
    flippedCards.push(card);

    if (flippedCards.length === 2) {
        lockBoard = true;
        const [card1, card2] = flippedCards;

        if (card1.dataset.cardValue === card2.dataset.cardValue) {
            // SHODA!
            card1.classList.add("matched");
            card2.classList.add("matched");
            flippedCards = [];
            lockBoard = false;
            matchedPairs++;

            // Kontrola konce hry (všech 10 dvojic nalezeno)
            if (matchedPairs === 10) {
                clearInterval(gameInterval);
                finishPexesoGame(container, eventId, username, email);
            }
        } else {
            // NESHODA -> Otočit zpět za 0.8 vteřiny
            setTimeout(() => {
                card1.style.transform = "rotateY(0deg)";
                card2.style.transform = "rotateY(0deg)";
                card1.classList.remove("flipped");
                card2.classList.remove("flipped");
                flippedCards = [];
                lockBoard = false;
            }, 800);
        }
    }
}

// --- 🎉 FÁZE 3: KONEC HRY A ULOŽENÍ DO FIREBASE ---
async function finishPexesoGame(container, eventId, username, email) {
    container.innerHTML = `
        <div style="text-align:center; padding:30px 20px; font-family:sans-serif; color:#fff; max-width:400px; margin:0 auto;">
            <h1 style="font-size:3rem; margin:0; animation: bounce 1s infinite;">🎉</h1>
            <h2 style="color:#10b981; margin:10px 0 5px 0; font-size:1.6rem;">Dokončeno!</h2>
            <p style="color:#94a3b8; font-size:0.85rem; margin-bottom:25px;">Skvělý výkon, tvůj čas byl odeslán.</p>
            
            <div style="background:#0f172a; border:1px solid #1e293b; border-radius:14px; padding:20px; margin-bottom:25px; box-shadow:0 4px 15px rgba(0,0,0,0.3);">
                <div style="font-size:0.75rem; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px;">Výsledný čas</div>
                <div style="font-size:2.2rem; font-weight:900; color:#38bdf8; font-family:monospace; margin-bottom:12px;">${elapsedTime.toFixed(2)}s</div>
                <div style="font-size:0.75rem; color:#94a3b8;">Počet kliknutí: <strong style="color:#fff;">${totalClicks}x</strong></div>
            </div>

            <p style="font-size:0.8rem; color:#64748b; margin-bottom:20px; line-height:1.4;">Koukni se na velkou LED stěnu v hale, zda jsi překonal ostatní v TOP 20!</p>

            <button id="btnPlayPexesoAgain" style="box-sizing:border-box; width:100%; padding:14px; background:#1e293b; color:#fff; border:1px solid #334155; border-radius:10px; font-weight:700; font-size:0.95rem; cursor:pointer; transition:all 0.2s;">
                🔄 Hrát znovu a zkusit lepší čas
            </button>
        </div>
    `;

    // ZÁPIS SKÓRE DO SAMOSTATNÉ PODKOLEKCE EVENTU VE FIREBASE
    try {
        await addDoc(collection(db, "events", eventId, "pexeso_leaderboard"), {
            user: username,
            email: email || null,
            time: parseFloat(elapsedTime.toFixed(2)),
            clicks: totalClicks,
            createdAt: serverTimestamp()
        });
        console.log("🏆 Skóre turnaje pexesa úspěšně zapsáno do Firebase.");
    } catch (e) {
        console.error("Chyba při zápisu skóre:", e);
    }

    document.getElementById("btnPlayPexesoAgain").addEventListener("click", () => {
        init(eventId); // Spustí modul od začátku (zpět na registraci)
    });
}

// Pomocná regex kontrola formátu e-mailu
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}