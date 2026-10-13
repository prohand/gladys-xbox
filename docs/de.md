# Xbox-Integration

Steuern Sie Ihre Xbox-Konsolen (Xbox One, Xbox Series X|S) über Gladys: Schalten
Sie sie ein und aus, sehen Sie, ob sie eingeschaltet sind und welches Spiel
läuft, und verwenden Sie sie in Szenen und auf dem Dashboard.

## Zwei Kanäle

| Kanal                    | Voraussetzung       | Funktionen                                                                                                                          |
| ------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Lokal** (Ihr Netzwerk) | nichts              | findet die Konsolen, erkennt, ob sie eingeschaltet sind, schaltet sie ein                                                           |
| **Cloud** (Xbox Live)    | ein Microsoft-Konto | alles oben Genannte, dazu: ausschalten, Lautstärke, Stummschaltung, Medientasten, Controller-Tasten, Spiel starten, laufendes Spiel |

Sie können den lokalen Kanal allein, den Cloud-Kanal allein oder beide nutzen.
Mit beiden wählt der Schalter **Lokale (LAN) Verbindung bevorzugen, wenn
verfügbar** der Konfiguration den Kanal, der zuerst gefragt wird; der andere
übernimmt, wenn der erste nicht antwortet. Das Abzeichen jeder Konsole zeigt,
welcher Kanal sie zuletzt bedient hat (oranger Punkt: Die Cloud bedient eine
Konsole, die die lokale Suche nicht gefunden hat).

## Die Konsole vorbereiten

1. **Energiemodus**: Einstellungen → Allgemein → Energieoptionen →
   **Ruhemodus** (Xbox Series) oder **Sofort-Ein** (Xbox One). Im Modus
   „Herunterfahren (Energiesparmodus)“ kann die Konsole über das Netzwerk nicht
   eingeschaltet werden, über keinen Kanal.
2. **Remotefunktionen** (Cloud-Kanal): Einstellungen → Geräte und Verbindungen →
   Remotefunktionen → **Remotefunktionen aktivieren** ankreuzen.
3. Wählen Sie im selben Bildschirm unter **Xbox-App-Einstellungen** die Option
   **Verbindungen von jedem Gerät zulassen**: Das hilft dem lokalen Kanal.

## Lokaler Kanal

Nichts auszufüllen: Öffnen Sie die Integration, klicken Sie auf **Verbindung
testen und Konsolen suchen** und erstellen Sie dann Ihre Konsolen im Tab
**Entdecken**.

Die Suche bittet Gladys, eine SmartGlass-Erkennung auf dem UDP-Port 5050 Ihres
Netzwerks zu senden (Gladys zeigt diese Berechtigung bei der Installation der
Integration an). Eine Konsole in einem anderen Subnetz oder hinter einem Router,
der Broadcasts filtert, wird auf diese Weise nicht gefunden: Geben Sie ihre
IP-Adresse unter **IP-Adressen der Konsolen** ein (mehrere Adressen durch Kommas
getrennt). Geben Sie der Konsole in Ihrem Router eine feste Adresse, damit sie
sich nicht ändert.

## Cloud-Kanal

Der Cloud-Kanal meldet sich mit Ihrem Microsoft-Konto bei Xbox Live an, über
eine Anwendung, die **Sie** bei Microsoft registrieren (kostenlos). Gladys sieht
Ihr Passwort nie.

1. Öffnen Sie das [Azure-Portal](https://portal.azure.com) →
   **App-Registrierungen** → **Neue Registrierung**.
   - Name: `Gladys Xbox` (beliebig).
   - Unterstützte Kontotypen: **Nur persönliche Microsoft-Konten** (oder
     „Konten in einem beliebigen Organisationsverzeichnis und persönliche
     Microsoft-Konten“).
   - Umleitungs-URI: Plattform **Web**, Adresse: die der Gladys-Schaltfläche
     **Verbinden** (siehe unten).
2. Kopieren Sie in der Anwendung die **Anwendungs-ID (Client)**.
3. **Zertifikate & Geheimnisse** → **Neuer geheimer Clientschlüssel** → kopieren
   Sie seinen **Wert** (nicht seine ID: Der Wert wird nur einmal angezeigt).
4. Fügen Sie in Gladys die beiden Werte unter **Anwendungs-ID (Client)** und
   **Geheimer Clientschlüssel** ein, speichern Sie und klicken Sie dann neben
   **Microsoft-Konto** auf **Verbinden** und melden Sie sich an.

**Welcher Umleitungs-URI?** Die Integration schreibt ihn in ihre Protokolle,
wenn Sie auf Verbinden klicken (`Redirect URI to register in Azure: …`), und
Microsoft zeigt ihn auf der Fehlerseite an, wenn er noch nicht registriert ist.
Microsoft akzeptiert nur eine **https**-Adresse (oder `http://localhost`):
Öffnen Sie Gladys über seine https-Adresse (Gladys Plus, Ihr Reverse Proxy),
wenn Sie auf Verbinden klicken.

Die Verknüpfung bleibt bestehen: Die Integration erneuert ihren Zugriff selbst.
Wenn die Konfiguration „Die Verknüpfung mit dem Microsoft-Konto ist abgelaufen“
anzeigt, klicken Sie erneut auf **Verbinden**.

## Die Konsole in Gladys

Jede Konsole ist ein Gerät vom Typ Fernseher:

- **Ein/Aus**: Ein: lokales Paket oder Cloud, je nach Präferenz. Aus: nur Cloud.
- **Stumm**, **Lauter / Leiser**, **Wiedergabe**, **Pause**, **Zurück**,
  **Weiter**, die Pfeiltasten, **A (Auswählen)**, **B (Zurück)**, **Menü**,
  **Ansicht**, **Xbox-Taste (Guide)**: nur Cloud.
- **Laufendes Spiel**: der Name des Spiels oder der App im Vordergrund, `-` auf
  dem Startbildschirm oder wenn die Konsole aus ist (nur Cloud).

Die Konsole wird standardmäßig alle 60 Sekunden gelesen
(**Aktualisierungsintervall**, mindestens 30 Sekunden) und erneut innerhalb von
30 Sekunden nach einem Befehl.

## Szenen

Auslöser:

- **Ein Spiel startet auf einer Xbox**: Filter auf die Konsole und den exakten
  Spielnamen. Variablen: `title_name`, `title_id`.
- **Ein Spiel endet auf einer Xbox**: dieselben Filter. Variablen: `title_name`,
  `title_id`, `played_minutes`.

Verwenden Sie sie in den folgenden Aktionen als
`{{triggerEvent.data.title_name}}`, z. B. um „Lucas hat 95 Minuten Minecraft
gespielt“ als Nachricht zu senden.

Aktionen:

- **Eine Xbox einschalten und warten**: schaltet die Konsole ein und wartet
  dann, bis sie antwortet (bis zu 100 s). Ausgabe `awake` (true / false), um die
  nächsten Aktionen davon abhängig zu machen.
- **Ein Spiel auf einer Xbox starten**: über seine Produkt-ID im Microsoft
  Store, die 12 Zeichen am Ende der Adresse der Spielseite auf xbox.com, z. B.
  `xbox.com/…/games/store/<name>/9NBLGGH2JHXJ`. Ausgabe `launched`.
- **Eine Controller-Taste drücken**: A, B, X, Y, Pfeiltasten, Xbox-Taste,
  Ansicht, Menü. Ausgabe `pressed`.

Ein/Aus, Stummschaltung und Tasten sind auch in der Standardaktion „Gerätewert
setzen“ verfügbar, und der Einschaltzustand im Standardauslöser „Änderung von
Gerätestatus“.

Das laufende Spiel stammt aus der **Anwesenheit Ihres Xbox-Live-Kontos**, nicht
von einer einzelnen Konsole: Sind mehrere Konsolen gleichzeitig eingeschaltet,
zeigen alle das Spiel des verknüpften Kontos.

## Dashboard-Widget

Fügen Sie das Widget **Xbox-Konsole** hinzu und wählen Sie eine Konsole (standardmäßig
die erste): Betrieb, laufendes Spiel, Verbindung, Konto und Schnelltasten —
Einschalten, und mit dem Cloud-Kanal: Startseite, Wiedergabe/Pause, Ausschalten.

## Fehlerbehebung

- **Keine Konsole gefunden**: Ist sie eingeschaltet oder im Ruhemodus /
  Sofort-Ein? Ist Gladys im selben Netzwerk? Versuchen Sie, ihre IP-Adresse
  einzugeben.
- **Die Konsole schaltet sich nicht ein**: Prüfen Sie den Energiemodus
  (Ruhemodus / Sofort-Ein). Auf dem lokalen Kanal muss die Konsole mindestens
  einmal geantwortet haben, damit ihre Live-ID bekannt ist.
- **„needs the cloud channel“**: Ausschalten und die Tasten benötigen das
  Microsoft-Konto.
- **Die Befehle bewirken nichts**: Aktivieren Sie die Remotefunktionen auf der
  Konsole.
- **Protokolle**: Gladys → Integrationen → Xbox → Protokolle. Sie enthalten nie
  Ihre Tokens oder Ihren geheimen Schlüssel.
