import { db } from "../shared/firebase-config.js";
import { onSnapshot, query, orderBy, doc, collection } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const eventId = urlParams.get('event');

if (!eventId) {
    document.body.innerHTML = "<h1 style='color:white; text-align:center; padding-top:100px;'>❌ Chybí ID eventu v URL.</h1>";
} else {
    listenToPexesoConfig(eventId);
    initPexesoWallLeaderboard(eventId);
}

// --- 🌌 A) BRANDING PLÁTNA (POZADÍ A LOGO PARTNERA) ---
function listenToPexesoConfig(eventId) {
    onSnapshot(doc(db, "events", eventId), (docSnap) => {
        if (!docSnap.exists()) return;
        const config = docSnap.data();

        // 1. Obrázek nebo barva pozadí celého plátna
        if (config.bgUrl) {
            document.body.style.backgroundImage = `url('${config.bgUrl}')`;
            document.body.style.backgroundSize = "cover";
            document.body.style.backgroundPosition = "center";
            document.body.style.backgroundAttachment = "fixed";
        } else {
            document.body.style.backgroundImage = "none";
            document.body.style.backgroundColor = config.bgColor || "#05070f";
        }

        // 2. Čistá správa loga partnera ve spodním panelu (Vždy vycentrované, bez QR kódu)
        const logoZone = document.getElementById("wallLiveLogoContainer");
        const logoImg = document.getElementById("clientLogo");
        const wallCenterZone = document.getElementById("wallCenterZone");

        if (logoZone && logoImg && wallCenterZone) {
            // Zkontrolujeme, zda v pexesoSettings nebo v hlavním configu existuje klientské logo
            const partnerLogo = (config.pexesoSettings && config.pexesoSettings.partnerLogoUrl) || config.logoUrl || "";
            
            if (partnerLogo) { 
                logoImg.src = partnerLogo; 
                logoImg.style.display = "block"; 
                logoZone.style.display = "flex"; 
                
                // Stylování spodního obdélníku pro logo
                wallCenterZone.style.backgroundColor = config.centerBgColor || "#000000";
                wallCenterZone.style.border = "2px solid #1e293b";
                wallCenterZone.style.borderRadius = "12px";
                wallCenterZone.style.padding = "10px 40px";
            } else { 
                // Pokud žádné partnerovo logo nahrané není, panel zůstane neviditelný a čistý
                logoZone.style.display = "none"; 
                wallCenterZone.style.backgroundColor = "transparent";
                wallCenterZone.style.border = "none";
                wallCenterZone.style.padding = "0";
            }
        }
    });
}

// --- 🏆 B) REAL-TIME ŽEBŘÍČEK ---
function initPexesoWallLeaderboard(eventId) {
    const q = query(
        collection(db, "events", eventId, "pexeso_leaderboard"),
        orderBy("time", "asc")
    );

    let latestSnapshot = null;
    let isInitialLoad = true;

    onSnapshot(q, (snapshot) => {
        latestSnapshot = snapshot;
        if (isInitialLoad) {
            renderLeaderboardData(latestSnapshot);
            isInitialLoad = false;
        }
    });

    // Pravidelná 3vteřinová aktualizace zobrazení na obrazovce
    setInterval(() => {
        if (latestSnapshot) {
            renderLeaderboardData(latestSnapshot);
        }
    }, 3000);
}

// --- 🛠️ ROZDĚLENÝ RENDER DO DVOU SLOUPCŮ (TOP 1-5 VLEVO, TOP 6-10 VPRAVO) ---
function renderLeaderboardData(snapshot) {
    const leftContainer = document.getElementById("pexesoWallRowsLeft");
    const rightContainer = document.getElementById("pexesoWallRowsRight");
    
    if (!leftContainer || !rightContainer) return;

    leftContainer.innerHTML = "";
    rightContainer.innerHTML = "";
    let rank = 0;

    if (snapshot.empty) {
        leftContainer.innerHTML = `<div style="color: #475569; font-style: italic; text-align: left; padding: 60px 20px; font-size: 1.5rem; font-weight:600; text-transform:uppercase; letter-spacing:1px; line-height:1.5;">⚠️ Žebříček turnaje je prázdný.<br><span style="font-size:1.1rem; color:#334155; text-transform:none; font-style:normal;">Zatím nikdo nedokončil hru.</span></div>`;
        rightContainer.innerHTML = `<div style="color: #1e293b; font-style: italic; text-align: center; padding: 60px 20px; font-size: 4rem; font-weight:900;">🧩</div>`;
        return;
    }

    snapshot.forEach((docSnap) => {
        rank++;
        if (rank > 10) return; // Ukážeme striktně TOP 10 (5 vlevo, 5 vpravo)

        const data = docSnap.data();
        const row = document.createElement("div");
        row.style = `display: grid; grid-template-columns: 0.8fr 2.5fr 1.2fr 1.2fr; padding: 18px 20px; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.03); border-radius: 14px; align-items: center; font-size: 1.6rem; font-weight: 700; color: #fff; box-sizing: border-box; margin-bottom: 2px;`;

        // Medailové pozice pro nejlepší trojici turnaje
        let rankDisplay = `${rank}.`;
        if (rank === 1) {
            rankDisplay = "🥇 1.";
            row.style.background = "linear-gradient(to right, rgba(234, 179, 8, 0.18), rgba(234, 179, 8, 0.02))";
            row.style.borderColor = "rgba(234, 179, 8, 0.5)";
            row.style.boxShadow = "0 0 25px rgba(234, 179, 8, 0.12)";
        } else if (rank === 2) {
            rankDisplay = "🥈 2.";
            row.style.background = "linear-gradient(to right, rgba(148, 163, 184, 0.14), rgba(148, 163, 184, 0.02))";
            row.style.borderColor = "rgba(148, 163, 184, 0.4)";
        } else if (rank === 3) {
            rankDisplay = "🥉 3.";
            row.style.background = "linear-gradient(to right, rgba(180, 83, 9, 0.14), rgba(180, 83, 9, 0.02))";
            row.style.borderColor = "rgba(180, 83, 9, 0.4)";
        }

        row.innerHTML = `
            <div style="color: ${rank <= 3 ? 'inherit' : '#64748b'}; font-size: ${rank <= 3 ? '1.7rem' : '1.6rem'};">${rankDisplay}</div>
            <div style="color: ${rank === 1 ? '#f59e0b' : '#fff'}; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 15px;">${data.user}</div>
            <div style="text-align: right; color: #38bdf8; font-family: monospace; font-size: 1.8rem; font-weight: 900;">${data.time.toFixed(2)}s</div>
            <div style="text-align: right; color: #94a3b8; font-family: monospace;">${data.clicks || "---"}x</div>
        `;

        // Distribuce řádků: 1-5 vlevo, 6-10 vpravo
        if (rank <= 5) {
            leftContainer.appendChild(row);
        } else {
            rightContainer.appendChild(row);
        }
    });
}