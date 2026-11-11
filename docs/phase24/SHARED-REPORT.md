# Shared code: what moved, what drifted

Phase 24, Part D. One slice of the Python work. Every move below was proved first: `ast.dump` of each definition
(docstrings left out) is the same in both original files at the commit before the move. Nothing that differs by one
token was moved. The drifted copies in section 2 are for the owner to decide; nothing in section 2 was merged.

## 1. What moved

Each pair is one commit, so one failure can be dropped alone.

| Pair | Into | Names | Lines |
|---|---|---|---|
| HK Frontend `kinds.py` + Mantel Server `hidden.py` | `hk_core/settings/kind_match.py` | `Candidate`, `matches`, `automatic`, `legacy`, `resolve`, `SHOW_AS_KIND`, `accessories_over` | 94 |
| HK Frontend `accessories.py` + Mantel Server `accessories.py` | `hk_core/settings/accessory_fields.py` | 12 patterns and lists, `blank`, `_ids`, `clean_entity` | 72 |
| HK Frontend `linked_mode.py` + Mantel Link `entity.py` | `hk_core/link/linked_reserved.py` | `_RESERVED` only | 3 |
| Mantel Link `pairing.py` + Mantel Server `linked_pairing.py` | `hk_core/pairing.py` | `VERSION`, `PINNED`, `PATH`, `_HOSTNAME`, `_SCHEMES`, `normalize_address`, `_mac` | 31 |
| HK Frontend `features/live_tv/stream.py` + Mantel Link `tv.py` | `hk_core/link/tv_stream.py` | `BENIGN`, `QUALITY`, `ffmpeg_args` | 24 |

The 12 patterns and lists: `SHOW_AS`, `SIZES`, `ANIMS`, `COLORS`, `ENTITY`, `ICON`, `AREA`, `PATH`, `PAGE_ORDERS`, `ATTR`,
`FIELDS`, `FAV_WITH_MAX`.

Every host module imports the names back, so each stays importable from where it was, and is the same object as the
`hk_core` one (checked in each built layout).

Notes on each pair:

- **kinds / hidden.** `suggest` differs and stays (section 2). The `Candidate` comments of the Home Assistant copy
  were kept; the server's shorter ones went with its copy.
- **accessories.** `clean` differs and stays (section 2). Two `# type: ignore[assignment]` comments were added in the
  new modules, because mypy now checks code that neither host had checked. Comments do not change the AST.
- **linked_mode / entity.** The finder counted 99 lines, but only `_RESERVED` can move. `LinkedSensor`,
  `LinkedBinarySensor`, `LinkedAlarmPanel` and `CLASSES` have the same AST in both files, but each names its own
  file's `LinkedEntity`, and the two `LinkedEntity` classes differ (section 2). Moving them would give both hosts one
  `LinkedEntity`. That is a decision, not a copy.
- **pairing.** `hk_core/link` is for the two Home Assistant integrations only (`tests/test_boundaries.py`: Mantel
  Server may not import it). So the shared module sits at the top of `hk_core/`. Mantel Link vendors only parts of
  `hk_core`, so `pairing.py` was added to its `publish.py` `CORE_PARTS`, its test `conftest.py`,
  `test_link_shared.py`, `tests/test_mantel_link.py` and `hk_core/README.md`. HK Frontend vendors all of `hk_core`
  and needed nothing. The pair is Mantel Link's `pairing.py` with the server's `linked_pairing.py`. Mantel Link's
  `pairing.py` and `mantel_connect/pairing.py` share no definition.
- **TV stream.** `_LOGGER` has the same AST in both files, but it is each file's own logger name, so it stays.
  `URL` and `TvStreamView` differ and stay. The two modules are HK Frontend's `stream.py` and Mantel Link's `tv.py`
  (Mantel Server's `live_tv.py` shares none of it).

Other exact copies the search found. Not moved: they were not in the list for this run.

- `pin` (6 lines): HK Frontend `art.py` and Mantel Server `connectors/media_art.py`.
- `source_of` (8 lines): HK Frontend `features/energy/plan.py` and Mantel Link `energy.py`.

### Checks

- Main suite, on the final tree: 7144 passed, 149 skipped. Along the way two tests needed the new files listed: the
  Code-map freshness test (`tools/code_map.py`) and the Mantel Link build test (`tests/test_mantel_link.py`).
- HK Frontend's own Python suite (built with `tools/build_ha.py`): 792 passed, 5 failed. The same 5 fail at the commit
  before this work (`test_flat`, the `test_settings_api` copy test, three `test_theme_values`): the scratch build has
  no `esbuild` and none of the web sources the theme generator reads.
- Mantel Link's tests (`tests/py/run`, with the built HK Frontend and this checkout): 88 passed, 1 skipped.
- `tools/typecheck/py_check.py`: no worse (only `hk_core/laundry.py`: 2, as on main; ruff 518, the baseline).

### The proof output (new module's AST against each original at the commit before)

Pair 1:

```
Candidate              new==HEAD:kinds.py True  new==HEAD:hidden.py True
matches                new==HEAD:kinds.py True  new==HEAD:hidden.py True
automatic              new==HEAD:kinds.py True  new==HEAD:hidden.py True
legacy                 new==HEAD:kinds.py True  new==HEAD:hidden.py True
resolve                new==HEAD:kinds.py True  new==HEAD:hidden.py True
SHOW_AS_KIND           new==HEAD:kinds.py True  new==HEAD:hidden.py True
accessories_over       new==HEAD:kinds.py True  new==HEAD:hidden.py True
```

Pair 2:

```
SHOW_AS                new==HEAD:accessories.py True  new==HEAD:accessories.py True
SIZES                  new==HEAD:accessories.py True  new==HEAD:accessories.py True
ANIMS                  new==HEAD:accessories.py True  new==HEAD:accessories.py True
COLORS                 new==HEAD:accessories.py True  new==HEAD:accessories.py True
ENTITY                 new==HEAD:accessories.py True  new==HEAD:accessories.py True
ICON                   new==HEAD:accessories.py True  new==HEAD:accessories.py True
AREA                   new==HEAD:accessories.py True  new==HEAD:accessories.py True
PATH                   new==HEAD:accessories.py True  new==HEAD:accessories.py True
PAGE_ORDERS            new==HEAD:accessories.py True  new==HEAD:accessories.py True
ATTR                   new==HEAD:accessories.py True  new==HEAD:accessories.py True
FIELDS                 new==HEAD:accessories.py True  new==HEAD:accessories.py True
FAV_WITH_MAX           new==HEAD:accessories.py True  new==HEAD:accessories.py True
blank                  new==HEAD:accessories.py True  new==HEAD:accessories.py True
_ids                   new==HEAD:accessories.py True  new==HEAD:accessories.py True
clean_entity           new==HEAD:accessories.py True  new==HEAD:accessories.py True
```

Pair 3:

```
_RESERVED              new==HEAD:linked_mode.py True  new==HEAD:entity.py True
```

Pair 4:

```
VERSION                new==HEAD:pairing.py True  new==HEAD:linked_pairing.py True
PINNED                 new==HEAD:pairing.py True  new==HEAD:linked_pairing.py True
PATH                   new==HEAD:pairing.py True  new==HEAD:linked_pairing.py True
_HOSTNAME              new==HEAD:pairing.py True  new==HEAD:linked_pairing.py True
_SCHEMES               new==HEAD:pairing.py True  new==HEAD:linked_pairing.py True
normalize_address      new==HEAD:pairing.py True  new==HEAD:linked_pairing.py True
_mac                   new==HEAD:pairing.py True  new==HEAD:linked_pairing.py True
```

Pair 5:

```
BENIGN                 new==HEAD:stream.py True  new==HEAD:tv.py True
QUALITY                new==HEAD:stream.py True  new==HEAD:tv.py True
ffmpeg_args            new==HEAD:stream.py True  new==HEAD:tv.py True
```

## 2. Same name, different code

Found by comparing the top-level functions and classes of every host module against every module of another host, by
name, at least 4 lines and at least 55% text in common. Docstrings are in the diffs, so some differences are only a
docstring or a comment. In a diff, `-` is the first file named and `+` the second.

### 2.1 Copies of each other (the real drift)

#### `clean`: HK Frontend `accessories.py` vs Mantel Server `accessories.py`

```diff
--- accessories.py
+++ accessories.py
@@ -1,2 +1,3 @@
 def clean(data: Any) -> dict[str, Any]:
+    """The whole document, checked (accessories.clean)."""
     data = data if isinstance(data, dict) else {}
@@ -11,6 +12,3 @@
         if isinstance(area, str) and AREA.match(area) and isinstance(ids, list):
-            seen: list[str] = []
-            for i in ids:
-                if isinstance(i, str) and ENTITY.match(i) and i not in seen:
-                    seen.append(i)
+            seen = _ids(ids)
             if seen:
@@ -19,4 +17,3 @@
             if isinstance(a, str) and isinstance(b, str) and AREA.match(a) and AREA.match(b) and a != b}
-    # one level only: a room shown inside one that is itself inside another
-    # goes straight to the outer one
+    # one level only: a room shown inside one that is itself inside another goes straight to the outer one
     into = {a: into.get(b, b) for a, b in into.items() if into.get(b, b) != a}
@@ -24,4 +21,3 @@
     pages = {k: v for k, v in pages.items() if v}
-    # a room's scenes row: its own list, kept EMPTY too (an empty list is "no
-    # row", not "automatic")
+    # a room's scenes row: its own list, kept EMPTY too (an empty list is "no row", not "automatic")
     scenes = {a: _ids(v) for a, v in (data.get("scenes") or {}).items()
```

Same behavior. The server calls `_ids` where HK Frontend repeats its loop, and its comments are shorter.
Recommendation: keep the server's (it uses the shared `_ids`), then `clean` can move to `hk_core` with the rest.

#### `suggest`: HK Frontend `kinds.py` vs Mantel Server `hidden.py`

```diff
--- kinds.py
+++ hidden.py
@@ -1,5 +1,2 @@
 def suggest(cands: list[Candidate], settings: Mapping[str, Any]) -> dict[str, dict[str, list[str]]]:
-    """What the Status & Chips page shows for each kind: what was saved, else an
-    old list turned into Leave out / Also count against what is found now (so
-    saving it counts exactly what was counted), else nothing (automatic)."""
     auto = automatic(cands, settings.get("generated"))
@@ -16,4 +13,3 @@
             continue
-        keep = set(old)
-        found = set(auto[name])
+        keep, found = set(old), set(auto[name])
         out[name] = {"exclude": [e for e in auto[name] if e not in keep],
```

Same behavior: one tuple assignment, and the docstring. Recommendation: keep HK Frontend's (it has the docstring),
then move it.

#### `_also`: HK Frontend `hiding.py` vs Mantel Server `hidden.py`

```diff
--- hiding.py
+++ hidden.py
@@ -1,7 +1,2 @@
-def _also(cands: list[kinds.Candidate], auto: Mapping[str, list[str]], want: set[str]) -> dict[str, list[str]]:
-    """The kinds each of `want` could ALSO be counted in: its domain is one
-    the kind's Also count offers, it isn't found there by itself -- and for
-    a reading (temperature, humidity), it reports that reading. Hidden or
-    disabled in Home Assistant are offered nothing; a group is offered what
-    its domain could be (never found by itself, so only ever added by hand)."""
+def _also(cands: list[Candidate], auto: Mapping[str, list[str]], want: set[str]) -> dict[str, list[str]]:
     out: dict[str, list[str]] = {}
@@ -11,3 +6,3 @@
         domain = c.entity_id.split(".", 1)[0]
-        ks = [k for k, kind in kinds.KINDS.items()
+        ks = [k for k, kind in KINDS.items()
               if domain in kind.also and c.entity_id not in auto[k]
```

Same behavior: `kinds.KINDS` against `KINDS`, and the docstring. Recommendation: keep HK Frontend's wording; it
moves once both name `KINDS` the same way.

#### `snapshot`: `hiding.snapshot` against `Hiding.snapshot` (a function against a method, so the finder does not pair them)

```diff
-        "devices": list(gen.get("exclude_devices") or []),
-        "areas": list(gen.get("exclude_areas") or []),
+        "devices": [d for d in gen.get("exclude_devices") or [] if isinstance(d, str)],
+        "areas": [a for a in gen.get("exclude_areas") or [] if isinstance(a, str)],
+        if not isinstance(a, Mapping):          # an accessory entry that is not a dict
+            a = {}
-        "order": ORDER,
+        "order": list(ORDER),
```

This one is real: the server drops non-string device and area ids and tolerates a bad accessory entry. HK Frontend
would send a bad id through. Recommendation: keep the server's (it is the safer one, and the document is user data).
The rest of `Hiding` (`room_entities`, `plan`, `also_plan`) makes the same decisions through a store and a registry
instead of `hass`.

#### `LinkedEntity`: HK Frontend `linked_mode.py` vs Mantel Link `entity.py`

```diff
--- linked_mode.py
+++ entity.py
@@ -6,3 +6,3 @@
 
-    def __init__(self, linked: Linked, desc: dict[str, Any]) -> None:
+    def __init__(self, linked: Any, desc: dict[str, Any]) -> None:
         self._linked, self._desc = linked, desc
@@ -20,6 +20,6 @@
             self._attr_device_info = DeviceInfo(
-                identifiers={(DOMAIN, dev["identifier"])}, name=dev.get("name"),
-                manufacturer=dev.get("manufacturer"), model=dev.get("model"), entry_type=DeviceEntryType.SERVICE)
-        if desc.get("entity_id"):
-            self.entity_id = desc["entity_id"]      # suggested; the registry keeps a known one
+                identifiers={(DOMAIN, dev["identifier"])}, name=device_name(dev.get("name")),
+                manufacturer=MANUFACTURER, model=dev.get("model"), entry_type=DeviceEntryType.SERVICE)
+        if suggested(desc.get("entity_id")):
+            self.entity_id = suggested(desc["entity_id"])   # suggested; the registry keeps a known one
 
```

On purpose: Mantel Link shows Mantel's device as "Mantel" and rewrites the `hk_frontend_` entity id prefix.
Recommendation: stay different. To share the classes below one day, make the device name and entity id two small hooks
on a shared base. That is a design step, not a copy.

#### `LinkedSwitch`: same files

```diff
--- linked_mode.py
+++ entity.py
@@ -16,3 +16,4 @@
     async def async_set_black_screen(self, black: bool | None = None, brightness: int | None = None) -> None:
-        """hk_frontend.set_black_screen, forwarded as called (one call per target)."""
+        """mantel.set_black_screen (or the alias hk_frontend.set_black_screen),
+        forwarded as called (one call per target)."""
         data: dict[str, Any] = {}
```

Docstring only. Recommendation: leave it (Mantel Link names its own service and the alias).

#### `LinkedCamera`: same files

```diff
--- linked_mode.py
+++ entity.py
@@ -1,3 +1,6 @@
 class LinkedCamera(LinkedEntity, Camera):
-    """Live TV's channels: the stream Mantel names, no still of its own."""
+    """Live TV's channels. A channel Mantel names in `features.tv` streams
+    through Mantel Link's own transcode (tv.py, this machine) and its still
+    is the programme's artwork (never a frame: that would take a tuner);
+    otherwise the stream Mantel names, no still of its own."""
 
@@ -5,5 +8,7 @@
 
-    def __init__(self, linked: Linked, desc: dict[str, Any]) -> None:
+    def __init__(self, linked: Any, desc: dict[str, Any]) -> None:
         Camera.__init__(self)
         LinkedEntity.__init__(self, linked, desc)
+        self._art_url: str | None = None
+        self._art: bytes | None = None
         self._picked: tuple[Any, ...] | None = None
@@ -13,3 +18,3 @@
     def supported_features(self) -> CameraEntityFeature:
-        return CameraEntityFeature.STREAM if self._source() else CameraEntityFeature(0)
+        return CameraEntityFeature.STREAM if self._tv() or self._source() else CameraEntityFeature(0)
 
@@ -17,7 +22,10 @@
     def async_write_ha_state(self) -> None:
-        # Home Assistant picks a camera's player (go2rtc's WebRTC, else HLS) in tasks that can
-        # race, the stale one finishing last: pick again, once it has settled, whenever the camera
-        # comes back or the stream Mantel names changes (Mantel Link's entity.py, the same).
+        # Home Assistant picks a camera's player (go2rtc's WebRTC, else HLS) when the camera is
+        # added and when its STREAM support changes -- in tasks that can race, the stale one
+        # finishing last. Live TV's channels were left with "no WebRTC" after the link to Mantel came
+        # back, and HK's player failed: pick again, once it has settled, whenever the camera comes
+        # back or its stream changes.
         super().async_write_ha_state()
-        key = (self.available, self._source())
+        tv = self._tv()
+        key = (self.available, tv and tv["source"], self._source())
         if key != self._picked:
@@ -45,2 +53,6 @@
 
+    def _tv(self) -> dict[str, Any] | None:
+        from .tv import channel_of
+        return channel_of(self._features)
+
     def _source(self) -> str | None:
@@ -50,2 +62,6 @@
     async def stream_source(self) -> str | None:
+        tv = self._tv()
+        if tv is not None:
+            from .tv import stream_url
+            return stream_url(self.hass, tv["channel"])
         return self._source()
@@ -53,2 +69,16 @@
     async def async_camera_image(self, width: int | None = None, height: int | None = None) -> bytes | None:
-        return None
+        tv = self._tv()
+        url = tv["image"] if tv else None
+        if not url:
+            return None
+        if url != self._art_url:
+            from homeassistant.helpers.aiohttp_client import async_get_clientsession
+            try:
+                async with async_get_clientsession(self.hass).get(url, timeout=10) as r:
+                    if r.status != 200 or not (r.content_type or "").startswith("image/"):
+                        return None
+                    body = await r.content.read(4_000_000)
+                self._art, self._art_url = body, url
+            except Exception:  # noqa: BLE001 -- no artwork: no picture
+                return None
+        return self._art
```

On purpose: Mantel Link serves Live TV through its own transcode (`tv.py`) and artwork; HK Frontend has no such path.
Recommendation: stay different.

#### `TvStreamView`: HK Frontend `stream.py` vs Mantel Link `tv.py`

```diff
--- stream.py
+++ tv.py
@@ -2,4 +2,4 @@
     url = URL + "/{channel}"
-    name = "hk_frontend:live_tv_stream"
-    requires_auth = False       # localhost only -- checked below
+    name = "mantel:tv:stream"
+    requires_auth = False       # this machine only -- checked below
 
@@ -7,2 +7,3 @@
         self._hass = hass
+        self.running = 0
 
@@ -11,13 +12,11 @@
             return web.Response(status=403)
-        data = self._hass.data.get(DATA, {})
-        entry = data.get("entry")
-        if entry is None or channel not in {c["number"] for c in entry.options.get(CONF_CHANNELS, [])}:
+        tv = find(self._hass, channel) if CHANNEL.match(channel) else None
+        if tv is None:
             return web.Response(status=404)
-        url = f"http://{data['host']}:5004/auto/v{channel}"
-        proc = await asyncio.create_subprocess_exec(
-            *ffmpeg_args(url, data.get("quality", "720")),
-            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
+        proc = await create_subprocess_exec(*ffmpeg_args(tv["source"], tv["quality"]),
+                                 stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
+        self.running += 1
         _LOGGER.debug("channel %s: ffmpeg %s started", channel, proc.pid)
 
-        async def log_errors():
+        async def log_errors() -> None:
             async for line in proc.stderr:
@@ -25,4 +24,3 @@
                 # Until the first full frame arrives the MPEG-2 decoder
-                # complains about every partial one -- harmless, and over a
-                # hundred warnings an hour.
+                # complains about every partial one: harmless.
                 if any(b in text for b in BENIGN):
@@ -30,4 +28,3 @@
                     continue
-                # 503 from the tuner = every tuner busy (another channel, or
-                # another app such as Plex).
+                # 503 from the tuner = every tuner busy (another channel, or another app)
                 _LOGGER.warning("channel %s: %s", channel, text)
@@ -36,9 +33,7 @@
         # THE PROCESS IS OURS FROM THE MOMENT IT EXISTS: the try opens here, not
-        # after prepare(). A client that resets (or a handler cancelled) while
-        # the response is being prepared left ffmpeg running, blocked on a full
-        # pipe -- holding one of the tuner's two tuners until a restart.
+        # after prepare(). A client that resets while the response is being
+        # prepared must not leave ffmpeg running, holding one of the tuner's tuners.
         sent = 0
         try:
-            resp = web.StreamResponse(headers={"Content-Type": "video/mp2t",
-                                               "Cache-Control": "no-store"})
+            resp = web.StreamResponse(headers={"Content-Type": "video/mp2t", "Cache-Control": "no-store"})
             await resp.prepare(request)
@@ -57,4 +52,4 @@
             err.cancel()
-            _LOGGER.debug("channel %s: ffmpeg %s ended (%s, %d bytes)", channel,
-                          proc.pid, proc.returncode, sent)
+            self.running -= 1
+            _LOGGER.debug("channel %s: ffmpeg %s ended (%s, %d bytes)", channel, proc.pid, proc.returncode, sent)
         return resp
```

On purpose: the channel and the tuner come from different places. Look at one thing: HK Frontend's comment tells of a
leak fixed earlier (a handler cancelled during `prepare()` left ffmpeg running). Mantel Link's comment shortens it,
and its `try` opens at the same place, so the behavior is the same. Recommendation: stay different; keep the comments
in step.

#### `wire_owners`: `linked_mode.py` vs Mantel Link `bridge.py`

```diff
--- linked_mode.py
+++ bridge.py
@@ -1,4 +1,4 @@
-def wire_owners(owners: Mapping[str, Any]) -> dict[str, Any]:
+def wire_owners(raw: Any) -> dict[str, Any]:
     """Mantel's `owners` as kept in the entry's data (normalised)."""
-    o = _owners(owners)
+    o = owners_of(raw)
     return {"house": "mantel" if o["house"] else "ha", "tablets": sorted(o["tablets"]), "bridge": o["bridge"]}
```

A renamed parameter and helper (`_owners` against `owners_of`). Same behavior. Recommendation: leave for now; the two
`owners` helpers could become one in `hk_core/link` later.

#### `sources`: HK Frontend `energy/plan.py` vs Mantel Link `energy.py`

```diff
--- plan.py
+++ energy.py
@@ -1,4 +1,3 @@
-def sources(hass: Any) -> dict[str, str]:
-    """{sensor: its source} for every sensor that has one -- what collect() reads of the sensors it looks
-    at, for a host that cannot read the objects (Mantel; hk_energy/sources). Read only."""
+def sources(hass: HomeAssistant) -> dict[str, str]:
+    """{sensor: its source} for every sensor that has one."""
     try:
```

Annotation and docstring only. Recommendation: make them identical (type `hass` as `Any`), then move with `source_of`.

#### `PinnedResolver`: HK Frontend `art.py` vs Mantel Server `connectors/media_art.py`

```diff
--- art.py
+++ media_art.py
@@ -7,3 +7,4 @@
         for addr in pinned[1]:
-            fam = socket.AF_INET6 if ipaddress.ip_address(addr).version == 6 else socket.AF_INET
+            version = ipaddress.ip_address(addr).version
+            fam = socket.AF_INET6 if version == 6 else socket.AF_INET
             if family not in (socket.AF_UNSPEC, fam):
```

Two lines against one. Same behavior. Recommendation: make them identical, then move with `pin`.

### 2.2 Same name, not copies

These share a name and some text, but do different work. They are listed so nobody merges them by mistake.
Recommendation for all of them: leave.

#### `async_unload_entry`: `linked_mode.py` vs Mantel Link `__init__.py`

```diff
--- linked_mode.py
+++ __init__.py
@@ -1,7 +1,5 @@
-async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry, platforms: list[Any]) -> bool:
-    ok = await hass.config_entries.async_unload_platforms(entry, platforms)
-    linked = hass.data.get(DOMAIN, {}).get(DATA)
-    if ok and linked is not None and linked.entry is entry:
-        hass.data[DOMAIN].pop(DATA, None)
-        await linked.stop()
+async def async_unload_entry(hass: HomeAssistant, entry: MantelConfigEntry) -> bool:
+    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
+    if ok:
+        await entry.runtime_data.stop()
     return ok
```

#### `accepts_gzip`: HK Frontend `files.py` vs Mantel Server `ingress.py`

```diff
--- files.py
+++ ingress.py
@@ -1,4 +1,4 @@
-def accepts_gzip(header: str | None) -> bool:
-    """An Accept-Encoding header that names gzip (or *) and does not give it q=0."""
-    for part in (header or "").lower().split(","):
+def accepts_gzip(request: web.Request) -> bool:
+    """Whether the browser takes a gzipped body: gzip (or *) named in Accept-Encoding and not given q=0."""
+    for part in request.headers.get("Accept-Encoding", "").lower().split(","):
         name, _, params = part.partition(";")
@@ -6,6 +6,3 @@
             q = params.replace(" ", "")
-            try:
-                return not (q.startswith("q=") and float(q[2:]) == 0)
-            except ValueError:
-                return True
+            return not (q.startswith("q=") and _q_is_zero(q[2:]))
     return False
```

Different inputs (a header string against a request). One could call the other later.

#### `_write`: HK Frontend `files_sync.py` vs Mantel Server `photos.py`

```diff
--- files_sync.py
+++ photos.py
@@ -1,5 +1,6 @@
-def _write(p: Path, data: bytes) -> None:
-    tmp = p.with_name(f".{p.name}.{secrets.token_hex(4)}.tmp")
+def _write(dest: Path, data: bytes) -> None:
+    tmp = dest.with_name(f".{dest.name}.{secrets.token_hex(4)}.tmp")
     try:
-        with open(tmp, "wb") as f:
+        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
+        with os.fdopen(fd, "wb") as f:
             f.write(data)
@@ -7,4 +8,3 @@
             os.fsync(f.fileno())
-        os.chmod(tmp, 0o644)
-        os.replace(tmp, p)
+        os.replace(tmp, dest)
     finally:
```

The server's creates the temporary file with mode 0600 and never chmods it; HK Frontend's chmods to 0644. Different on
purpose (private photos against files Home Assistant serves).

#### `_page`: Mantel Server `ingress.py` vs `mantel_connect/app.py`

```diff
--- ingress.py
+++ app.py
@@ -1,10 +1,6 @@
 def _page(title: str, body: str, status: int = 200) -> web.Response:
-    text = ("<!doctype html><html lang=en><meta charset=utf-8>" + REFERRER_META +
-            "<meta name=viewport content='width=device-width,initial-scale=1'>"
-            f"<title>{html.escape(title)}</title><style>body{{font:16px system-ui,sans-serif;max-width:36em;"
-            "margin:3em auto;padding:0 1em;background:#05070e;color:#eee}a{color:#9cf}"
-            "button,select,input{font:inherit;padding:.4em .8em}table{border-collapse:collapse;width:100%}"
-            "td,th{text-align:left;padding:.4em;border-bottom:1px solid #333}.note{color:#aaa}</style>"
+    text = ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
+            f"<title>{html.escape(title)}</title><style>body{{font:17px system-ui,sans-serif;max-width:36em;margin:3em auto;"
+            "padding:0 1em;background:#05070e;color:#eee}a{color:#9cf}.note{color:#aaa}code{background:#222;padding:.1em .3em}</style>"
             f"<h1>{html.escape(title)}</h1>{body}</html>")
-    return web.Response(text=text, status=status, content_type="text/html",
-                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
+    return web.Response(text=text, status=status, content_type="text/html", headers=PAGE_HEADERS)
```

Two small pages with their own look. Different on purpose.

## 3. Modules that say "ported line for line"

The phrase is in two Python files (and once in `docs/phase4/MANTEL-FEATURES.md`, about the music engine; see the end).

### `hosts/server/mantel_server/hidden.py` (from HK Frontend's `kinds.py` and `hiding.py`)

- It now shares 94 lines with `kinds.py` (section 1). Its docstring still says "ported line for line"; "shared where
  exact, ported where not" is now true. Left as it was: only code and this report were in scope.
- Drifted: `suggest` and `_also` (cosmetic), the `Candidate` field comments (gone; HK's kept), and `snapshot`, which
  filters non-string device and area ids and bad accessory entries (section 2.1).
- Not ported at all: `kinds.candidates`, `Tracker` and `current` (Home Assistant registries and events). The server's
  `Hiding.candidates`, `room_entities` and `members` do that work through the hub's store and registry. HK Frontend's
  websocket commands (`hiding.ws_*`) have no twin here; the server answers through its own routes.

### `hosts/server/mantel_server/accessories.py` (from HK Frontend's `accessories.py`)

- It now shares 72 lines with HK Frontend (section 1).
- Drifted: `clean` (cosmetic). The two stores differ by design: HK Frontend keeps `.storage` data and validates with
  `voluptuous` in websocket handlers; the server keeps a settings document and validates with `_SCHEMA` and
  `check_fields` (`Refused`). Fields, limits and lists now agree because they come from one file. What `version` means
  differs (a digest in HK Frontend, Mantel's document number on the server).
- Server only: `IDS_MAX = 500` and the changes as pure functions (`set_one`, `set_many`, `order`, `into`,
  `page_order`, `room_scenes`). HK Frontend only: the `Accessories` store and the websocket handlers.

### Other ports that name their source (not the phrase, the same idea)

- Mantel Link `tv.py` ("ported from HK Frontend's live_tv/stream.py"): it now shares `BENIGN`, `QUALITY` and
  `ffmpeg_args`; drift in `TvStreamView` (section 2.1). Mantel Server's `live_tv.py` names both and shares none of it.
- Mantel Link `entity.py` ("the same classes HK Frontend's linked mode had"): `LinkedSensor`, `LinkedBinarySensor` and
  `LinkedAlarmPanel` are identical; `LinkedEntity`, `LinkedSwitch` and `LinkedCamera` differ on purpose (section 2.1).
- Mantel Link `page_headers.py`: already shared in `hk_core/link/page_headers.py`; no drift left.
- `docs/phase4/MANTEL-FEATURES.md` says `MantelMusic` is "HA's MusicManager ported line for line". The music logic now
  lives in `hk_core/music`; this run did not compare the two hosts' wrappers.
