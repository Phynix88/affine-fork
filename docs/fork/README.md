# AFFiNE-Fork für das PO-Cockpit

Fork von `toeverything/AFFiNE`, Basis: Tag **`v0.27.3`** (die Version, die auf helios produktiv
läuft). Branch: **`cockpit`**.

**Zweck:** AFFiNE um Fähigkeiten erweitern, die das Product-Owner-Cockpit braucht und die es
upstream nicht gibt. Erste Erweiterung: Datenbank-Zeilen über den MCP schreiben.

**Update-Kompatibilität zum Upstream ist ausdrücklich kein Ziel.** Wo eine saubere Lösung eine
Modelländerung verlangt, ist sie erlaubt.

---

## Bauen und starten

Voraussetzungen: Node **22.12.x** (über `fnm`, das Repo verlangt `>=22.12 <23`), Yarn 4.13 über
Corepack, Rust-Toolchain, Docker/OrbStack.

```bash
fnm install 22.12.0
fnm exec --using=22.12.0 corepack enable   # WICHTIG: unter fnm, nicht mit dem System-Node
fnm exec --using=22.12.0 yarn install

# Natives Modul (braucht Rust, ~7 Minuten)
fnm exec --using=22.12.0 yarn affine @affine/server-native build

# Dev-Dienste (Postgres 5432, Redis 6379, Mailpit 1025/8025, Manticore 9308)
cp ./.docker/dev/compose.yml.example ./.docker/dev/compose.yml
cp ./.docker/dev/.env.example ./.docker/dev/.env
docker compose -f ./.docker/dev/compose.yml up -d

# Datenbank (NICHT `yarn affine server init` -- das haengt an einer interaktiven Rueckfrage)
cd packages/backend/server
yarn prisma migrate deploy
cd ../../..
fnm exec --using=22.12.0 yarn affine @affine/server data-migration run

# Frontend (PUBLIC_PATH ist Pflicht, sonst laedt die App von AFFiNEs CDN)
PUBLIC_PATH=/ fnm exec --using=22.12.0 yarn affine @affine/web build
ln -sfn "$PWD/packages/frontend/apps/web/dist" packages/backend/server/static

fnm exec --using=22.12.0 yarn affine server dev
```

Die Instanz läuft auf **http://localhost:3010**. Anmeldung: `dev@affine.pro` / `dev`.

### `packages/backend/server/.env`

Nicht versioniert, aber ohne diese Werte läuft nichts:

```
NODE_ENV=development          # sonst faellt env.dev auf "production" und der gesamte
                              # READ_WRITE-Block der MCP-Werkzeuge bleibt gesperrt (src/env.ts)
DEPLOYMENT_TYPE=selfhosted    # sonst rendert der Doc-Renderer Asset-Pfade auf AFFiNEs CDN,
                              # und jede /workspace/...-Route bleibt weiss
DATABASE_URL="postgres://affine:affine@localhost:5432/affine"
REDIS_SERVER_HOST=localhost
MAILER_HOST=127.0.0.1
MAILER_PORT=1025
```

### Stolpersteine, die Zeit kosten

| Symptom                                                              | Ursache und Abhilfe                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn: command not found` beim Bauen oder Committen                  | Corepack wurde mit dem System-Node aktiviert. `fnm exec --using=22.12.0 corepack enable`; für Git-Hooks `PATH="$HOME/.local/share/fnm/node-versions/v22.12.0/installation/bin:$PATH"` |
| `Unknown file extension ".ts"` bei Tests                             | AVA direkt aufgerufen. Tests laufen nur über `yarn affine @affine/server test <datei>` — nur die CLI injiziert den TypeScript-Loader                                                  |
| `yarn affine server init` hängt                                      | `prisma migrate dev` fragt interaktiv nach einem Migrationsnamen. Stattdessen `prisma migrate deploy` + `data-migration run`                                                          |
| Seite lädt weiß, Konsole zeigt CORS-Fehler zu `dev.affineassets.com` | Frontend ohne `PUBLIC_PATH=/` gebaut, oder `DEPLOYMENT_TYPE` nicht auf `selfhosted`                                                                                                   |
| Workspace hängt ewig bei „Syncing…"                                  | Per GraphQL `createWorkspace` erzeugte Workspaces haben kein Wurzeldokument. Workspace über die Oberfläche anlegen oder einen lokalen per „Enable Cloud" hochziehen                   |

## Tests

```bash
fnm exec --using=22.12.0 yarn affine @affine/server test src/core/doc/__tests__/database-row.spec.ts
fnm exec --using=22.12.0 yarn affine @affine/server test src/core/doc/__tests__/database-preservation.spec.ts
```

Ein verzeichnisweiter Lauf zieht Tests mit, die eine eingerichtete Datenbank brauchen.

**Typprüfung gegen Baseline, nicht gegen null:** `tsc --noEmit` meldet im unveränderten `v0.27.3`
bereits 64 Fehler (überwiegend `TS6305`, nicht gebaute Teilpakete). Maßgeblich ist, dass unsere
Änderungen keinen weiteren hinzufügen.

---

## Abweichungen vom Upstream

### `append_database_row` (MCP-Werkzeug)

Hängt eine Zeile an einen bestehenden `affine:database`-Block an. Übernommen aus dem **nicht
gemergten** Upstream-PR [#15369](https://github.com/toeverything/AFFiNE/pull/15369).

Der PR wurde abgelehnt, weil Yjs serverseitig für AFFiNEs Cloud zu speicherhungrig ist und eine
native y-octo-Lösung für 0.28 geplant ist. Für eine Einzelnutzer-Instanz trifft dieser Grund nicht
zu. **Sobald 0.28 die native Lösung bringt, wird diese Übernahme ersetzt.**

**Grenzen:** Nur Zellen der Typen `number`, `date`, `checkbox`, `select`; alles andere wirft — auch
`rich-text`, also Textspalten. Auswahlwerte müssen als **Options-Kennung** übergeben werden
(`data-value` aus `read_document`), nicht als sichtbarer Text. Legt keine Datenbanken oder Spalten
an und löscht nichts.

**Ablauf in der Praxis:** Dokument mit `read_document` lesen → Options-Kennungen entnehmen →
Blockkennung aus dem DOM holen (`document.querySelector('affine-database').closest('[data-block-id]').dataset.blockId`)
→ `append_database_row` aufrufen.

**Belegt am 2026-07-31** auf der Dev-Instanz: Zeile geschrieben, über `read_document` mit korrekter
Options-Kennung zurückgelesen, im Editor als echte Kanban-Karte mit Auswahl-Chip sichtbar, und der
Auswahl-Editor öffnet sich beim Klick auf die Zelle. Screenshot: `tests/fork/screenshots/append-row-ok.png`.

### Erhaltungstest (kein Code, aber wichtiges Wissen)

`src/core/doc/__tests__/database-preservation.spec.ts` schreibt ein Verhalten von `v0.27.3` fest:
**`update_document` scheitert auf jedem Dokument, das eine Datenbank enthält**, mit
`unsupported block flavour: affine:database`. Es wird nichts geschrieben — Datenverlust ist also
ausgeschlossen, aber der Fließtext solcher Dokumente ist über den MCP nicht änderbar.

Der Schreibpfad des Crates `affine_doc_loader` kennt nur zehn Blocktypen: `paragraph`, `list`,
`code`, `divider`, `image`, `callout`, `bookmark`, `embed-iframe`, `embed-youtube`, `table` (die
einfache Tabelle, nicht `database`). Ebenfalls nicht unterstützt und damit blockierend: LaTeX,
Anhänge, Whiteboard-Inhalte und **verlinkte Dokumente** (`embed-linked-doc`).

**Folge für den Cockpit-Aufbau:** Erzählender Text und Tabellen gehören in getrennte Dokumente.
