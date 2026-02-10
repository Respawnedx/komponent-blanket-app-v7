KOMPONENT-BLANKET APP (lokal) – matcher UX fra skabelonen

Indhold:
- index.html
- styles.css
- app.js

Sådan kører du:
1) Åbn mappen i VS Code.
2) Brug evt. VS Code extension "Live Server" (anbefalet):
   - Højreklik index.html > "Open with Live Server"
   Eller:
   - Dobbeltklik index.html og åbn i din browser.

Funktioner:
- Formular med felter + checkbox grid 01–99 (layout og look ligner skabelonen)
- Gem/Hent flere poster lokalt (browser localStorage)
- Print/PDF (brug browser print)
- Eksportér JSON

Hvis du vil have import fra CSV/Excel eller gem til fil/SQL senere:
- Sig til, så bygger vi "Import" + "Download Excel/CSV" eller backend.
PRINT / PDF (1 side)
- I Chrome/Edge: Print -> More settings:
  * Paper size: A4
  * Margins: None eller Minimum
  * Slå "Headers and footers" FRA (ellers kommer dato/URL på PDF'en og kan give side 2)
  * Scale: 95% (hvis den stadig springer til 2 sider)

Hvor gemmer appen data?
- Standard (Live Server / åbne index.html): data gemmes i browserens localStorage for denne side (ikke som filer).
  Det betyder at data ligger lokalt på din PC, men kun i browseren.
- Du kan altid eksportere (JSON) og importere igen.

"Mappe inde i appen" (fil-lagring)
- Browseren må ikke skrive direkte til en mappe uden backend.
- Hvis du vil gemme som en fil i en mappe ved siden af appen:
  1) Åbn terminal i denne mappe
  2) Kør: node server.js
  3) Åbn: http://localhost:3000
  4) Datafilen ligger her: data/records.json

(Næste step: jeg kan også ændre app.js så den automatisk bruger /api/records når server.js kører.)



OCR fra indscannet udfyldt blanket
- Klik 'OCR scan' og vælg et billede (jpg/png).
- Appen forsøger at detektere krydser i checkboxe ved at måle mørke i felterne.
- Det virker bedst med en lige, hel-side scan (A4, uden rotation).
- Resultatet markeres med blå farve (Fra scan). Manuelle ændringer bliver sorte.

Logning (audit)
- Hver gang du gemmer, bliver der tilføjet en audit-linje til posten med:
  tidspunkt, initialer, added/removed.
- OCR skriver også en audit-linje (OCR_APPLY).
- Alt gemmes lokalt i browseren (localStorage), eller i data/records.json hvis du bruger server.js.

Mini-login
- Klik 'Login' og angiv initialer (fx NIJEY).
- Hvis du markerer 'Admin' kræver det password (ændres i app.js: ADMIN_PASSWORD).
- Når du ikke er logget ind, er checkboxe, OCR og "Gem" låst (read-only).
- Dette er et lokalt "mini-login" til logning – ikke sikkerhed.


OCR tuning
- OCR bruger auto-crop + adaptiv sammenligning (center vs baggrund) for bedre træf.
- Hvis den markerer for få: sænk DELTA i app.js (fx 14 -> 10).
- Hvis den markerer for mange: hæv DELTA (fx 14 -> 18).
