# Bauen und auf helios ausrollen

**Zielsystem:** helios (192.168.8.206), NixOS, x86_64, 16 Kerne, 62 GB RAM
**Dienst:** `affine.wefers.club` (Caddy → `127.0.0.1:8099` → Podman-Container)
**NixOS-Modul:** `modules/services/web/affine/default.nix` im Repo `Phynix88/nixos`

---

## Warum auf helios gebaut wird

Das Image wird **nicht** auf dem Mac gebaut: helios ist x86_64, der Mac ARM. Ein dort gebautes
natives Modul ist auf helios unbrauchbar.

Gebaut wird **im Container**, damit helios selbst weder Node noch Rust noch Yarn braucht. Das
Containerfile bringt die gesamte Werkzeugkette mit.

**Der Bau ist bewusst nicht automatisiert.** Ein systemd-Dienst, der ihn beim Start auslöst, wäre
falsch: Er dauert rund 20 Minuten, braucht Netzzugang zu crates.io und npm, und würde bei einem
Fehlschlag den Dienststart blockieren. Fehlt das Image, startet der Container nicht — das ist das
gewünschte laute Scheitern.

---

## Bauen

```bash
ssh dominikw@192.168.8.206

# Fork holen oder aktualisieren
git clone -b cockpit https://github.com/Phynix88/affine-fork.git ~/affine-fork
cd ~/affine-fork && git pull origin cockpit

# Bauen, entkoppelt von der SSH-Sitzung (sonst stirbt er beim Verbindungsabbruch)
SHA=$(git rev-parse HEAD)
sudo setsid nohup sh -c "podman build --build-arg GITHUB_SHA=$SHA \
  -f docker/cockpit/Containerfile -t localhost/affine-cockpit:0.27.3 . \
  > /tmp/affine-image-build.log 2>&1; echo BUILD_EXIT=\$? > /tmp/affine-image-exit.txt" \
  < /dev/null > /dev/null 2>&1 &
```

**Fortschritt verfolgen** (der Bau läuft eigenständig weiter, auch wenn die Sitzung endet):

```bash
grep -E 'STEP [0-9]+/' /tmp/affine-image-build.log | tail -1   # aktueller Schritt
cat /tmp/affine-image-exit.txt                                  # erscheint erst am Ende
```

**Dauer:** rund 20 Minuten. Der längste Einzelposten ist das native Rust-Modul (Schritt 10 von 16).

---

## Ergebnis prüfen — vor jedem Deploy

Der Exit-Code allein genügt nicht (siehe LESSONS #2). Diese vier Prüfungen laufen:

```bash
IMG=localhost/affine-cockpit:0.27.3

# 1. Baute es überhaupt?
cat /tmp/affine-image-exit.txt                    # erwartet: BUILD_EXIT=0
sudo podman images | grep affine-cockpit          # erwartet: ~670 MB

# 2. Ist das neue Werkzeug drin?
sudo podman run --rm --entrypoint sh $IMG -c 'grep -c append_database_row /app/dist/main.js'
# erwartet: 1

# 3. Ist die Dev-Sperre entfernt?
sudo podman run --rm --entrypoint sh $IMG -c \
  'grep -o "mcpCredentialReadWriteAvailable(){[^}]*}" /app/dist/main.js'
# erwartet: mcpCredentialReadWriteAvailable(){return!0}

# 4. Ist die Laufzeit vollständig?
sudo podman run --rm --entrypoint sh $IMG -c \
  'ls /app/dist/*.node; ls /app/node_modules | wc -l; ls /app/static/index.html'
# erwartet: server-native.x64.node · ~397 Pakete · index.html
```

**Die Größe ist ein Frühindikator:** Rund 400 MB statt 670 MB bedeutet, dass `node_modules` fehlt
— das Image würde beim Start sterben (LESSONS #1).

Das Containerfile prüft das Wichtigste bereits selbst; im Log erscheinen dann
`Stufe 1 vollstaendig: …` und `native Bibliothek ladbar`.

---

## Ausrollen

```bash
# 1. Sicherung, geprüft statt nur ausgelöst
ssh dominikw@192.168.8.206 "sudo systemctl start backup-affine.service && \
  sudo ls -la /var/backup/affine/ && sudo zcat /var/backup/affine/affine.sql.gz | wc -l"

# 2. Aktivieren OHNE Bootloader-Eintrag (Sicherheitsnetz)
cd ~/homelab/'Homelab NixOS' && just test

# 3. Verifizieren
ssh dominikw@192.168.8.206 "systemctl --failed --no-legend --plain; \
  systemctl is-active podman-affine-server affine-migration; \
  sudo podman ps --format '{{.Names}} {{.Image}}' | grep affine-server"
curl -s -o /dev/null -w '%{http_code}\n' https://affine.wefers.club/     # erwartet 200
curl -s -o /dev/null -w '%{http_code}\n' https://notes.wefers.club/      # AppFlowy unberührt

# 4. Funktionstest: sind es sieben Werkzeuge?
curl -s -X POST "https://affine.wefers.club/api/workspaces/<WS-ID>/mcp" \
  -H "Authorization: Bearer <TOKEN>" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# 5. Permanent machen
just switch
```

**Rückweg:** `sudo nixos-rebuild switch --rollback` auf helios. Das alte Upstream-Image bleibt
lokal vorhanden; im Modul genügt es, `image` wieder darauf zu zeigen. Daten liegen in
`/var/lib/affine` und werden vom Wechsel nicht berührt.

---

## Nach einem Upstream-Versionssprung

1. Im Fork: `git fetch upstream --tags`, dann auf den neuen Tag rebasen. Die vier
   Änderungsstellen sind klein und klar abgegrenzt (siehe `docs/fork/README.md`).
2. **Prüfen, ob 0.28 die native Schreiblösung mitbringt** — dann entfällt die PR-Übernahme
   ersatzlos (LESSONS #15).
3. `version` im NixOS-Modul und im Image-Tag mitziehen.
4. Neu bauen, die vier Prüfungen oben laufen lassen, dann ausrollen.

---

## Verwandte Dokumente

| Dokument                                              | Inhalt                                                |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `docs/fork/README.md`                                 | Was der Fork ist, Entwicklungsumgebung auf dem Mac    |
| `docs/fork/LESSONS-LEARNED.md`                        | Warum die Dinge so sind — 17 Lektionen aus dem Aufbau |
| `docs/fork/MCP-TOOLS.md`                              | Die MCP-Werkzeuge, ihre Grenzen und der Arbeitsablauf |
| NixOS-Repo: `modules/services/web/affine/default.nix` | Die Bereitstellung auf helios                         |
