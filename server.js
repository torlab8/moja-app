require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const session = require('express-session');
const path = require('path');
const { LowSync } = require('lowdb');
const { JSONFileSync } = require('lowdb/node');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'tajny-klucz-zmien-to',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

// ─── BAZA DANYCH (plik JSON - dane nie znikają po restarcie) ──────────────────
const db = new LowSync(new JSONFileSync('baza.json'), { users: {}, resetCodes: {}, verifyCodes: {} });
db.read();
if (!db.data.users) db.data.users = {};
if (!db.data.resetCodes) db.data.resetCodes = {};
if (!db.data.verifyCodes) db.data.verifyCodes = {};
db.write();

function save() { db.write(); }
function read() { db.read(); return db.data; }

// ─── NODEMAILER ───────────────────────────────────────────────────────────────
let transporter;

async function getTransporter() {
  if (transporter) return transporter;
  if (process.env.EMAIL_USER) {
    // Sprawdzamy czy używamy portu 465 (wymaga secure: true)
    const isSecure = process.env.EMAIL_PORT === '465'; 

    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: isSecure, // Będzie true jeśli na Railway wpiszesz 465
      auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
      },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email', port: 587, secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('\n📧 Tryb testowy Ethereal – podejrzyj maile na: https://ethereal.email\n');
  }
  return transporter;
}

function generateCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

async function sendMail(to, subject, text) {
  const t = await getTransporter();
  
  const info = await t.sendMail({ 
    // Zmieniamy na dynamiczny adres z Twoich ustawień:
    from: `"Twoja Aplikacja" <${process.env.EMAIL_USER}>`, 
    to, 
    subject, 
    text 
  });

  // Dodajmy logowanie sukcesu w konsoli Railway (pomoże Ci to sprawdzić, czy wyszło)
  console.log(`✅ Email wysłany do: ${to}`);
  
  // Linia z preview działa tylko w trybie testowym Ethereal
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.log(`📩 Podgląd maila (testowy): ${preview}`);
  
  return info;
}

// ─── REJESTRACJA ──────────────────────────────────────────────────────────────

app.post('/api/register/send-code', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Brak danych' });
  if (password.length < 6) return res.status(400).json({ error: 'Hasło za krótkie' });

  const { users } = read();
  if (users[email]) return res.status(409).json({ error: 'Ten email jest już zarejestrowany' });

  const code = generateCode();
  const hash = await bcrypt.hash(password, 10);

  db.data.verifyCodes[email] = {
    code,
    expires: Date.now() + 10 * 60 * 1000,
    passwordHash: hash
  };
  save();

  try {
    await sendMail(email, 'Kod weryfikacyjny rejestracji',
      `Witaj!\n\nTwój kod weryfikacyjny: ${code}\n\nKod jest ważny przez 10 minut.`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd wysyłania emaila' });
  }
});

app.post('/api/register/verify', (req, res) => {
  const { email, code } = req.body;
  const { verifyCodes } = read();
  const entry = verifyCodes[email];

  if (!entry) return res.status(400).json({ error: 'Brak kodu dla tego emaila' });
  if (Date.now() > entry.expires) {
    delete db.data.verifyCodes[email];
    save();
    return res.status(400).json({ error: 'Kod wygasł – wyślij nowy' });
  }
  if (entry.code !== code) return res.status(400).json({ error: 'Nieprawidłowy kod' });

  db.data.users[email] = { passwordHash: entry.passwordHash, createdAt: new Date().toISOString() };
  delete db.data.verifyCodes[email];
  save();

  req.session.user = { email };
  res.json({ success: true, message: 'Konto utworzone!' });
});

// ─── LOGOWANIE ────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const { users } = read();
  const user = users[email];

  if (!user) return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });

  req.session.user = { email };
  res.json({ success: true, message: 'Zalogowano!' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Niezalogowany' });
  res.json({ email: req.session.user.email });
});

// ─── RESET HASŁA ──────────────────────────────────────────────────────────────

app.post('/api/reset/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Podaj email' });

  const { users } = read();
  // Nie zdradzamy czy email istnieje (bezpieczeństwo)
  if (!users[email]) return res.json({ success: true });

  const code = generateCode();
  db.data.resetCodes[email] = { code, expires: Date.now() + 10 * 60 * 1000 };
  save();

  try {
    await sendMail(email, 'Kod resetu hasła',
      `Otrzymałeś prośbę o reset hasła.\n\nTwój kod: ${code}\n\nKod jest ważny przez 10 minut.\n\nJeśli to nie Ty – zignoruj tę wiadomość.`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Błąd wysyłania emaila' });
  }
});

app.post('/api/reset/verify', async (req, res) => {
  const { email, code, newPassword } = req.body;
  const { resetCodes } = read();
  const entry = resetCodes[email];

  if (!entry) return res.status(400).json({ error: 'Brak aktywnego kodu dla tego emaila' });
  if (Date.now() > entry.expires) {
    delete db.data.resetCodes[email];
    save();
    return res.status(400).json({ error: 'Kod wygasł – wyślij nowy' });
  }
  if (entry.code !== code) return res.status(400).json({ error: 'Nieprawidłowy kod' });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Hasło za krótkie' });

  db.data.users[email].passwordHash = await bcrypt.hash(newPassword, 10);
  delete db.data.resetCodes[email];
  save();

  res.json({ success: true, message: 'Hasło zmienione!' });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ Serwer działa na: http://localhost:${PORT}`);
  console.log(`   Strona logowania:  http://localhost:${PORT}/index.html`);
  console.log(`   Rejestracja:       http://localhost:${PORT}/zarejstruj.html`);
  console.log(`   Reset hasła:       http://localhost:${PORT}/Resetuj.html\n`);
});
