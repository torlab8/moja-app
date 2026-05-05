# Auth App

System logowania z rejestracją, weryfikacją emailem i resetem hasła.

## Uruchomienie lokalnie

```bash
npm install
node server.js
```

Otwórz: **http://localhost:3000/STRONA.html**

## Konfiguracja emaili

### Tryb testowy (domyślny)
Bez konfiguracji działa przez **Ethereal** – po wysłaniu kodu w konsoli pojawi się link do podglądu maila.

### Prawdziwe maile (Gmail)
1. Stwórz plik `.env`:
```
SESSION_SECRET=jakis-dlugi-losowy-ciag-znakow
EMAIL_USER=twoj@gmail.com
EMAIL_PASS=haslo-aplikacji-google
```
2. Hasło aplikacji Google: Konto Google → Bezpieczeństwo → Weryfikacja 2-etapowa → **Hasła aplikacji**

## Deployment na Railway (darmowy hosting)

1. Wrzuć kod na GitHub
2. Wejdź na [railway.app](https://railway.app) → "Deploy from GitHub"
3. W Railway ustaw zmienne środowiskowe (SESSION_SECRET, EMAIL_USER, EMAIL_PASS)
4. Gotowe – strona działa publicznie!

## Baza danych

Dane zapisywane są w pliku `baza.json` (tworzony automatycznie).
Plik jest w `.gitignore` – nie trafi na GitHub (bezpieczeństwo).
Na Railway dane są trwałe dopóki nie zrestartujesz aplikacji – dla produkcji warto dodać PostgreSQL.
