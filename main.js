"use strict";
// =====================================================================
// USSD Phone Simulator
//
// Sections:
//   1. Types & config        – timeouts, accepted USSD codes, backend URL
//   2. Translations          – English / Kiswahili strings (one object each)
//   3. Language preference   – load, save, switch (web buttons or USSD menu)
//   4. Backend               – real endpoint or the mock below
//   5. Mock backend          – menu state machine, mirrors the real backend
//   6. Phone                 – screen, session, timers, user actions
//   7. Wiring                – DOM events and start-up
// =====================================================================
const PHONE_NUMBER = "+254700000000"; // simulated subscriber
const SESSION_TIMEOUT_MS = 10000; // how long a prompt waits for a reply
const NOTICE_MS = 5000; // how long error notices stay up
const MAX_INPUT = 30;
const NETWORK_DELAY_MS = 400; // fake latency for the mock
const DEFAULT_LANG = "en";
const LANG_STORAGE_KEY = "ussd-sim-lang";
/** Set to your endpoint (e.g. "http://localhost:8080/ussd") to use the real backend. */
const BACKEND_URL = null;
/** Every USSD code the phone accepts, and the service each one opens. */
const SERVICE_CODES = {
    "*144#": "banking",
    "*100#": "language",
};
const USSD_CODE_PATTERN = /^\*[\d*]+#$/;
const ENGLISH = {
    idle: "Dial a USSD code\neg *144#",
    running: "USSD code running...",
    invalidFormat: "Invalid USSD code",
    unknownCode: (code) => `Unknown USSD code:\n${code}`,
    timedOut: "Session timed out.\nPlease try again.",
    connectionError: "Connection problem\nor invalid MMI code",
    closeHint: "Press \u2716 to close",
    welcome: "Welcome",
    checkBalance: "Check balance",
    withdrawMoney: "Withdraw Money",
    language: "Language / Lugha",
    exit: "Exit",
    balanceIs: "Your balance is",
    cancel: "Cancel",
    back: "Back",
    withdrawMenu: "Withdraw Menu",
    myNumber: "My Number",
    otherNumber: "Other Number",
    enterRecipient: "Enter recipient number",
    enterAmount: "Enter Amount",
    withdrawnToSelf: (amount) => `You have withdrawn ${amount}\nto your number`,
    withdrawnToOther: (amount, to) => `You have withdrawn ${amount}\nto the number: ${to}`,
    chooseLanguage: "Choose language",
    languageSet: "Language set to English.",
    thankYou: "Thank you.",
    invalidPhone: "Invalid phone number.",
    invalidAmount: "Invalid amount.",
    invalidChoice: "Invalid choice.",
};
const KISWAHILI = {
    idle: "Piga msimbo wa USSD\nmfano *144#",
    running: "Msimbo wa USSD\nunatekelezwa...",
    invalidFormat: "Msimbo wa USSD si sahihi",
    unknownCode: (code) => `Msimbo wa USSD\nhautambuliki:\n${code}`,
    timedOut: "Muda umekwisha.\nTafadhali jaribu tena.",
    connectionError: "Tatizo la muunganisho\nau msimbo wa MMI si sahihi",
    closeHint: "Bonyeza \u2716 kufunga",
    welcome: "Karibu",
    checkBalance: "Angalia salio",
    withdrawMoney: "Toa pesa",
    language: "Lugha / Language",
    exit: "Ondoka",
    balanceIs: "Salio lako ni",
    cancel: "Ghairi",
    back: "Rudi",
    withdrawMenu: "Menyu ya Kutoa Pesa",
    myNumber: "Nambari yangu",
    otherNumber: "Nambari nyingine",
    enterRecipient: "Weka nambari ya mpokeaji",
    enterAmount: "Weka kiasi",
    withdrawnToSelf: (amount) => `Umetoa ${amount}\nkwenye nambari yako`,
    withdrawnToOther: (amount, to) => `Umetoa ${amount}\nkwenda nambari: ${to}`,
    chooseLanguage: "Chagua lugha",
    languageSet: "Lugha imebadilishwa\nkuwa Kiswahili.",
    thankYou: "Asante.",
    invalidPhone: "Nambari ya simu si sahihi.",
    invalidAmount: "Kiasi si sahihi.",
    invalidChoice: "Chaguo si sahihi.",
};
const STRINGS = { en: ENGLISH, sw: KISWAHILI };
// ---------- 3. Language preference ----------
let lang = loadLang();
function isLang(value) {
    return value === "en" || value === "sw";
}
function loadLang() {
    try {
        const saved = localStorage.getItem(LANG_STORAGE_KEY);
        return isLang(saved) ? saved : DEFAULT_LANG;
    }
    catch {
        return DEFAULT_LANG; // storage blocked (private mode, file:// in some browsers)
    }
}
function saveLang(value) {
    try {
        localStorage.setItem(LANG_STORAGE_KEY, value);
    }
    catch {
        // Preference just won't survive a reload.
    }
}
/** Current language's strings. */
function t() {
    return STRINGS[lang];
}
/** Single entry point for changing language, from the web buttons or the USSD menu. */
function setLanguage(value) {
    lang = value;
    saveLang(value);
    renderLanguage();
    if (phase === "idle")
        showMessage(t().idle);
}
// ---------- 4. Backend ----------
async function ussdRequest(session, language) {
    const text = session.answers.join("*");
    if (BACKEND_URL) {
        const res = await fetch(BACKEND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                sessionId: session.id,
                serviceCode: session.serviceCode,
                phoneNumber: PHONE_NUMBER,
                text,
                language,
            }),
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        return res.text();
    }
    await new Promise((resolve) => window.setTimeout(resolve, NETWORK_DELAY_MS));
    return mockBackend(session.serviceCode, text, language);
}
function parseResponse(raw) {
    const match = /^(CON|END)\s?/.exec(raw);
    if (!match)
        return { type: "END", message: raw };
    return {
        type: match[1] === "END" ? "END" : "CON",
        message: raw.slice(match[0].length),
    };
}
const BALANCE = 12500;
function formatKes(value) {
    return `KES ${value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function firstScreen(service) {
    return service === "language" ? { id: "language" } : { id: "main" };
}
function renderScreen(s, tr) {
    switch (s.id) {
        case "main":
            return `CON ${tr.welcome}\n1. ${tr.checkBalance}\n2. ${tr.withdrawMoney}\n3. ${tr.language}\n4. ${tr.exit}`;
        case "balance":
            return `CON ${tr.balanceIs}\n${formatKes(BALANCE)}\n\n1 ${tr.cancel}\n2 ${tr.back}`;
        case "withdraw":
            return `CON ${tr.withdrawMenu}\n1. ${tr.myNumber}\n2. ${tr.otherNumber}\n3. ${tr.exit}`;
        case "recipient":
            return `CON ${tr.enterRecipient}\n1 ${tr.exit}`;
        case "amount":
            return `CON ${tr.enterAmount}\n1 ${tr.exit}`;
        case "withdrawn":
            return `CON ${tr.withdrawnToSelf(s.amount)}\n\n1 ${tr.cancel}\n2 ${tr.back}`;
        case "language":
            return `CON ${tr.chooseLanguage}\n1. English\n2. Kiswahili\n3. ${tr.exit}`;
    }
}
/** Returns the next screen, or a final "END ..." string. */
function nextScreen(s, choice, tr) {
    const bye = `END ${tr.thankYou}`;
    switch (s.id) {
        case "main":
            if (choice === "1")
                return { id: "balance" };
            if (choice === "2")
                return { id: "withdraw" };
            if (choice === "3")
                return { id: "language" };
            if (choice === "4")
                return bye;
            break;
        case "balance":
        case "withdrawn":
            if (choice === "1")
                return bye;
            if (choice === "2")
                return { id: "main" };
            break;
        case "withdraw":
            if (choice === "1")
                return { id: "amount" };
            if (choice === "2")
                return { id: "recipient" };
            if (choice === "3")
                return bye;
            break;
        case "recipient":
            if (choice === "1")
                return bye;
            if (/^0[17]\d{8}$/.test(choice))
                return { id: "amount", to: choice };
            return `END ${tr.invalidPhone}`;
        case "amount": {
            if (choice === "1")
                return bye;
            const value = Number(choice);
            if (!Number.isInteger(value) || value <= 0)
                return `END ${tr.invalidAmount}`;
            const amount = formatKes(value);
            return s.to ? `END ${tr.withdrawnToOther(amount, s.to)}` : { id: "withdrawn", amount };
        }
        case "language":
            if (choice === "1" || choice === "2") {
                const chosen = choice === "1" ? "en" : "sw";
                // A real backend would store this against the phone number and send
                // the language back; the mock sets it on the page directly.
                setLanguage(chosen);
                return `END ${STRINGS[chosen].languageSet}`;
            }
            if (choice === "3")
                return bye;
            break;
    }
    return `END ${tr.invalidChoice}`;
}
function mockBackend(serviceCode, text, language) {
    const tr = STRINGS[language];
    const service = SERVICE_CODES[serviceCode];
    if (!service)
        return `END ${tr.unknownCode(serviceCode)}`;
    let screen = firstScreen(service);
    for (const choice of text ? text.split("*") : []) {
        const result = nextScreen(screen, choice, tr);
        if (typeof result === "string")
            return result;
        screen = result;
    }
    return renderScreen(screen, tr);
}
// ---------- 6. Phone ----------
function byId(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`Missing element #${id}`);
    return node;
}
const messageEl = byId("message");
const inputEl = byId("input");
const keypadEl = byId("keypad");
const callBtn = byId("callBtn");
const clearBtn = byId("clearBtn");
const endBtn = byId("endBtn");
const langButtons = document.querySelectorAll("[data-lang]");
let phase = "idle";
let session = null;
let input = "";
let promptTimer;
let noticeTimer;
// Rendering
function showMessage(message) {
    messageEl.textContent = message;
}
function renderInput() {
    inputEl.textContent = input;
}
function renderLanguage() {
    document.documentElement.lang = lang;
    langButtons.forEach((btn) => {
        btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
    });
}
// Timers
function clearTimers() {
    window.clearTimeout(promptTimer);
    window.clearTimeout(noticeTimer);
    promptTimer = undefined;
    noticeTimer = undefined;
}
// Screens
function resetInput() {
    input = "";
    renderInput();
}
/** Home screen. Ends any session. */
function goHome() {
    clearTimers();
    session = null;
    phase = "idle";
    resetInput();
    showMessage(t().idle);
}
/** A USSD menu waiting for a reply; cancelled if no reply within the timeout. */
function showPrompt(message) {
    clearTimers();
    phase = "prompt";
    showMessage(message);
    promptTimer = window.setTimeout(() => {
        showNotice(t().timedOut, NOTICE_MS);
    }, SESSION_TIMEOUT_MS);
}
/**
 * A one-off message that ends the session. Closed with Call or End;
 * with `autoCloseMs` it also returns home on its own.
 */
function showNotice(message, autoCloseMs) {
    clearTimers();
    session = null;
    phase = "notice";
    resetInput();
    showMessage(`${message}\n\n${t().closeHint}`);
    if (autoCloseMs !== undefined) {
        noticeTimer = window.setTimeout(goHome, autoCloseMs);
    }
}
// Session flow
function newSessionId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
function startSession() {
    const code = input;
    if (!code)
        return;
    if (!USSD_CODE_PATTERN.test(code)) {
        showNotice(t().invalidFormat, NOTICE_MS);
        return;
    }
    if (!SERVICE_CODES[code]) {
        showNotice(t().unknownCode(code), NOTICE_MS);
        return;
    }
    session = { id: newSessionId(), serviceCode: code, answers: [] };
    void send(session);
}
function reply() {
    if (!session || !input)
        return;
    session.answers.push(input);
    void send(session);
}
async function send(current) {
    clearTimers();
    phase = "waiting";
    resetInput();
    showMessage(t().running);
    try {
        const res = parseResponse(await ussdRequest(current, lang));
        if (session !== current)
            return; // user ended the session while waiting
        if (res.type === "END")
            showNotice(res.message);
        else
            showPrompt(res.message);
    }
    catch {
        if (session !== current)
            return;
        showNotice(t().connectionError, NOTICE_MS);
    }
}
// User actions
function pressKey(key) {
    if (phase !== "idle" && phase !== "prompt")
        return;
    if (input.length >= MAX_INPUT)
        return;
    input += key;
    renderInput();
}
function clearKey() {
    if (phase !== "idle" && phase !== "prompt")
        return;
    input = input.slice(0, -1);
    renderInput();
}
function callKey() {
    switch (phase) {
        case "idle":
            startSession();
            break;
        case "prompt":
            reply();
            break;
        case "notice":
            goHome();
            break;
        case "waiting":
            break;
    }
}
function endKey() {
    goHome();
}
// ---------- 7. Wiring ----------
keypadEl.addEventListener("click", (e) => {
    const target = e.target;
    const key = target.closest("[data-key]")?.dataset.key;
    if (key)
        pressKey(key);
});
callBtn.addEventListener("click", callKey);
clearBtn.addEventListener("click", clearKey);
endBtn.addEventListener("click", endKey);
langButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        const value = btn.dataset.lang;
        if (isLang(value))
            setLanguage(value);
    });
});
document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey)
        return;
    let handled = true;
    if (/^[0-9*#]$/.test(e.key))
        pressKey(e.key);
    else if (e.key === "Backspace")
        clearKey();
    else if (e.key === "Enter")
        callKey();
    else if (e.key === "Escape")
        endKey();
    else
        handled = false;
    // Stops Enter/Space on a focused button from also "clicking" it.
    if (handled)
        e.preventDefault();
});
renderLanguage();
goHome();
//# sourceMappingURL=main.js.map