# MCP-Werkzeuge dieser Instanz

Der MCP-Endpunkt macht AFFiNE für Claude ansprechbar — lesend und, dank dieses Forks, auch
schreibend. Dieses Dokument beschreibt, was geht, was nicht geht und wie man es benutzt.

**Endpunkt:** `POST https://affine.wefers.club/api/workspaces/<WORKSPACE-ID>/mcp`
**Authentifizierung:** `Authorization: Bearer aff_mcp_v1.…`
**Token erzeugen:** in AFFiNE unter Settings → Integrations → MCP Server → _Create MCP credential_

---

## Die sieben Werkzeuge

| Werkzeug                  | Modus     | Was es tut                                                                     |
| ------------------------- | --------- | ------------------------------------------------------------------------------ |
| `read_document`           | lesen     | Dokument als Markdown, inklusive Datenbank-Inhalten                            |
| `keyword_search`          | lesen     | Volltextsuche über den Workspace                                               |
| `semantic_search`         | lesen     | Bedeutungsähnliche Passagen                                                    |
| `create_document`         | schreiben | Neues Dokument aus Markdown                                                    |
| `update_document`         | schreiben | Inhalt ersetzen, mit strukturellem Abgleich                                    |
| `update_document_meta`    | schreiben | Titel ändern                                                                   |
| **`append_database_row`** | schreiben | **Zeile an eine bestehende Datenbank anhängen** — die Erweiterung dieses Forks |

Die sechs ersten sind Upstream, nur hinter einer Sperre versteckt, die dieser Fork entfernt.
Das siebte stammt aus dem nicht gemergten PR
[#15369](https://github.com/toeverything/AFFiNE/pull/15369).

---

## Was jeweils funktioniert — und was nicht

### Reine Textdokumente: voller Zugriff

Anlegen, lesen, Inhalt ersetzen, Titel ändern — alles ohne Einschränkung, solange das Dokument nur
aus unterstützten Blöcken besteht: Absätze, Überschriften, Listen, Code, Zitate, Bilder, einfache
Tabellen, Lesezeichen, YouTube- und Iframe-Einbettungen.

### Dokumente mit Datenbank: lesen und Zeilen anhängen, aber kein Textupdate

`update_document` scheitert auf **jedem** Dokument, das eine Datenbank enthält:

```
parser_error: unsupported block flavour: affine:database
```

**Es wird dabei nichts geschrieben** — Datenverlust ist ausgeschlossen. Aber der Fließtext solcher
Dokumente ist über den MCP dauerhaft unveränderlich. Dasselbe gilt für Dokumente mit LaTeX,
Anhängen, Whiteboard-Inhalten und **verlinkten Dokumenten** (entstehen beim „Link to page").

> **Gestaltungsregel für die Ablage:** Erzählender Text und Tabellen gehören in **getrennte
> Dokumente**. Dann bleibt jede Fähigkeit voll nutzbar.

### Datenbanken: Zeilen ja, Struktur nein

`append_database_row` hängt Zeilen an. Es kann **nicht**: Datenbanken anlegen, Spalten anlegen oder
ändern, Zeilen oder Spalten löschen. **Die Tabelle selbst legt ein Mensch einmal in der Oberfläche
an.**

**Schreibbare Zelltypen:** `number`, `date` (Zeitstempel), `checkbox`, `select`.
**Nicht schreibbar:** `rich-text` (Textspalten), `multi-select`, `progress`, `image`, `member`,
`link`. Der Validator wirft bei allem, was nicht in der ersten Liste steht.

---

## Arbeitsablauf: eine Zeile schreiben

Drei Schritte, weil zwei Kennungen nötig sind, die nicht im Markdown stehen.

### 1. Dokument lesen und Options-Kennungen entnehmen

```bash
curl -s -X POST "$URL" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"read_document","arguments":{"docId":"<DOC-ID>"}}}'
```

Die Antwort enthält die Auswahlwerte samt Kennung:

```html
<span data-affine-option data-value="UZV_vlOWK0" …>Todo</span>
```

**`UZV_vlOWK0` ist der Wert, der geschrieben wird — nicht das Wort „Todo".**

### 2. Blockkennung und Spalten-Kennungen aus dem Browser holen

`read_document` liefert sie nicht mit. In der Browser-Konsole auf der geöffneten Seite:

Blockkennung der Datenbank:

<!-- prettier-ignore -->
```javascript
document.querySelector('affine-database').closest('[data-block-id]').dataset.blockId;
```

Spalten mit Kennung, Name und Typ:

<!-- prettier-ignore -->
```javascript
(() => {
  const m = document.querySelector('affine-database').model;
  return (m.props?.columns ?? m.columns)
    .toArray?.()
    .map(c => ({ id: c.id, name: c.name, type: c.type }));
})();
```

### 3. Zeile schreiben

```bash
curl -s -X POST "$URL" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"append_database_row",
        "arguments":{
          "docId":"<DOC-ID>",
          "databaseBlockId":"<BLOCK-ID>",
          "title":"Business Case PIM-Wechsel aufsetzen",
          "cells":{"<SPALTEN-ID>":"<OPTIONS-ID>"}
        }}}'
```

Antwort bei Erfolg: `{"success":true,"docId":"…","databaseBlockId":"…","rowId":"…"}`

**Neue Auswahlwerte** (etwa ein zusätzliches Projekt) legt ein Mensch in der Oberfläche an — der
Validator akzeptiert nur bereits konfigurierte Optionen.

---

## Fehlermeldungen und ihre Bedeutung

| Meldung                                                 | Ursache                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Database column X not found`                           | Spalten-Kennung falsch, oder Name statt Kennung übergeben                    |
| `Database column X requires a configured select option` | Sichtbarer Text statt Options-Kennung übergeben, oder Option existiert nicht |
| `Database column X type rich-text is not supported`     | Textspalte — noch nicht schreibbar                                           |
| `Block X is not an AFFiNE database`                     | Blockkennung zeigt auf einen anderen Block                                   |
| `unsupported block flavour: affine:database`            | `update_document` auf einem Dokument mit Tabelle                             |
| `Doc with id X not found`                               | Falsche Dokument-ID, oder der Token gehört zu einem anderen Workspace        |

---

## Sicherheitsgrenzen im Code

Die Umsetzung prüft mehr, als man auf den ersten Blick sieht:

- Der Zielblock muss tatsächlich `affine:database` sein
- Die Spalte muss existieren; Auswahlwerte werden gegen die **echten Optionen des Dokuments**
  geprüft
- Prototype-Pollution wird abgewehrt (`__proto__`, `constructor`, `prototype` als Kennung abgelehnt)
- Es braucht `Doc.Update`-Berechtigung **und** eine `READ_WRITE`-Zugangsberechtigung
- Zahlen und Datumswerte müssen endlich sein

**Zugriff entziehen:** Token in AFFiNE widerrufen oder durch einen Read-Only-Token ersetzen. Der
Zugriffsmodus der Zugangsberechtigung ist im Fork das einzige Tor.

---

## Bekannte Aufgaben

| Thema                         | Stand                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Textspalten schreibbar machen | Kleinste offene Erweiterung — ein Zweig im Validator von `packages/backend/server/src/core/doc/database-row.ts` |
| Upstream 0.28                 | Bringt vermutlich eine native Lösung; dann diese Übernahme ablösen (LESSONS #15)                                |
| `semantic_search`             | Braucht einen Embedding-Schlüssel (Gemini) unter Settings → Integrations → AI BYOK                              |
