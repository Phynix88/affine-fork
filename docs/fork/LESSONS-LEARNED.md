# Lessons Learned — AFFiNE selbst bauen und erweitern

**Zweck:** Alles, was beim Aufsetzen, Bauen, Erweitern und Ausrollen dieses Forks Zeit gekostet
hat — damit es das kein zweites Mal tut. Jede Lektion beschreibt Symptom, Ursache und Abhilfe.

**Stand:** 2026-07-31 · **Basis:** `toeverything/AFFiNE` Tag `v0.27.3`, Branch `cockpit`

> **Die Nummern sind stabil.** Andere Dokumente verweisen darauf. Beim Ergänzen hinten anhängen,
> nie umnummerieren.

---

## Die wichtigste Lektion zuerst

**#1 — Das Dockerfile ist nicht die Bau-Anleitung. Die CI-Workflow-Datei ist es.**

`.github/deployment/node/Dockerfile` sieht aus wie ein vollständiges Bau-Rezept, ist aber nur der
**Verpackungsschritt** am Ende von AFFiNEs CI. Es kopiert fertige Artefakte und setzt stillschweigend
voraus, dass vorher fünf Dinge passiert sind. Maßgeblich ist
**`.github/workflows/build-images.yml`, Job `build-images`**:

```
1. yarn workspaces focus @affine/server --production
2. yarn workspace @affine/server prisma generate
3. mv ./node_modules ./packages/backend/server      <-- der Schlüsselschritt
4. native Bibliothek als ECHTE Datei server-native.<arch>.node nach packages/backend/native
5. Frontends in ihre jeweiligen dist/-Verzeichnisse
```

**Schritt 3 ist der, an dem alles hängt:** Das Dockerfile kopiert nur
`packages/backend/server` nach `/app`. `node_modules` kommt ausschließlich mit, **weil die CI es
vorher dorthin verschiebt**. Ohne diesen Handgriff baut das Image sauber durch, ist 270 MB kleiner
— und der Server stirbt beim Start.

**Kosten dieser Erkenntnis:** acht Bauversuche. Sechs davon entstanden, weil Fehler einzeln behoben
statt die Anforderungen einmal vollständig ermittelt wurden. Die Datei lag die ganze Zeit im Repo.

**Merke:** Bei jedem fremden Projekt, das sich nicht bauen lässt — erst die CI-Definition lesen.
Sie ist die einzige ausführbare Wahrheit darüber, was der Bau wirklich braucht.

---

## Bauen

### #2 — Ein Exit-Code ist eine Behauptung, kein Beweis

Drei Mal an einem Tag hat ein grüner Rückgabewert gelogen:

| Fall           | Was passierte                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `yarn install` | Befehlskette endete auf `tail`; der Exit-Code kam von dort. `node_modules` existierte gar nicht |
| Frontend-Bau   | `Internal Error: Failed to open git repo`, trotzdem Exit 0 — und **kein** `dist/` erzeugt       |
| Image-Bau      | Meldete Erfolg; das Image startete nie, weil `node_modules` fehlte                              |

**Abhilfe, konsequent angewandt:**

- Exit-Code direkt am gemeinten Befehl abgreifen, nicht am Ende einer Kette:
  `podman build … > log 2>&1; echo "EXIT=$?" > exitfile`
- **Zusätzlich am Ergebnis prüfen.** Das Containerfile enthält deshalb nach jeder Stufe eine
  Existenzprüfung aller Artefakte und im Laufzeit-Image ein
  `node -e "require('/app/dist/server-native.x64.node')"`.

### #3 — Langlaufende Bauten von der SSH-Sitzung entkoppeln

**Symptom:** Der Bau läuft, dann meldet die Hintergrund-Aufgabe „exit code 1", und wenig später ist
kein Prozess mehr da — ohne Fehlermeldung im Log.

**Ursache:** Der Bau lief im Vordergrund einer SSH-Sitzung. Bricht die Verbindung ab, bekommt der
Prozess SIGHUP und stirbt mit ihr.

**Abhilfe:**

```bash
sudo setsid nohup sh -c "podman build … > /tmp/build.log 2>&1; echo EXIT=\$? > /tmp/build.exit" \
  < /dev/null > /dev/null 2>&1 &
```

Fortschritt danach über die Logdatei verfolgen, nicht über die Sitzung.

### #4 — Den gesamten Baukontext kopieren, nicht einzelne Verzeichnisse

**Symptom:** `yarn install --immutable` bricht mit `YN0002: … doesn't provide graphql, requested by
@affine/error` ab. Später: `ENOENT: no such file or directory, open '/src/tsconfig.json'`.

**Ursache:** Eine Auswahl von `COPY`-Zeilen sieht cache-freundlich aus, lässt aber unweigerlich
etwas aus. Konkret fehlten nacheinander die Workspaces `docs/reference` und `tests/*` (fehlen sie,
löst Yarn die Abhängigkeiten anders auf und der strenge Modus bricht ab) sowie die
Root-`tsconfig.json`, die `affine init` im Postinstall liest. Als Nächstes wären
`rust-toolchain.toml`, `.npmrc` und die übrigen `tsconfig.*.json` gefolgt.

**Abhilfe:** `COPY . .` — die mitgelieferte `.dockerignore` hält `node_modules`, `target/` und
Testartefakte ohnehin draußen. **Vollständigkeit schlägt Cache-Optimierung.**

### #5 — `HUSKY=0` beim Container-Bau

**Symptom:** `YN0009: @affine/monorepo@workspace:. couldn't be built successfully`.

**Ursache:** Das Postinstall lautet `yarn affine init && yarn husky`. Husky richtet Git-Hooks ein
und scheitert ohne `.git`-Verzeichnis, das die `.dockerignore` ausschließt.

**Abhilfe:** `ENV HUSKY=0` vor `yarn install`.

**Diagnose-Kniff:** Yarn schreibt das Log fehlgeschlagener Build-Skripte nach `/tmp/xfs-*/build.log`
— das verschwindet mit dem Container. Sichtbar machen mit:
`RUN yarn install --immutable || (cat /tmp/xfs-*/build.log; exit 1)`

### #6 — `GITHUB_SHA` statt Git-Repository

**Symptom:** Der Frontend-Bau meldet `Internal Error: Failed to open git repo: /src/`, läuft mit
**Exit 0** durch und erzeugt trotzdem kein `dist/`.

**Ursache:** `tools/cli/src/rspack-shared/html-plugin.ts` liest den Commit-Hash aus dem Repository.

**Abhilfe:** `GITHUB_SHA` setzen — der dafür vorgesehene Ausweg für CI-Umgebungen:

```dockerfile
ARG GITHUB_SHA=cockpit-local-build
ENV GITHUB_SHA=${GITHUB_SHA}
```

### #7 — Die native Bibliothek muss eine echte Datei sein, kein Symlink

**Symptom (erst):** `Module not found: Can't resolve './server-native.x64.node'`.
**Symptom (nach Symlink-Abhilfe):** Bau läuft durch, aber `/app/dist` enthält keine `.node`-Datei.

**Ursache, zweiteilig:** `napi build` erzeugt `server-native.node` ohne Architektur-Suffix. Zur
Laufzeit genügt das, denn `packages/backend/native/index.js` lädt genau diese Datei zuerst und
greift nur im `catch`-Zweig auf die arch-spezifischen Namen zurück. Der **Bundler** aber löst alle
`require`-Aufrufe statisch auf, auch den nie ausgeführten Fallback — und er kopiert nur **echte
Dateien** als Asset nach `dist/`. Symlinks befriedigen den Auflöser, landen aber nirgends.

**Abhilfe:**

```dockerfile
RUN yarn affine @affine/server-native build && \
    cd packages/backend/native && \
    for a in x64 arm64 armv7; do cp server-native.node "server-native.$a.node"; done
```

`docker-clean.mjs` wirft die überflüssigen Architekturen später weg
(`pruneServerNative(distDir, keepArch)`).

### #8 — `PUBLIC_PATH=/` ist für selbstgehostete Instanzen Pflicht

**Symptom:** Seite bleibt weiß, Konsole zeigt CORS-Fehler zu `dev.affineassets.com`.

**Ursache:** Ein Produktionsbau zieht seine Assets von AFFiNEs CDN.

**Abhilfe:** `ENV PUBLIC_PATH=/` vor dem Frontend-Bau.

---

## Entwicklungsumgebung

### #9 — Corepack unter `fnm` aktivieren, nicht mit dem System-Node

**Symptom:** `error: Can't spawn program: yarn does not exist or not available in PATH`.

**Ursache:** `corepack enable` legt die Shims im bin-Verzeichnis **des gerade aktiven Node** ab. Mit
dem System-Node aktiviert, fehlt Yarn unter der `fnm`-Version.

**Abhilfe:** `fnm exec --using=22.12.0 corepack enable`.
Für Git-Hooks (Husky beim Committen) zusätzlich:
`export PATH="$HOME/.local/share/fnm/node-versions/v22.12.0/installation/bin:$PATH"`

### #10 — Tests laufen nur über die `affine`-CLI

**Symptom:** `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"`.

**Ursache:** `ava.config.js` deklariert `extensions: { ts: 'module' }`, bringt aber keinen Loader
mit. Den injiziert die CLI über `NODE_OPTIONS --import=<loader>` (`tools/cli/src/run.ts`).

**Abhilfe:**

```bash
yarn affine @affine/server test src/core/doc/__tests__/database-row.spec.ts
```

Ein verzeichnisweiter Lauf zieht Tests mit, die eine eingerichtete Datenbank brauchen — gezielt
einzelne Dateien angeben.

### #11 — `yarn affine server init` hängt an einer interaktiven Rückfrage

**Symptom:** Der Befehl bleibt bei `Enter a name for the new migration:` stehen.

**Ursache:** `prisma migrate dev` fragt interaktiv nach.

**Abhilfe:**

```bash
cd packages/backend/server && yarn prisma migrate deploy
cd ../../.. && yarn affine @affine/server data-migration run
```

### #12 — `NODE_ENV` und `DEPLOYMENT_TYPE` müssen gesetzt werden

Beide fehlen in `.env.example` (die vollständig auskommentiert ist) und haben Voreinstellungen, die
für eine lokale Instanz falsch sind:

| Variable                     | Ohne sie                                                         | Warum                                                                                              |
| ---------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `NODE_ENV=development`       | Der gesamte `READ_WRITE`-Block der MCP-Werkzeuge bleibt gesperrt | `env.ts` setzt sonst `production`                                                                  |
| `DEPLOYMENT_TYPE=selfhosted` | Jede `/workspace/…`-Route bleibt weiß                            | Der Doc-Renderer rendert serverseitig und nutzt lokale Asset-Pfade nur, wenn `env.selfhosted` gilt |

Im **Fork** ist die MCP-Sperre im Quellcode entfernt; `NODE_ENV` betrifft dort nur noch andere
Entwicklungs-Bequemlichkeiten.

### #13 — Typprüfung gegen die Baseline messen, nicht gegen null

`tsc --noEmit -p packages/backend/server/tsconfig.json` meldet im **unveränderten** `v0.27.3`
bereits **64 Fehler**, überwiegend `TS6305` (nicht gebaute Teilpakete des Monorepos).

**Vorgehen:** Vor der Änderung die Zahl feststellen (`git stash` + messen), danach vergleichen.
Maßgeblich ist, dass die eigene Änderung keinen weiteren Fehler hinzufügt.

### #14 — Per GraphQL erzeugte Workspaces sind unbrauchbar

**Symptom:** Der Workspace hängt ewig bei „Syncing…", die Oberfläche bleibt im Ladezustand, und
`create_document` scheitert mit `Workspace … not found or has no root document`.

**Ursache:** `createWorkspace` legt nur den Datenbankeintrag an. Das Wurzeldokument (die
CRDT-Struktur) erzeugt der Client.

**Abhilfe:** Workspace über die Oberfläche anlegen, oder einen lokalen über „Enable Cloud"
hochziehen. Letzteres vergibt eine **neue** Workspace-ID — MCP-Token danach neu ausstellen.

---

## Das MCP-Werkzeug `append_database_row`

### #15 — Herkunft und Ablösepfad

Übernommen aus dem **nicht gemergten** Upstream-PR
[#15369](https://github.com/toeverything/AFFiNE/pull/15369) (eingereicht 2026-07-28, geschlossen
2026-07-29). 564 Zeilen in vier Dateien, davon 211 Zeilen Tests.

**Ablehnungsgrund des Maintainers:** Yjs sei serverseitig zu speicherhungrig, AFFiNE nutze dafür
y-octo; eine native Lösung sei **für 0.28 geplant**. Für eine Einzelnutzer-Instanz trifft das
Argument nicht zu — `yjs` ist im Backend ohnehin Abhängigkeit.

**Wenn 0.28 erscheint:** Prüfen, ob die native Lösung enthalten ist. Falls ja, diese Übernahme
ersatzlos streichen. Sie ist bewusst als Zwischenlösung gebaut.

### #16 — Grenzen, die man beim Schreiben kennen muss

**Sechs Zelltypen** werden akzeptiert: `number`, `date` (Zeitstempel als Zahl), `checkbox`,
`select` (eine Options-Kennung), `multi-select` (**Array** von Options-Kennungen) und `rich-text`
(String). Betroffen sind noch `progress`, `image`, `member` und `link`.

> **Multi-Select und Rich-Text kamen am 2026-07-31 dazu**, sie sind nicht Teil des Upstream-PR.
> Die Speicherformen wurden vorher an einem Live-Dokument gemessen — siehe #18.

Bei allem anderen wirft der Validator.

**Auswahlwerte sind Options-Kennungen, nicht sichtbarer Text.** Der Ablauf ist immer:

```
read_document  ->  data-value="…" aus der Antwort entnehmen
                ->  Blockkennung aus dem DOM holen
                ->  append_database_row aufrufen
```

Blockkennung in der Browser-Konsole:

```javascript
document.querySelector('affine-database').closest('[data-block-id]').dataset.blockId;
```

**Nicht enthalten:** Datenbanken oder Spalten anlegen, Zeilen oder Spalten löschen.

### #17 — `update_document` scheitert an Datenbanken, zerstört sie aber nicht

**Verhalten:** Ein Markdown-Update auf einem Dokument mit Datenbank bricht ab mit
`parser_error: unsupported block flavour: affine:database`. Es wird **nichts** geschrieben —
Datenverlust ist strukturell ausgeschlossen. Festgehalten in
`src/core/doc/__tests__/database-preservation.spec.ts`.

**Der Grund ist bauartbedingt:** Ein Update ist ein struktureller Abgleich. Dafür muss der Server
das bestehende Dokument erst vollständig _verstehen_ — und sein Verständnis reicht nur über die
Blocktypen, die er selbst schreiben kann. Das Anlegen funktioniert, weil dort nichts gelesen wird.

**Der Schreibpfad kennt genau zehn Typen:** `paragraph`, `list`, `code`, `divider`, `image`,
`callout`, `bookmark`, `embed-iframe`, `embed-youtube`, `table` (die _einfache_ Tabelle, nicht
`database`). Ebenfalls blockierend: LaTeX, Anhänge, Whiteboard-Inhalte und — praktisch am
wichtigsten — **verlinkte Dokumente** (`embed-linked-doc`), die beim „Link to page" entstehen.

**Folge für die Ablage:** Erzählender Text und Tabellen gehören in **getrennte Dokumente**. Sonst
ist der Fließtext eines Dokuments für die Automatisierung dauerhaft gesperrt.

---

### #18 — Speicherformen messen, nicht aus dem Typ ableiten

Beim Ergaenzen von Multi-Select und Rich-Text war die entscheidende Frage, **wie** die Werte im
Yjs liegen. Aus dem Frontend-Modell liest man `zod.array(zod.string())` — daraus folgt aber nicht,
ob daraus ein `Y.Array` oder ein einfaches Array wird.

**Vorgehen, das die Frage endgueltig beantwortet hat:** In einem echten Dokument ueber die
Browser-Konsole eine Zelle so setzen, wie es die Oberflaeche intern tut
(`m.props.cells[rowId][colId] = { columnId, value }`), und dann ueber `read_document` zuruecklesen.

**Ergebnis:**

| Typ            | Speicherform                                                                |
| -------------- | --------------------------------------------------------------------------- |
| `select`       | String — eine Options-Kennung                                               |
| `multi-select` | **einfaches Array** von Options-Kennungen, ausdruecklich **kein** `Y.Array` |
| `rich-text`    | **`Y.Text`**, damit die Zelle kollaborativ editierbar bleibt                |

Nur Rich-Text weicht damit von der reinen Durchreichung ab; `writeCells` liest dafuer die
Spaltentypen aus dem Block.

**Merke:** Ein Typ im Quellcode beschreibt die Schnittstelle, nicht die Ablage. Wo beides
auseinanderfallen kann, ist die Messung am lebenden System billiger als ein falscher Deploy.

---

## Offene Punkte

| Thema                                      | Stand                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| ~~Textspalten und Multi-Select~~           | **Erledigt 2026-07-31**, siehe #18                                                                        |
| Auswahloptionen anlegen                    | Kann der MCP nicht. Anleitung fuer die Browser-Konsole in `MCP-TOOLS.md`                                  |
| Upstream 0.28                              | Bringt vermutlich die native Lösung; dann #15 ablösen                                                     |
| Datenbanken/Spalten anlegen                | Bewusst nicht enthalten. Schemata bleiben Handarbeit in der Oberfläche                                    |
| Relationen, Rollups, relative Datumsfilter | Fehlen in AFFiNE. Stehen auf der Reibungsliste, aber erst umsetzen, wenn sie im Alltag wirklich schmerzen |
