/* Initializes Firebase and exposes it on window.RouteIQFirebase so the rest of the app's
   plain (non-module) scripts can use it without becoming ES modules themselves. Fires
   "firebase-ready" once set up, since this module script's execution timing relative to
   other deferred scripts isn't guaranteed - listen for the event rather than assuming
   window.RouteIQFirebase already exists. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    collection,
    doc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
    projectId: "ewrouteiq",
    appId: "1:59647765517:web:c6953e9d5a2dc96235f944",
    storageBucket: "ewrouteiq.firebasestorage.app",
    apiKey: "AIzaSyBSa8rvsiYQPGWtiIq3fFF4Y1RyUHPLW5c",
    authDomain: "ewrouteiq.firebaseapp.com",
    messagingSenderId: "59647765517",
    measurementId: "G-Q5MWD91YGV"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// persistentMultipleTabManager: this app already opens several forms as tabs in one
// browser session (see tabs.js), so offline persistence needs to tolerate that instead
// of locking to a single tab.
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

window.RouteIQFirebase = {
    app, auth, db,
    onAuthStateChanged, signInWithEmailAndPassword, signOut,
    collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
    query, where, orderBy, onSnapshot, serverTimestamp
};

document.dispatchEvent(new CustomEvent("firebase-ready"));
