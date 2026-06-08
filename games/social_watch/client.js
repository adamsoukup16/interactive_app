import { db, storage } from "../../shared/firebase-config.js";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

let videoStream = null;
let currentFacingMode = "environment"; 
let lastUploadTime = 0; 

// SVG IKONKY (Čistý kód místo smajlíků nebo obrázků)
const icons = {
    flip: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path d="m16 19 2 2 2-2M8 5 6 3 4 5"/></svg>`,
    gallery: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`
};

export async function init(eventId) {
    const gameZone = document.getElementById("gameZone");
    const body = document.body;
    
    // 🏢 1. NAČTENÍ DYNAMICKÝCH BRANDING DAT Z FIREBASE
    let clientLogoUrl = "";
    try {
        const eventSnap = await getDoc(doc(db, "events", eventId));
        if (eventSnap.exists()) {
            const eventData = eventSnap.data();
            
            // 🔥 BRANDING POZADÍ: Pokud existuje URL pozadí, nastavíme ho jako backgroundImage
            const bgUrl = eventData.backgroundUrl || eventData.eventBackground || "";
            if (bgUrl) {
                body.style.backgroundImage = `url('${bgUrl}')`;
                body.style.backgroundSize = "cover";
                body.style.backgroundPosition = "center";
                body.style.backgroundAttachment = "fixed"; // Pro luxusní parallax efekt
            }

            // BRANDING LOGO
            clientLogoUrl = eventData.logoUrl || eventData.eventLogo || "";
        }
    } catch (e) {
        console.error("Nepodařilo se načíst branding z Firebase:", e);
    }

    const totalSent = localStorage.getItem(`sent_photos_${eventId}`) || 0;

    // Vygenerujeme rozhraní
    gameZone.innerHTML = `
        <div class="app-interface animate-fade" style="max-width: 420px; margin: 0 auto; padding: 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc; display: flex; flex-direction: column; min-height: 80vh; justify-content: space-between;">
            
            <div class="info-panel" style="text-align: center; margin-bottom: 15px;">
                <span style="font-size: 0.65rem; color: #38bdf8; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; display: block; margin-bottom: 6px;">Live multimediální přenos</span>
                <p style="font-size: 0.85rem; color: #94a3b8; margin: 0; font-weight: 400; line-height: 1.4;">Snímek se po schválení zobrazí na LED stěně.</p>
            </div>

            <div class="identity-zone" style="margin-bottom: 20px;">
                <div style="position: relative; width: 100%; max-width: 320px; margin: 0 auto;">
                    <label for="userName" style="display: block; font-size: 0.65rem; color: #38bdf8; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; margin-bottom: 6px; margin-left: 4px;">Přezdívka autora (povinné)</label>
                    <input type="text" id="userName" placeholder="např. JanNovak" maxlength="20" 
                        style="width: 100%; padding: 14px 16px; background: rgba(15, 23, 42, 0.8); backdrop-filter: blur(4px); border: 1px solid #1e293b; color: #fff; border-radius: 12px; text-align: left; font-size: 0.95rem; font-weight: 500; outline: none; transition: all 0.3s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
                </div>
            </div>

            <div class="camera-module" style="position: relative; width: 320px; height: 320px; margin: 0 auto 25px auto;">
                <div class="camera-viewport" style="position: relative; width: 100%; height: 100%; border-radius: 24px; overflow: hidden; background: #020617; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
                    <video id="webcamVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
                    <div id="cameraFlashOverlay" style="position: absolute; inset: 0; background: #ffffff; opacity: 0; pointer-events: none; transition: opacity 0.05s ease-out; z-index: 5;"></div>
                    
                    <div id="cameraPlaceholder" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #64748b; font-size: 0.8rem; background: #020617; z-index: 4;">
                        <div style="width: 24px; height: 24px; border: 2px solid #334155; border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px;"></div>
                        Inicializace optiky
                    </div>
                </div>

                <div class="viewport-controls" style="position: absolute; bottom: 15px; right: 15px; display: flex; gap: 12px; z-index: 10;">
                    
                    <button id="btnFlipCamera" class="camera-control-btn" title="Otočit kameru" style="background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 2px solid #38bdf8; color: #38bdf8; width: 56px; height: 56px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.4); transition: transform 0.2s;">
                        ${icons.flip}
                    </button>
                    
                    <button id="btnOpenGallery" class="camera-control-btn" title="Nahrát z galerie" style="background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 2px solid #ffffff; color: #ffffff; width: 56px; height: 56px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.4); transition: transform 0.2s;">
                        ${icons.gallery}
                    </button>
                </div>
                
                <input type="file" id="galleryInput" accept="image/*" style="display: none;">

                <div style="position: absolute; top: 20px; left: 20px; width: 16px; height: 16px; border-top: 2px solid rgba(255, 255, 255, 0.2); border-left: 2px solid rgba(255, 255, 255, 0.2); border-top-left-radius: 4px; pointer-events: none; z-index: 6;"></div>
                <div style="position: absolute; top: 20px; right: 20px; width: 16px; height: 16px; border-top: 2px solid rgba(255, 255, 255, 0.2); border-right: 2px solid rgba(255, 255, 255, 0.2); border-top-right-radius: 4px; pointer-events: none; z-index: 6;"></div>
            </div>
            
            <div class="control-zone" style="text-align: center; margin-bottom: 15px; display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%;">
                <button id="btnCapturePhoto" class="btn-shutter" style="background: #ffffff; color: #020617; border: none; padding: 16px 36px; border-radius: 14px; font-weight: 700; font-size: 0.95rem; cursor: pointer; letter-spacing: 0.5px; transition: all 0.2s ease; width: 100%; max-width: 320px; box-shadow: 0 10px 15px -3px rgba(255,255,255,0.1); text-transform: uppercase;">
                    Odeslat momentku
                </button>
                
                <div id="uploadStatus" class="status-msg" style="font-size: 0.8rem; font-weight: 600; letter-spacing: 0.3px; min-height: 18px;"></div>
                
                <div id="userPhotoCounter" style="font-size: 0.75rem; color: #94a3b8; font-weight: 500; margin-top: 4px; display: ${totalSent > 0 ? 'block' : 'none'};">
                    Dnes úspěšně odesláno: <span id="countValue" style="color: #38bdf8; font-weight: 700;">${totalSent}</span> fotografií.
                </div>
            </div>
            
            <div id="dynamicPartnerFooter" style="text-align: center; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 15px; margin-top: auto; display: ${clientLogoUrl ? 'block' : 'none'};">
                <span style="font-size: 0.55rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.5px; display: block; margin-bottom: 8px; opacity: 0.8;">Partner živého vysílání</span>
                <img src="${clientLogoUrl}" alt="Partner Logo" style="height: 32px; max-width: 180px; object-fit: contain;">
            </div>

            <canvas id="cropCanvas" style="display:none;"></canvas>
        </div>
    `;

    // CSS injection
    if (!document.getElementById("camera-dynamic-styles")) {
        const style = document.createElement("style");
        style.id = "camera-dynamic-styles";
        style.innerHTML = `
            @keyframes spin { to { transform: rotate(360deg); } }
            .btn-shutter:active { transform: scale(0.96); background: #f1f5f9; }
            .camera-control-btn:active { transform: scale(0.90); background: rgba(15, 23, 42, 1.0) !important; }
            #userName:focus { border-color: #38bdf8 !important; background: rgba(15, 23, 42, 1.0) !important; }
            .input-error { border-color: #ef4444 !important; animation: shake 0.3s ease-in-out; background: #7f1d1d20 !important; }
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-6px); }
                75% { transform: translateX(6px); }
            }
        `;
        document.head.appendChild(style);
    }

    startLiveCamera();

    // Listenery
    document.getElementById("btnCapturePhoto").addEventListener("click", () => {
        captureAndUpload(eventId, 'camera');
    });

    document.getElementById("btnFlipCamera").addEventListener("click", () => {
        flipCamera();
    });

    // 🔥 NOVÉ: Otevření galerie
    document.getElementById("btnOpenGallery").addEventListener("click", () => {
        document.getElementById("galleryInput").click();
    });

    // Zpracování souboru z galerie
    document.getElementById("galleryInput").addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            captureAndUpload(eventId, 'gallery', e.target.files[0]);
        }
    });

    checkSavedCooldown();
}

// --- 🎥 CAMERA ENGINE ---
async function startLiveCamera() {
    const video = document.getElementById("webcamVideo");
    const placeholder = document.getElementById("cameraPlaceholder");
    if (!video) return;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }
    try {
        if (placeholder) placeholder.style.display = "flex";
        const constraints = { video: { facingMode: currentFacingMode, width: { ideal: 1080 }, height: { ideal: 1080 } }, audio: false };
        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = videoStream;
        video.onloadedmetadata = () => {
            if (placeholder) placeholder.style.display = "none";
            video.style.transform = currentFacingMode === "user" ? "scaleX(-1)" : "scaleX(1)";
        };
    } catch (err) {
        console.error(err);
        if (placeholder) placeholder.innerHTML = "<span style='color:#ef4444;'>Fotoaparát nelze inicializovat</span>";
    }
}

function flipCamera() {
    currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
    startLiveCamera();
}

function playShutterSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(140, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {}
}

// --- ⏱️ COOLDOWN LOGIKA ---
function startCooldown(secondsLeft) {
    const btn = document.getElementById("btnCapturePhoto");
    if (!btn) return;
    btn.disabled = true;
    btn.style.background = "#334155";
    btn.style.color = "#64748b";
    btn.style.cursor = "not-allowed";
    const interval = setInterval(() => {
        secondsLeft--;
        btn.textContent = `Další foto za ${secondsLeft}s...`;
        if (secondsLeft <= 0) {
            clearInterval(interval);
            btn.disabled = false;
            btn.style.background = "#ffffff"; btn.style.color = "#020617"; btn.style.cursor = "pointer";
            btn.textContent = "Odeslat momentku";
        }
    }, 1000);
}

function checkSavedCooldown() {
    const savedLock = localStorage.getItem("last_upload_timestamp");
    if (savedLock) {
        const diff = Math.floor((Date.now() - parseInt(savedLock)) / 1000);
        if (diff < 60) startCooldown(60 - diff);
    }
}

// --- 📸 3. FINÁLNÍ UNIVERZÁLNÍ ZPRACOVÁNÍ (KAMERA NEBO GALERIE) ---
async function captureAndUpload(eventId, source, fileFromGallery = null) {
    const video = document.getElementById("webcamVideo");
    const canvas = document.getElementById("cropCanvas");
    const nameInput = document.getElementById("userName");
    const statusDiv = document.getElementById("uploadStatus");
    const flash = document.getElementById("cameraFlashOverlay");

    if (!canvas || !nameInput) return;
    const userName = nameInput.value.trim();

    if (!userName) {
        nameInput.classList.add("input-error");
        statusDiv.textContent = "⚠️ Vyplňte prosím nejdříve svou přezdívku.";
        statusDiv.style.color = "#ef4444";
        setTimeout(() => nameInput.classList.remove("input-error"), 500);
        return;
    }

    if (Date.now() - lastUploadTime < 60000) return;

    statusDiv.textContent = "Zpracování digitálního otisku...";
    statusDiv.style.color = "#38bdf8";
    
    const ctx = canvas.getContext("2d");
    canvas.width = 500;
    canvas.height = 500;

    // 🔥 NOVÉ: Logika podle zdroje (Live Kamera nebo Galerie file)
    if (source === 'camera') {
        if (!video || !videoStream) return;
        playShutterSound();
        if (flash) { flash.style.opacity = "1"; setTimeout(() => flash.style.opacity = "0", 60); }
        
        const size = Math.min(video.videoWidth, video.videoHeight);
        const sourceX = (video.videoWidth - size) / 2;
        const sourceY = (video.videoHeight - size) / 2;
        ctx.save();
        if (currentFacingMode === "user") { ctx.translate(500, 0); ctx.scale(-1, 1); }
        ctx.drawImage(video, sourceX, sourceY, size, size, 0, 0, 500, 500);
        ctx.restore();
        performUpload(canvas, eventId, userName, source);
    
    } else if (source === 'gallery' && fileFromGallery) {
        // Zpracování fotky z galerie
        const img = new Image();
        img.src = URL.createObjectURL(fileFromGallery);
        img.onload = () => {
            const size = Math.min(img.width, img.height);
            const sourceX = (img.width - size) / 2;
            const sourceY = (img.height - size) / 2;
            ctx.drawImage(img, sourceX, sourceY, size, size, 0, 0, 500, 500);
            URL.revokeObjectURL(img.src);
            performUpload(canvas, eventId, userName, source);
        };
    }
}

// Pomocná funkce pro samotný upload do Firebase (aby se kód neopakoval)
async function performUpload(canvas, eventId, userName, source) {
    const statusDiv = document.getElementById("uploadStatus");
    const counterZone = document.getElementById("userPhotoCounter");
    
    canvas.toBlob(async (blob) => {
        try {
            statusDiv.textContent = "Zápis dat do cloudu...";
            const uniqueFileName = `photos/${eventId}/${Date.now()}_${source}_500x500.jpg`;
            const storageRef = ref(storage, uniqueFileName);

            const snapshot = await uploadBytes(storageRef, blob);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(db, "events", eventId, "social_wall"), {
                imageUrl: downloadURL,
                user: userName,
                approved: false,
                status: "pending",
                createdAt: serverTimestamp(),
                source: source // Uložíme si, zda to bylo z kamery nebo galerie
            });

            // Zámek a historie
            lastUploadTime = Date.now();
            localStorage.setItem("last_upload_timestamp", lastUploadTime.toString());
            startCooldown(60);

            let totalSent = parseInt(localStorage.getItem(`sent_photos_${eventId}`) || 0);
            totalSent++;
            localStorage.setItem(`sent_photos_${eventId}`, totalSent.toString());
            
            const counterText = document.getElementById("countValue");
            if (counterText) counterText.textContent = totalSent;
            if (counterZone) counterZone.style.display = "block"; // Rozsvítíme počítadlo po první fotce

            statusDiv.textContent = "✓ Snímek byl úspěšně odeslán moderátorovi";
            statusDiv.style.color = "#10b981";

            // Reset galerie inputu pro další použití
            const galleryInput = document.getElementById("galleryInput");
            if (galleryInput) galleryInput.value = "";

        } catch (error) {
            console.error(error);
            statusDiv.textContent = "Chyba sítě. Zkuste to znovu.";
            statusDiv.style.color = "#ef4444";
        }
    }, "image/jpeg", 0.85);
}