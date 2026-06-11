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

// --- 🌌 A) BRANDING NOVÉHO PLÁTNA ---
function listenToPexesoConfig(eventId) {
    onSnapshot(doc(db, "events", eventId), (docSnap) => {
        if (!docSnap.exists()) return;
        const config = docSnap.data();

        // 1. Obrázek nebo barva pozadí
        if (config.bgUrl) {
            document.body.style.backgroundImage = `url('${config.bgUrl}')`;
            document.body.style.backgroundSize = "cover";
            document.body.style.backgroundPosition = "center";
            document.body.style.backgroundAttachment = "fixed";
        } else {
            document.body.style.backgroundImage = "none";
            document.body.style.backgroundColor = config.bgColor || "#05070f";
        }

        // 2. Nadpisy žebříčku z adminu
        if (document.getElementById("pexesoWallTitle")) {
            document.getElementById("pexesoWallTitle").textContent = config.wallTitle || "🏆 TURNAJ V PEXESU";
        }
        if (document.getElementById("pexesoWallSubtitle")) {
            document.getElementById("pexesoWallSubtitle").textContent = config.subtitleText || "Naskenujte QR kód a překonejte nejlepší čas!";
        }

        // 3. Středový panel (Logo & QR kód) v patičce pexesa
        const qrZone = document.getElementById("wallLiveQr");
        const logoZone = document.getElementById("wallLiveLogoContainer");
        const logoImg = document.getElementById("clientLogo");
        const wallCenterZone = document.getElementById("wallCenterZone");
        const showQr = config.showWallQr !== false;

        if (qrZone && logoZone && logoImg && wallCenterZone) {
            const hasLogo = !!config.logoUrl;
            if (hasLogo) { 
                logoImg.src = config.logoUrl; 
                logoImg.style.display = "block"; 
                logoZone.style.display = "flex"; 
            } else { 
                logoZone.style.display = "none"; 
            }

            if (config.qrPosition !== "qr-none" && showQr) {
                qrZone.style.display = "flex";
                if (qrZone.innerHTML === "") {
                    // Cesta ukazuje správně do složky public pro registrace diváků
                    const currentUrl = window.location.origin;
                    qrZone.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(currentUrl + '/public/index.html?event=' + eventId)}" alt="QR" style="max-height: 90px;">`;
                }
            } else { qrZone.style.display = "none"; }

            // Zarovnání prvků v patičce
            if (!hasLogo || config.qrPosition === "qr-none" || !showQr) {
                wallCenterZone.style.justifyContent = "center";
            } else {
                wallCenterZone.style.justifyContent = "space-between";
                if (config.logoPosition === "pos-left" || config.qrPosition === "qr-right") { 
                    logoZone.style.order = "1"; qrZone.style.order = "2"; 
                } else { 
                    logoZone.style.order = "2"; qrZone.style.order = "1"; 
                }
            }

            // Podbarvení panelu
            if (config.showCenterBg !== false) {
                wallCenterZone.style.backgroundColor = config.centerBgColor || "#000000";
                wallCenterZone.style.border = "2px solid #1e293b";
                wallCenterZone.style.borderRadius = "12px";
                wallCenterZone.style.padding = "10px 20px";
            } else {
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

    onSnapshot(q, (snapshot) => {
        const rowsContainer = document.getElementById("pexesoWallRows");
        if (!rowsContainer) return;

        rowsContainer.innerHTML = "";
        let rank = 0;

        if (snapshot.empty) {
            rowsContainer.innerHTML = `<div style="color: #475569; font-style: italic; text-align: center; padding: 100px; font-size: 1.8rem; font-weight:600; text-transform:uppercase; letter-spacing:1px;">⚠️ Žebříček je prázdný.<br><span style="font-size:1.2rem; color:#334155; text-transform:none; font-style:normal;">Buďte první, kdo naskenuje QR kód a zapíše svůj čas!</span></div>`;
            return;
        }

        snapshot.forEach((docSnap) => {
            rank++;
            if (rank > 12) return; // Vykreslíme TOP 12 pro obří čitelnost

            const data = docSnap.data();
            const row = document.createElement("div");
            row.style = `display: grid; grid-template-columns: 0.8fr 2.5fr 1.2fr 1.2fr; padding: 14px 20px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.03); border-radius: 12px; align-items: center; font-size: 1.4rem; font-weight: 700; color: #fff; box-sizing: border-box; margin-bottom: 4px;`;

            let rankDisplay = `${rank}.`;
            if (rank === 1) {
                rankDisplay = "🥇 1.";
                row.style.background = "linear-gradient(to right, rgba(234, 179, 8, 0.15), rgba(234, 179, 8, 0.02))";
                row.style.borderColor = "rgba(234, 179, 8, 0.4)";
                row.style.boxShadow = "0 0 20px rgba(234, 179, 8, 0.1)";
            } else if (rank === 2) {
                rankDisplay = "🥈 2.";
                row.style.background = "linear-gradient(to right, rgba(148, 163, 184, 0.12), rgba(148, 163, 184, 0.02))";
                row.style.borderColor = "rgba(148, 163, 184, 0.3)";
            } else if (rank === 3) {
                rankDisplay = "🥉 3.";
                row.style.background = "linear-gradient(to right, rgba(180, 83, 9, 0.12), rgba(180, 83, 9, 0.02))";
                row.style.borderColor = "rgba(180, 83, 9, 0.3)";
            }

            row.innerHTML = `
                <div style="color: ${rank <= 3 ? 'inherit' : '#64748b'}; font-size: ${rank <= 3 ? '1.5rem' : '1.4rem'};">${rankDisplay}</div>
                <div style="color: ${rank === 1 ? '#f59e0b' : '#fff'}; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 15px;">${data.user}</div>
                <div style="text-align: right; color: #38bdf8; font-family: monospace; font-size: 1.6rem; font-weight: 900;">${data.time.toFixed(2)}s</div>
                <div style="text-align: right; color: #94a3b8; font-family: monospace;">${data.clicks || "---"}x</div>
            `;
            rowsContainer.appendChild(row);
        });
    });
}