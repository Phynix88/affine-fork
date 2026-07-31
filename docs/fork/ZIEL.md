# Wozu dieser Fork — Ziel, Vorgehen, Backlog

> **Dieses Repository ist öffentlich.** Der geschäftliche Kontext, für den das Werkzeug gebaut
> wird, steht bewusst nicht hier, sondern im privaten Homelab-Repo. Dieses Dokument beschreibt
> das technische Ziel und den Weg dorthin.

---

## Das Ziel in einem Satz

**AFFiNE soll ein Arbeitsplatz sein, den ein KI-Assistent mitpflegen kann** — nicht nur lesen und
neue Dokumente anlegen, sondern die vorhandene Struktur fortschreiben.

Konkret: Ein Product-Owner-Arbeitsplatz mit Wissensablage, Notizen, Aufgaben und Nachverfolgung, in
dem Claude über den MCP-Endpunkt arbeiten kann — Aufgaben aus Gesprächsnotizen eintragen, Zusagen
mit Nachfassterminen anlegen, Übersichten erzeugen.

**Warum ein Fork und nicht die Upstream-Version:** AFFiNE bringt den MCP-Endpunkt bereits mit, aber
die Schreibwerkzeuge sind auf einem selbstgehosteten Server nicht erreichbar, und Datenbank-Inhalte
konnte er gar nicht schreiben. Beides ist hier behoben.

---

## Vorgehen: workflow-getrieben, nicht featuregetrieben

Der erste Anlauf ging vom Vergleich mit Notion aus — welche Fähigkeiten fehlen AFFiNE? Das führte
direkt zu Relationen und Rollups, also dem schwierigsten Teil des Datenmodells. Eine Prüfung der
tatsächlich genutzten Daten zeigte dann: **Die vorhandene, aktiv gepflegte Datenbank kam seit
Jahren ohne eine einzige Relation aus.** Der Bedarf war angenommen, nicht belegt.

Seitdem gilt ein anderes Verfahren:

1. **Einen konkreten Arbeitsablauf beschreiben** — wie er heute läuft, was daran hakt.
2. **Ihn in AFFiNE abbilden**, mit dem, was heute geht.
3. **Reibung notieren**, wo es nicht geht — mit dem konkreten Fall daneben.
4. **Erst dann bauen**, und zwar das, was am häufigsten weh tut.

Die Reibungsliste unten **ist** der Backlog dieses Forks. Sie ist nach echtem Schmerz sortiert,
nicht nach Vollständigkeit gegenüber einem fremden Produkt.

**Was das schon gespart hat:** Relationen wären wochenlange Arbeit am Datenmodell gewesen. Das
tatsächlich blockierende Problem war, dass der MCP überhaupt keine Datenbankzeilen schreiben konnte
— gelöst in einem Tag, mit ungleich größerer Wirkung.

---

## Stand

| Fähigkeit                                                | Stand                                       |
| -------------------------------------------------------- | ------------------------------------------- |
| MCP-Schreibwerkzeuge auf Selfhost erreichbar             | erledigt — Dev-Sperre im Quellcode entfernt |
| Zeilen in bestehende Datenbanken schreiben               | erledigt — `append_database_row`            |
| Zelltypen Zahl, Datum, Checkbox, Auswahl                 | erledigt (aus dem Upstream-PR)              |
| Zelltypen Mehrfachauswahl und Text                       | erledigt — eigene Erweiterung               |
| Reproduzierbarer Bau ohne Werkzeugkette auf dem Zielhost | erledigt — `docker/cockpit/Containerfile`   |

Details in [`MCP-TOOLS.md`](./MCP-TOOLS.md), Betrieb in [`DEPLOY.md`](./DEPLOY.md).

---

## Backlog — was fehlt, nach Schmerz sortiert

### Nächstliegend

**Datenbanken und Spalten anlegen.** Heute Handarbeit in der Oberfläche. Solange eine Tabelle
einmal entsteht und danach nur wächst, ist das erträglich; bei mehreren neuen Projekten pro Monat
nicht mehr.

**Auswahloptionen anlegen.** Der Validator akzeptiert nur konfigurierte Optionen, erzeugen kann er
keine. Behelf ist ein Konsolen-Schnipsel (in `MCP-TOOLS.md`); sauber wäre ein eigenes Werkzeug.

**Zeilen ändern und löschen.** `append_database_row` hängt nur an. Eine Aufgabe auf „erledigt" zu
setzen geht nur von Hand — für ein Aufgabensystem eine spürbare Lücke.

### Mittelfristig

**Relative Datumsfilter.** AFFiNEs Filter kennen nur „vor" und „nach" mit einem _absoluten_ Datum
(`data-view/src/core/filter/filter-fn/date.ts`). Eine gespeicherte Ansicht „heute fällig" ist damit
unmöglich — man müsste den Filter täglich weiterstellen. Kleine, klar abgegrenzte Erweiterung über
dieselbe `createFilter`-Schnittstelle.

**Mehr Blocktypen im Markdown-Schreibpfad.** `update_document` scheitert auf Dokumenten mit
Datenbank, LaTeX, Anhang, Whiteboard-Inhalt oder verlinktem Dokument. Der Pfad kennt nur zehn
Typen. Folge heute: Text und Tabellen müssen in getrennten Dokumenten liegen.

### Weiter hinten

**Verknüpfte Datenbank-Ansichten.** Eine Tabelle lebt in genau einem Dokument; ein gefilterter
Ausschnitt lässt sich nicht anderswo einblenden. Das ist der Kniff, mit dem Notion dieselbe Liste
im Projekt und im Dashboard zeigt.

**Relationen und Rollups.** Fehlen vollständig (`relation`/`rollup` kommen im Quellcode nicht vor).
Der Erweiterungspunkt für Spaltentypen ist sauber (`propertyType(…).modelConfig({…})`), aber eine
Relation verweist auf Zeilen einer _anderen_ Datenbank — und das Datenmodell ist pro Block gedacht.
**Bewusst zurückgestellt**, bis ein konkreter Fall es verlangt (siehe Vorgehen oben).

---

## Abhängigkeit vom Upstream

`append_database_row` stammt aus einem **nicht gemergten** Upstream-PR. Der Maintainer hat ihn
abgelehnt, weil Yjs serverseitig für die AFFiNE-Cloud zu speicherhungrig ist, und eine native
Lösung auf y-octo-Basis **für 0.28 angekündigt**.

**Der Plan ist deshalb bewusst auf Ablösung angelegt:** Bringt 0.28 die native Umsetzung, wird
dieser Aufsatz gestrichen und die offizielle genutzt. Die Wegwerfbarkeit ist ein Merkmal, kein
Makel — sie überbrückt die Zwischenzeit.

Was bleiben wird, unabhängig von 0.28: die entfernte Dev-Sperre, das Containerfile und die
Erweiterungen um Zelltypen, sofern die native Lösung sie nicht selbst mitbringt.

---

## Leitplanken

- **Update-Kompatibilität zum Upstream ist kein Ziel.** Wo eine saubere Lösung eine Modelländerung
  verlangt, ist sie erlaubt.
- **Vor jeder Änderung die Abhängigkeiten prüfen** — Nutzungsstellen suchen, betroffene Aufrufer
  benennen, Ergebnis festhalten, dann erst ändern.
- **Speicherformen messen, nicht aus Typen ableiten** (LESSONS #18).
- **Ein Exit-Code ist eine Behauptung, kein Beweis** (LESSONS #2) — jede Stufe prüft ihr Ergebnis.
