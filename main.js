"use strict";
// ---------- Config ----------
const BRAND = "G PHONE"; // label shown on the phone body
const PHONE_NUMBER = "+254700000000"; // simulated subscriber
const KEYS = [
    ["1", ""], ["2", "abc"], ["3", "def"],
    ["4", "ghi"], ["5", "jkl"], ["6", "mno"],
    ["7", "pqrs"], ["8", "tuv"], ["9", "wxyz"],
    ["*", ""], ["0", "+"], ["#", ""],
];
// ---------- DOM ----------
const messageEl = document.getElementById("message");
const inputEl = document.getElementById("input");
const keypadEl = document.getElementById("keypad");
const brandEl = document.getElementById("brand");
const callBtn = document.getElementById("callBtn");
const clearBtn = document.getElementById("clearBtn");
const endBtn = document.getElementById("endBtn");
// ---------- State ----------
let input = "";
let inSession = false;
let serviceCode = "";
let sessionId = "";
let answers = [];
// ---------- Rendering ----------
function renderInput() {
    inputEl.textContent = input;
}
function showMessage(msg) {
    messageEl.textContent = msg;
}
function idleScreen() {
    showMessage("Dial a USSD code\neg *144#");
}
// ---------- USSD backend ----------
// Swap the mock for your real endpoint (Africa's Talking style: CON/END responses).
async function ussdRequest(code, text) {
    /*
    const res = await fetch("http://localhost:8080/ussd", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ sessionId, serviceCode: code, phoneNumber: PHONE_NUMBER, text }),
    });
    return res.text();
    */
    await new Promise((r) => setTimeout(r, 400)); // fake network delay
    return mockMenu(text);
}
const BALANCE = "KES 12,500.00";
function render(s) {
    switch (s.id) {
        case "main":
            return "CON Welcome\n1. Check balance\n2. Withdraw Money\n3. Exit";
        case "balance":
            return `CON Your balance is\n${BALANCE}\n\n1 Cancel\n2 Back`;
        case "withdraw":
            return "CON Withdraw Menu\n1. My Number\n2. Other Number\n3. Exit";
        case "recipient":
            return "CON Enter recipient number\n1 Exit";
        case "amount":
            return "CON Enter Amount\n1 Exit";
        case "withdrawn":
            return `CON You have withdrawn ${s.amount}\nto your number\n\n1 Cancel\n2 Back`;
    }
}
// Returns the next screen, or a final "END ..." string.
function next(s, choice) {
    const bye = "END Thank you.";
    switch (s.id) {
        case "main":
            if (choice === "1")
                return { id: "balance" };
            if (choice === "2")
                return { id: "withdraw" };
            if (choice === "3")
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
            return "END Invalid phone number.";
        case "amount": {
            if (choice === "1")
                return bye;
            const value = Number(choice);
            if (!Number.isInteger(value) || value <= 0)
                return "END Invalid amount.";
            const amount = value.toLocaleString("en-KE");
            return s.to
                ? `END You have withdrawn ${amount}\nto the number: ${s.to}`
                : { id: "withdrawn", amount };
        }
    }
    return "END Invalid choice.";
}
function mockMenu(text) {
    let screen = { id: "main" };
    for (const choice of text ? text.split("*") : []) {
        const result = next(screen, choice);
        if (typeof result === "string")
            return result;
        screen = result;
    }
    return render(screen);
}
function parseResponse(raw) {
    const type = raw.startsWith("END") ? "END" : "CON";
    return { type, message: raw.slice(4) };
}
// ---------- Actions ----------
function pressKey(key) {
    if (input.length >= 30)
        return;
    input += key;
    renderInput();
}
function clearKey() {
    input = input.slice(0, -1);
    renderInput();
}
function endSession() {
    inSession = false;
    answers = [];
    input = "";
    renderInput();
    idleScreen();
}
async function call() {
    if (!inSession) {
        if (!/^\*[\d*]+#$/.test(input)) {
            showMessage("Invalid USSD code");
            return;
        }
        serviceCode = input;
        sessionId = Date.now().toString();
        answers = [];
        inSession = true;
    }
    else {
        if (!input)
            return;
        answers.push(input);
    }
    input = "";
    renderInput();
    showMessage("USSD code running...");
    try {
        const res = parseResponse(await ussdRequest(serviceCode, answers.join("*")));
        showMessage(res.message);
        if (res.type === "END")
            inSession = false;
    }
    catch (_a) {
        showMessage("Connection problem\nor invalid MMI code");
        inSession = false;
    }
}
// ---------- Setup ----------
function buildKeypad() {
    for (const [digit, letters] of KEYS) {
        const btn = document.createElement("button");
        btn.className = "key";
        btn.innerHTML = `${digit}<small>${letters}</small>`;
        btn.addEventListener("click", () => pressKey(digit));
        keypadEl.appendChild(btn);
    }
}
document.addEventListener("keydown", (e) => {
    if (/^[0-9*#]$/.test(e.key))
        pressKey(e.key);
    else if (e.key === "Backspace")
        clearKey();
    else if (e.key === "Enter")
        call();
    else if (e.key === "Escape")
        endSession();
});
callBtn.addEventListener("click", call);
clearBtn.addEventListener("click", clearKey);
endBtn.addEventListener("click", endSession);
brandEl.textContent = BRAND;
buildKeypad();
renderInput();
idleScreen();