WhatsApp Auto Reply v3 KI

NEU:
- KI formuliert je nach eingehender Nachricht eine individuelle Antwort.
- 5 Minuten Standard-Wartezeit (300 Sekunden).
- Wenn du innerhalb der 5 Minuten selbst antwortest, wird die KI-Antwort verworfen.
- Treffen, Uhrzeiten, Termine, Verfügbarkeit und Zusagen werden NICHT von der KI beantwortet.
- Solche Nachrichten landen im Bereich "Mensch muss antworten".
- Standardmäßig erscheint zusätzlich eine Windows-Benachrichtigung.
- Alternativ kann die App nur im Dashboard warten.
- Die KI berücksichtigt einen begrenzten jüngsten Chatverlauf.
- Für jeden Chat kannst du einen eigenen Antwortstil hinterlegen.

START:
1. ZIP entpacken.
2. Node.js LTS installieren.
3. STARTEN.bat öffnen.
4. QR-Code über WhatsApp > Einstellungen > Verknüpfte Geräte scannen.
5. "Aktualisieren" drücken.
6. Gewünschte bestehende Chats aktivieren.
7. OpenAI API-Key im Bereich "KI & Sicherheit" eintragen und speichern.
8. Hauptschalter "Auto" aktivieren.

WICHTIGE SICHERHEITSLOGIK:
- Keine Gruppen.
- Keine neuen Nummern werden angeschrieben.
- Nur bestehende und ausdrücklich aktivierte Chats.
- Treffen/Uhrzeiten/Terminentscheidungen => immer Mensch.
- Verbindliche Zusagen => Mensch.
- Geld/Verträge/Notfälle/wichtige Entscheidungen => KI soll Mensch anfordern.
- Eigene manuelle Antwort stoppt wartende Bot-Antwort.
- Alle wartenden Antworten können sofort gestoppt werden.

DATENSCHUTZ:
Für KI-Antworten werden die eingehende Nachricht und eine begrenzte Zahl vorheriger Textnachrichten
des jeweiligen aktivierten Chats an die OpenAI API gesendet. Der API-Key liegt lokal in secrets.json.
secrets.json und der Ordner .wwebjs_auth sollten nicht weitergegeben werden.

HINWEIS ZU WHATSAPP:
Die WhatsApp-Verbindung basiert auf WhatsApp Web / whatsapp-web.js und ist keine offizielle
Meta/WhatsApp-API. WhatsApp-Updates können die Funktion beeinträchtigen. Nutzung auf eigenes Risiko.
