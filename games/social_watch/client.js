import { db, storage } from "../../shared/firebase-config.js";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

let videoStream = null;
let currentFacingMode = "environment"; 
let lastUploadTime = 0; 

// Čisté, moderní, vysoce viditelné SVG ikony (žádné emoji, žádné externí obrázky)
const modernIcons = {
    flip: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
    gallery: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`
};

export async function init(eventId) {
    const gameZone = document.getElementById("gameZone");
    const body = document.body;
    
    // Vyčištění globálního body stylu pro fixní mobilní aplikaci
    body.style.margin = "0";
    body.style.padding = "0";
    body.style.overflow = "hidden";
    body.style.height = "100vh";
    body.style.backgroundColor = "#020617";

    let clientLogoUrl = "";
    try {
        const eventSnap = await getDoc(doc(db, "events", eventId));
        if (eventSnap.exists()) {
            const eventData = eventSnap.data();
            
            // DYNAMICKÉ POZADÍ Z ADMINU (Obrázek vs Barva)
            const bgUrl = eventData.backgroundUrl || eventData.eventBackground || "";
            if (bgUrl) {
                body.style.backgroundImage = `url('${bgUrl}')`;
                body.style.backgroundSize = "cover";
                body.style.backgroundPosition = "center";
                body.style.backgroundAttachment = "fixed";
            } else if (eventData.bgColor) {
                body.style.backgroundColor = eventData.bgColor;
                body.style.backgroundImage = "none";
            }

            clientLogoUrl = eventData.logoUrl || eventData.eventLogo || "";
        }
    } catch (e) {
        console.error("Chyba načítání branding dat:", e);
    }

    const totalSent = localStorage.getItem(`sent_photos_${eventId}`) || 0;

    // Generování ultra-moderního responzivního rozhraní zafixovaného na výšku obrazovky
    gameZone.innerHTML = `
        <div class="modern-app-container animate-fade" style="box-sizing: border-box; width: 100%; max-width: 440px; margin: 0 auto; height: calc(100vh - 70px); display: flex; flex-direction: column; justify-content: space-between; padding: 10px 20px 20px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            
            <div class="input-glow-zone" style="width: 100%; margin-top: 5px;">
                <label for="userName" style="display: block; font-size: 0.7rem; color: #38bdf8; text-transform: uppercase; letter-spacing: 2px; font-weight: 800; margin-bottom: 8px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">PŘEZDÍVKA SOUŤEŽÍCÍHO</label>
                <input type="text" id="userName" placeholder="Zadejte své jméno..." maxlength="20" 
                    style="box-sizing: border-box; width: 100%; padding: 16px; background: #0f172a; border: 2px solid #38bdf8; color: #ffffff; border-radius: 14px; font-size: 1.05rem; font-weight: 700; outline: none; transition: all 0.3s ease; box-shadow: 0 0 15px rgba(56, 189, 248, 0.15), inset 0 2px 4px rgba(0,0,0,0.4);">
            </div>

            <div class="camera-viewport-wrapper" style="position: relative; width: 100%; aspect-ratio: 1/1; max-width: 320px; margin: auto; border-radius: 28px; overflow: hidden; border: 2px solid rgba(255,255,255,0.1); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7);">
                <video id="webcamVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
                <div id="cameraFlashOverlay" style="position: absolute; inset: 0; background: #ffffff; opacity: 0; pointer-events: none; transition: opacity 0.05s ease-out; z-index: 5;"></div>
                
                <div id="cameraPlaceholder" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #64748b; font-size: 0.85rem; background: #0f172a; z-index: 4;">
                    <div style="width: 24px; height: 24px; border: 2px solid #334155; border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px;"></div>
                    Aktivace kamery
                </div>

                <div class="viewport-controls" style="position: absolute; bottom: 16px; right: 16px; display: flex; gap: 12px; z-index: 10;">
                    
                    <button id="btnFlipCamera" class="action-circle-btn" title="Otočit kameru" style="background: rgba(15, 23, 42, 0.8); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 2px solid #38bdf8; color: #38bdf8; width: 54px; height: 54px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.5); transition: transform 0.2s;">
                        ${modernIcons.flip}
                    </button>
                    
                    <button id="btnOpenGallery" class="action-circle-btn" title="Nahrát z galerie" style="background: rgba(15, 23, 42, 0.8); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 2px solid #ffffff; color: #ffffff; width: 54px; height: 54px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.5); transition: transform 0.2s;">
                        ${modernIcons.gallery}
                    </button>
                </div>
                <input type="file" id="galleryInput" accept="image/*" style="display: none;">
            </div>
            
            <div class="action-trigger-zone" style="text-align: center; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; margin: auto 0;">
                <button id="btnCapturePhoto" class="btn-shutter" style="background: #ffffff; color: #020617; border: none; padding: 18px 30px; border-radius: 16px; font-weight: 800; font-size: 1rem; cursor: pointer; letter-spacing: 0.5px; transition: all 0.2s ease; width: 100%; max-width: 340px; box-shadow: 0 10px 20px rgba(255,255,255,0.15); text-transform: uppercase;">
                    Odeslat momentku
                </button>
                
                <div id="uploadStatus" class="status-msg" style="font-size: 0.8rem; font-weight: 700; min-height: 16px; letter-spacing: 0.3px;"></div>
                
                <div id="userPhotoCounter" style="font-size: 0.75rem; color: #94a3b8; font-weight: 600; display: ${totalSent > 0 ? 'block' : 'none'};">
                    Odesláno: <span id="countValue" style="color: #38bdf8; font-weight: 800;">${totalSent}</span> fotek
                </div>
            </div>
            
            <div id="dynamicPartnerFooter" style="text-align: center; display: ${clientLogoUrl ? 'flex' : 'none'}; justify-content: center; align-items: center; width: 100%; height: 45px; margin-top: 5px;">
                <img src="${clientLogoUrl}" alt="Client Brand" style="height: 100%; max-height: 42px; max-width: 220px; object-fit: contain;">
            </div>

            <canvas id="cropCanvas" style="display:none;"></canvas>
        </div>
    `;

    // Vstřikování animací a aktivních stavů
    if (!document.getElementById("camera-dynamic-styles")) {
        const style = document.createElement("style");
        style.id = "camera-dynamic-styles";
        style.innerHTML = `
            @keyframes spin { to { transform: rotate(360deg); } }
            .btn-shutter:active { transform: scale(0.96); background: #f1f5f9; }
            .action-circle-btn:active { transform: scale(0.88); }
            #userName:focus { border-color: #38bdf8 !important; box-shadow: 0 0 20px rgba(56, 189, 248, 0.4) !important; background: #020617 !important; }
            .input-error { border-color: #ef4444 !important; animation: shake 0.3s ease-in-out; background: #7f1d1d30 !important; box-shadow: 0 0 15px #ef444450 !important; }
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-6px); }
                75% { transform: translateX(6px); }
            }
        `;
        document.head.appendChild(style);
    }

    startLiveCamera();

    // Připojení eventů
    document.getElementById("btnCapturePhoto").addEventListener("click", () => captureAndUpload(eventId, 'camera'));
    document.getElementById("btnFlipCamera").addEventListener("click", flipCamera);
    document.getElementById("btnOpenGallery").addEventListener("click", () => document.getElementById("galleryInput").click());
    document.getElementById("galleryInput").addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) captureAndUpload(eventId, 'gallery', e.target.files[0]);
    });

    checkSavedCooldown();
}

// --- 🎥 CAMERA CORE ENGINE ---
async function startLiveCamera() {
    const video = document.getElementById("webcamVideo");
    const placeholder = document.getElementById("cameraPlaceholder");
    if (!video) return;
    if (videoStream) videoStream.getTracks().forEach(track => track.stop());

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
        if (placeholder) placeholder.innerHTML = "<span style='color:#ef4444; font-weight:700;'>Kamera nedostupná</span>";
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
        osc.type = "triangle"; osc.frequency.setValueAtTime(140, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {}
}

// --- ⏱️ COOLDOWN FILTER ---
function startCooldown(secondsLeft) {
    const btn = document.getElementById("btnCapturePhoto");
    if (!btn) return;
    btn.disabled = true; btn.style.background = "#1e293b"; btn.style.color = "#64748b"; btn.style.cursor = "not-allowed"; btn.style.boxShadow = "none";
    const interval = setInterval(() => {
        secondsLeft--;
        btn.textContent = `DALŠÍ FOTO ZA ${secondsLeft}S`;
        if (secondsLeft <= 0) {
            clearInterval(interval);
            btn.disabled = false; btn.style.background = "#ffffff"; btn.style.color = "#020617"; btn.style.cursor = "pointer"; btn.style.boxShadow = "0 10px 20px rgba(255,255,255,0.15)";
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

// --- 📸 UPLOAD AND CONVERT CORE ---
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
        statusDiv.textContent = "⚠️ Zadejte nejprve svou přezdívku!";
        statusDiv.style.color = "#ef4444";
        setTimeout(() => nameInput.classList.remove("input-error"), 500);
        return;
    }

    if (Date.now() - lastUploadTime < 60000) return;

    statusDiv.textContent = "Optimalizace rozměrů...";
    statusDiv.style.color = "#38bdf8";
    
    const ctx = canvas.getContext("2d");
    canvas.width = 500; canvas.height = 500;

    if (source === 'camera') {
        if (!video || !videoStream) return;
        playShutterSound();
        if (flash) { flash.style.opacity = "1"; setTimeout(() => flash.style.opacity = "0", 60); }
        
        const size = Math.min(video.videoWidth, video.videoHeight);
        const sourceX = (video.videoWidth - size) / 2;
        const sourceY = (video.videoHeight - size) / 2;
        ctx.save();
        if (currentFacingMode === "user") { ctx.translate(500, 0); ctx.scale(-1, 1); }
        ctx.drawImage(video, sourceX, sourceY, size, size, 0, 0, 500, 500); ctx.restore();
        performUpload(canvas, eventId, userName, source);
    
    } else if (source === 'gallery' && fileFromGallery) {
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

async function performUpload(canvas, eventId, userName, source) {
    const statusDiv = document.getElementById("uploadStatus");
    const counterZone = document.getElementById("userPhotoCounter");
    
    canvas.toBlob(async (blob) => {
        try {
            statusDiv.textContent = "Odesílání...";
            const uniqueFileName = `photos/${eventId}/${Date.now()}_500x500.jpg`;
            const storageRef = ref(storage, uniqueFileName);

            const snapshot = await uploadBytes(storageRef, blob);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(db, "events", eventId, "social_wall"), {
                imageUrl: downloadURL,
                user: userName,
                approved: false,
                status: "pending",
                createdAt: serverTimestamp(),
                source: source
            });

            lastUploadTime = Date.now();
            localStorage.setItem("last_upload_timestamp", lastUploadTime.toString());
            startCooldown(60);

            let totalSent = parseInt(localStorage.getItem(`sent_photos_${eventId}`) || 0);
            totalSent++;
            localStorage.setItem(`sent_photos_${eventId}`, totalSent.toString());
            
            const counterText = document.getElementById("countValue");
            if (counterText) counterText.textContent = totalSent;
            if (counterZone) counterZone.style.display = "block";

            statusDiv.textContent = "✓ Odesláno ke schválení";
            statusDiv.style.color = "#10b981";

            const galleryInput = document.getElementById("galleryInput");
            if (galleryInput) galleryInput.value = "";

        } catch (error) {
            console.error(error);
            statusDiv.textContent = "Chyba sítě, zkuste to znovu.";
            statusDiv.style.color = "#ef4444";
        }
    }, "image/jpeg", 0.85);
}