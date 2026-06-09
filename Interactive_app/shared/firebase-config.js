// Import Firebase modulů přímo z webu (CDN verze pro prohlížeče)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Tvoje konfigurace z Firebase
const firebaseConfig = {
  apiKey: "AIzaSyARY62mr4ZPDOYeMNlwJbnllgHnQGYhD2U",
  authDomain: "interactiveapp-684cc.firebaseapp.com",
  projectId: "interactiveapp-684cc",
  storageBucket: "interactiveapp-684cc.firebasestorage.app",
  messagingSenderId: "601093158965",
  appId: "1:601093158965:web:7b289a80f1903748d8597c",
  measurementId: "G-W83BB8E0F3"
};

// Inicializace Firebase aplikace
const app = initializeApp(firebaseConfig);

// Inicializace konkrétních služeb a jejich export pro ostatní soubory
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);