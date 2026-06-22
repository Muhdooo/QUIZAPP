process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
require('dotenv').config();
const express = require("express");
const path = require("path");

const API_KEY = process.env.API_KEY;

const app = express();
const port = 3000;

let punt = 0;

app.use(express.static('public')); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", "views");

app.get("/", (req, res) => {
    res.sendFile(path.resolve("public", "index.html"));
});

// Funzione helper per generare la domanda tramite l'API di Claude
async function generateQuizQuestion(argument, difficolta, domande_precedenti) {
    let listDomande = (domande_precedenti && domande_precedenti.length > 0) 
        ? domande_precedenti.map((d, idx) => `${idx + 1}. ${d}`).join('\n')
        : "Nessuna domanda ancora fatta.";

    const userMessage = `Crea una domanda a risposta multipla su: "${argument}".

### LINEE GUIDA SULLA COMPLESSITÀ E NATURA DELLA DOMANDA
1. Difficoltà richiesta: ${difficolta || 'media'}. Sintonizza la complessità della domanda su questo livello.
2. Contenuto: La domanda deve testare l'effettiva conoscenza di fatti, concetti o dettagli concreti dell'argomento scelto. Evita domande eccessivamente didattiche, teoriche o descrittive che spiegano l'argomento stesso anziché testarlo.
3. Cultura generale: La domanda deve essere di cultura generale sull'argomento, senza richiedere calcoli matematici complessi (a meno che l'argomento stesso non sia la matematica).
4. No Elementi Visivi: Non usare ASSOLUTAMENTE immagini, tabelle, grafici, markdown multimediale o riferimenti ad essi. Solo testo semplice.

### EVITA LE RIPETIZIONI
Non ripetere, parafrasare o riproporre le seguenti domande già formulate in precedenza in questo quiz:
${listDomande}

### FORMATO DI OUTPUT RICHIESTO
Devi restituire ESCLUSIVAMENTE 6 righe di testo semplice, separate da un singolo a capo (\\n). Non aggiungere introduzioni, conclusioni, commenti o spiegazioni.
Riga 1: Il testo della domanda.
Riga 2: L'opzione di risposta 1.
Riga 3: L'opzione di risposta 2.
Riga 4: L'opzione di risposta 3.
Riga 5: L'opzione di risposta 4.
Riga 6: Solo il numero corrispondente all'opzione corretta (un numero compreso tra 1 e 4).

### REQUISITI DELLA RISPOSTA CORRETTA
Assicurati che tra le opzioni ci sia una e una sola risposta corretta e che le altre siano verosimilmente errate.`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 180,
                messages: [
                    { role: 'user', content: userMessage },
                ]
            })
        });

        const data = await response.json();
        if (!data.content || !data.content[0] || !data.content[0].text) {
            console.error("Risposta Claude non valida:", data);
            throw new Error("Risposta API Claude vuota o errata");
        }
        return parseClaudeResponse(data.content[0].text);
    } catch (err) {
        console.error('Errore nella risposta di Claude:', err);
        return ["Errore nel caricamento della domanda.", "Opzione 1", "Opzione 2", "Opzione 3", "Opzione 4", "1"];
    }
}

// Funzione helper per pulire e strutturare la risposta ricevuta da Claude
function parseClaudeResponse(text) {
    let lines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');

    // Fallback se ci sono meno di 6 righe
    if (lines.length < 6) {
        console.warn("Claude ha restituito meno di 6 righe:", lines);
        while (lines.length < 5) {
            lines.push("Opzione non generata");
        }
        if (lines.length < 6) {
            lines.push("1");
        }
    }

    // Estraiamo domanda e 4 opzioni
    let formattedResult = lines.slice(0, 5);

    // Cerchiamo la prima riga che contenga il numero corretto (dalla riga 5 in poi)
    let correctNumber = "1";
    for (let i = 5; i < lines.length; i++) {
        const match = lines[i].match(/[1-4]/);
        if (match) {
            correctNumber = match[0];
            break;
        }
    }

    formattedResult.push(correctNumber);
    return formattedResult;
}

// --- QUIZ ROUND 1 ---

app.post("/quiz", async (req, res) => {
    punt = 0;
    const id = req.body.nome;
    const argument = req.body.argomento;
    const difficolta = req.body.difficolta || 'media';
    let domande_precedenti = [];

    const r = await generateQuizQuestion(argument, difficolta, domande_precedenti);
    if (r && r[0] && r[0] !== "Errore nel caricamento della domanda.") {
        domande_precedenti.push(r[0]);
    }

    res.render("risultato", {
        risultato: r,
        scelta1: null,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

app.post("/scelta1", (req, res) => {
    let id = req.body.name;
    let risultato = req.body.risultato;
    let scelta = parseFloat(req.body.opzioni);
    let argument = req.body.argument;
    let difficolta = req.body.difficolta || 'media';
    
    let domande_precedenti = req.body.domande_precedenti;
    if (!Array.isArray(domande_precedenti)) {
        domande_precedenti = domande_precedenti ? [domande_precedenti] : [];
    }

    // Sanitizzazione risposta corretta per il confronto
    let correctAns = risultato && risultato[5] ? parseFloat(risultato[5].replace(/\D/g, '')) : NaN;
    if (scelta === correctAns) {
        punt += 20;
    }

    if (!Array.isArray(risultato)) {
        risultato = [risultato];
    }

    res.render("risultato", {
        risultato: risultato,
        scelta1: scelta,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

// --- QUIZ ROUND 2 ---

app.post("/quiz2", async (req, res) => {
    const id = req.body.name;
    const argument = req.body.argomento;
    const difficolta = req.body.difficolta || 'media';
    
    let domande_precedenti = req.body.domande_precedenti;
    if (!Array.isArray(domande_precedenti)) {
        domande_precedenti = domande_precedenti ? [domande_precedenti] : [];
    }

    const r = await generateQuizQuestion(argument, difficolta, domande_precedenti);
    if (r && r[0] && r[0] !== "Errore nel caricamento della domanda.") {
        domande_precedenti.push(r[0]);
    }

    res.render("risultato2", {
        risultato: r,
        scelta1: null,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

app.post("/scelta2", (req, res) => {
    let id = req.body.name;
    let risultato = req.body.risultato;
    let scelta = parseFloat(req.body.opzioni);
    let argument = req.body.argument;
    let difficolta = req.body.difficolta || 'media';
    
    let domande_precedenti = req.body.domande_precedenti;
    if (!Array.isArray(domande_precedenti)) {
        domande_precedenti = domande_precedenti ? [domande_precedenti] : [];
    }

    let correctAns = risultato && risultato[5] ? parseFloat(risultato[5].replace(/\D/g, '')) : NaN;
    if (scelta === correctAns) {
        punt += 20;
    }

    if (!Array.isArray(risultato)) {
        risultato = [risultato];
    }

    res.render("risultato2", {
        risultato: risultato,
        scelta1: scelta,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

// --- QUIZ ROUND 3 ---

app.post("/quiz3", async (req, res) => {
    const id = req.body.name;
    const argument = req.body.argomento;
    const difficolta = req.body.difficolta || 'media';
    
    let domande_precedenti = req.body.domande_precedenti;
    if (!Array.isArray(domande_precedenti)) {
        domande_precedenti = domande_precedenti ? [domande_precedenti] : [];
    }

    const r = await generateQuizQuestion(argument, difficolta, domande_precedenti);
    if (r && r[0] && r[0] !== "Errore nel caricamento della domanda.") {
        domande_precedenti.push(r[0]);
    }

    res.render("risultato3", {
        risultato: r,
        scelta1: null,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

app.post("/scelta3", (req, res) => {
    let id = req.body.name;
    let risultato = req.body.risultato;
    let scelta = parseFloat(req.body.opzioni);
    let argument = req.body.argument;
    let difficolta = req.body.difficolta || 'media';
    
    let domande_precedenti = req.body.domande_precedenti;
    if (!Array.isArray(domande_precedenti)) {
        domande_precedenti = domande_precedenti ? [domande_precedenti] : [];
    }

    let correctAns = risultato && risultato[5] ? parseFloat(risultato[5].replace(/\D/g, '')) : NaN;
    if (scelta === correctAns) {
        punt += 20;
    }

    if (!Array.isArray(risultato)) {
        risultato = [risultato];
    }

    res.render("risultato3", {
        risultato: risultato,
        scelta1: scelta,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

// --- QUIZ ROUND 4 ---

app.post("/quiz4", async (req, res) => {
    const id = req.body.name;
    const argument = req.body.argomento;
    const difficolta = req.body.difficolta || 'media';
    
    let domande_precedenti = req.body.domande_precedenti;
    if (!Array.isArray(domande_precedenti)) {
        domande_precedenti = domande_precedenti ? [domande_precedenti] : [];
    }

    const r = await generateQuizQuestion(argument, difficolta, domande_precedenti);
    if (r && r[0] && r[0] !== "Errore nel caricamento della domanda.") {
        domande_precedenti.push(r[0]);
    }

    res.render("risultato4", {
        risultato: r,
        scelta1: null,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

app.post("/scelta4", (req, res) => {
    let id = req.body.name;
    let risultato = req.body.risultato;
    let scelta = parseFloat(req.body.opzioni);
    let argument = req.body.argument;
    let difficolta = req.body.difficolta || 'media';
    
    let domande_precedenti = req.body.domande_precedenti;
    if (!Array.isArray(domande_precedenti)) {
        domande_precedenti = domande_precedenti ? [domande_precedenti] : [];
    }

    let correctAns = risultato && risultato[5] ? parseFloat(risultato[5].replace(/\D/g, '')) : NaN;
    if (scelta === correctAns) {
        punt += 20;
    }

    if (!Array.isArray(risultato)) {
        risultato = [risultato];
    }

    res.render("risultato4", {
        risultato: risultato,
        scelta1: scelta,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

// --- QUIZ ROUND 5 ---

app.post("/quiz5", async (req, res) => {
    const id = req.body.name;
    const argument = req.body.argomento;
    const difficolta = req.body.difficolta || 'media';
    
    let domande_precedenti = req.body.domande_precedenti;
    if (!Array.isArray(domande_precedenti)) {
        domande_precedenti = domande_precedenti ? [domande_precedenti] : [];
    }

    const r = await generateQuizQuestion(argument, difficolta, domande_precedenti);
    if (r && r[0] && r[0] !== "Errore nel caricamento della domanda.") {
        domande_precedenti.push(r[0]);
    }

    res.render("risultato5", {
        risultato: r,
        scelta1: null,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

app.post("/scelta5", (req, res) => {
    let id = req.body.name;
    let risultato = req.body.risultato;
    let scelta = parseFloat(req.body.opzioni);
    let argument = req.body.argument;
    let difficolta = req.body.difficolta || 'media';
    
    let domande_precedenti = req.body.domande_precedenti;
    if (!Array.isArray(domande_precedenti)) {
        domande_precedenti = domande_precedenti ? [domande_precedenti] : [];
    }

    let correctAns = risultato && risultato[5] ? parseFloat(risultato[5].replace(/\D/g, '')) : NaN;
    if (scelta === correctAns) {
        punt += 20;
    }

    if (!Array.isArray(risultato)) {
        risultato = [risultato];
    }

    res.render("risultato5", {
        risultato: risultato,
        scelta1: scelta,
        argument: argument,
        difficolta: difficolta,
        name: id,
        domande_precedenti: domande_precedenti
    });
});

app.post("/punteggio", (req, res) => {
    let id = req.body.name;
    console.log("name", id);
    res.render("punteggio", {
        punteggio: punt,
        name: id,
    });
});

app.listen(port, () => {
    console.log("Server in ascolto sulla porta " + port);
});