(() => {
      "use strict";
      const STORAGE_KEY = "sonora.score-studio.v1";
      const CLOUD_SESSION_KEY = "sonora.cloud-session.v1";
      const SUPABASE_URL = "https://wltervpxulekpwsxrope.supabase.co";
      const SUPABASE_PUBLIC_KEY = "sb_publishable_hweBVG6gVkRyfGc2O2DG8Q_MXl0QGxR";
      const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const NOTE_OPTIONS = [];
      for (let octave = 0; octave <= 8; octave++) {
        for (const pitch of NOTE_NAMES) NOTE_OPTIONS.push(`${pitch}${octave}`);
      }
      const DURATIONS = [
        ["0.25", "1/16"], ["0.5", "1/8"], ["0.75", "Dotted 1/8"],
        ["1", "1/4"], ["1.5", "Dotted 1/4"], ["2", "1/2"],
        ["3", "Dotted 1/2"], ["4", "Whole"]
      ];
      const DYNAMICS = ["pp", "p", "mp", "mf", "f", "ff"];
      const VELOCITIES = { pp: 34, p: 48, mp: 64, mf: 80, f: 98, ff: 114 };
      const RANGES = { Piano: [21, 108], Guitar: [40, 88], Violin: [55, 103], Flute: [60, 96], Other: [0, 127] };
      const KEY_FIFTHS = { "C major": 0, "G major": 1, "D major": 2, "A major": 3, "E major": 4, "B major": 5, "F# major": 6, "C# major": 7, "F major": -1, "Bb major": -2, "Eb major": -3, "Ab major": -4, "Db major": -5, "Gb major": -6, "Cb major": -7, "A minor": 0, "E minor": 1, "B minor": 2, "F# minor": 3, "C# minor": 4, "G# minor": 5, "D# minor": 6, "A# minor": 7, "D minor": -1, "G minor": -2, "C minor": -3, "F minor": -4, "Bb minor": -5, "Eb minor": -6, "Ab minor": -7 };
      const state = { projects: [], currentId: null, view: "studio", filter: "", undo: [], redo: [], audio: null, sources: [], playTimer: null, stopTimer: null, playing: false, playStarted: 0, playLength: 0, playbackStartBeat: 0, playbackEndBeat: 0, practiceStart: 1, practiceEnd: 0, practiceSpeed: 1, practiceHand: "both", practiceLoop: false, pendingDeleteId: null, deletedIds: [], noteNamesVisible: false, toastTimer: null, apiHealth: null, cloud: { config: null, session: null, user: null, ready: false, syncTimer: null, syncing: false, syncAgain: false } };
      const PLAYBACK_SOUNDS = ["Piano", "Guitar", "Violin", "Flute", "Synth"];
      const $ = selector => document.querySelector(selector);
      const $$ = selector => Array.from(document.querySelectorAll(selector));
      const uid = () => globalThis.crypto && typeof globalThis.crypto.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
      const current = () => state.projects.find(project => project.id === state.currentId) || null;
      const noteMidi = pitch => {
        const match = /^([A-G])([#b]?)(-?\d+)$/.exec(String(pitch));
        if (!match) return null;
        const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]];
        const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
        const midi = (Number(match[3]) + 1) * 12 + base + accidental;
        return midi >= 0 && midi <= 127 ? midi : null;
      };
      const pitchFromMidi = midi => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
      const beatsInBar = project => {
        const [numerator, denominator] = String(project.meter || "4/4").split("/").map(Number);
        return numerator * 4 / denominator;
      };
      const sortedNotes = project => [...project.notes].sort((a, b) => a.measure - b.measure || a.beat - b.beat || (noteMidi(a.pitch) || 0) - (noteMidi(b.pitch) || 0));
      const defaultProject = () => ({
        id: uid(), title: "Evening Arpeggio", instrument: "Piano", composer: "",
        tempo: 84, meter: "4/4", key: "C major", measureCount: 2,
        notes: [
          { id: uid(), pitch: "C4", measure: 1, beat: 0, duration: 1, hand: "R", finger: 1, dynamic: "mp" },
          { id: uid(), pitch: "E4", measure: 1, beat: 1, duration: 1, hand: "R", finger: 2, dynamic: "mp" },
          { id: uid(), pitch: "G4", measure: 1, beat: 2, duration: 1, hand: "R", finger: 3, dynamic: "mp" },
          { id: uid(), pitch: "C5", measure: 1, beat: 3, duration: 1, hand: "R", finger: 5, dynamic: "mp" },
          { id: uid(), pitch: "A3", measure: 2, beat: 0, duration: 1, hand: "L", finger: 5, dynamic: "mf" },
          { id: uid(), pitch: "C4", measure: 2, beat: 1, duration: 1, hand: "R", finger: 1, dynamic: "mf" },
          { id: uid(), pitch: "E4", measure: 2, beat: 2, duration: 2, hand: "R", finger: 3, dynamic: "mf" }
        ]
      });

      function normalizeProject(value) {
        if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.notes)) throw new Error("This file is not a valid Sonora score.");
        const notes = value.notes.map(note => {
          if (!note || typeof note !== "object" || Array.isArray(note)) throw new Error("The score contains an invalid note.");
          const pitch = String(note.pitch || "C4");
          const midi = noteMidi(pitch);
          const measure = Number(note.measure || 1);
          const beat = Number(note.beat || 0);
          const duration = Number(note.duration || 1);
          if (midi === null || !Number.isInteger(measure) || measure < 1 || !Number.isFinite(beat) || beat < 0 || !Number.isFinite(duration) || duration <= 0) {
            throw new Error("The score contains an invalid pitch, measure, beat, or duration.");
          }
          return {
            id: uid(), pitch, measure, beat, duration,
            hand: note.hand === "L" || Number(note.staff) === 2 ? "L" : "R",
            finger: note.finger === "" || note.finger == null ? "" : Math.min(5, Math.max(1, Number(note.finger) || 1)),
            dynamic: DYNAMICS.includes(note.dynamic) ? note.dynamic : "mf",
            confidence: note.confidence != null && Number.isFinite(Number(note.confidence)) ? Math.max(0, Math.min(1, Number(note.confidence))) : null
          };
        });
        const requestedMeasureCount = Number(value.measureCount);
        const measureCount = Math.max(
          1,
          Number.isInteger(requestedMeasureCount) ? requestedMeasureCount : 0,
          ...notes.map(note => note.measure)
        );
        return {
          id: uid(), title: String(value.title || "Imported score").slice(0, 100),
          instrument: ["Piano", "Guitar", "Violin", "Flute", "Other"].includes(value.instrument) ? value.instrument : "Piano",
          playbackSound: PLAYBACK_SOUNDS.includes(value.playbackSound) ? value.playbackSound : (["Piano", "Guitar", "Violin", "Flute"].includes(value.instrument) ? value.instrument : "Piano"),
          composer: String(value.composer || "").slice(0, 100),
          tempo: Math.max(1, Math.round(Number(value.tempo) || 96)),
          meter: /^\d+\/\d+$/.test(String(value.meter)) ? String(value.meter) : "4/4",
          key: KEY_FIFTHS[String(value.key)] !== undefined ? String(value.key) : "C major",
          measureCount, notes,
          analysis: value.analysis && typeof value.analysis === "object" ? value.analysis : null,
          source: value.source && typeof value.source === "object" ? value.source : null
        };
      }

      function persist(options = {}) {
        try {
          const project = current();
          if (project) project.updatedAt = new Date().toISOString();
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: state.projects, currentId: state.currentId, noteNamesVisible: state.noteNamesVisible, deletedIds: state.deletedIds }));
          $("#save-state").textContent = state.cloud.ready ? "Saved locally · syncing…" : "Saved on this device";
          if (options.sync !== false && state.cloud.user) scheduleCloudSync();
        } catch (error) {
          $("#save-state").textContent = "Could not save";
          showToast(`Could not save to this browser: ${error.message}`);
        }
      }
      function loadState() {
        let hasValidLibrary = false;
        let storedLibraryExists = false;
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          storedLibraryExists = stored !== null;
          if (stored) {
            const data = JSON.parse(stored);
            if (data && Array.isArray(data.projects)) {
              const ids = new Set();
              let skippedProjects = 0;
              state.projects = data.projects.flatMap(project => {
                try {
                  const normalized = normalizeStoredProject(project);
                  if (ids.has(normalized.id)) throw new Error("Duplicate score ID.");
                  ids.add(normalized.id);
                  return [normalized];
                } catch (_) {
                  skippedProjects++;
                  return [];
                }
              });
              state.currentId = state.projects.some(project => project.id === data.currentId) ? data.currentId : (state.projects[0]?.id || null);
              state.noteNamesVisible = data.noteNamesVisible === true;
              state.deletedIds = Array.isArray(data.deletedIds) ? data.deletedIds.filter(id => typeof id === "string") : [];
              hasValidLibrary = true;
              if (skippedProjects) {
                showToast(`${skippedProjects} saved score${skippedProjects === 1 ? " was" : "s were"} unreadable and skipped. Your other scores are available.`);
              }
            }
          }
        } catch (error) {
          showToast(`Saved scores could not be loaded: ${error.message}. The original saved data was left untouched.`);
        }
        if (!hasValidLibrary) {
          const project = defaultProject();
          state.projects = [project];
          state.currentId = project.id;
          if (!storedLibraryExists) persist();
          else $("#save-state").textContent = "Recovery score · original data untouched";
        }
      }
      function normalizeStoredProject(project) {
        const normalized = normalizeProject(project);
        normalized.id = String(project.id || normalized.id);
        normalized.title = String(project.title || normalized.title).slice(0, 100);
        normalized.updatedAt = project.updatedAt || "";
        return normalized;
      }
      function updateCloudUi(message = "", error = false) {
        const accountButton = $("#cloud-account-button");
        const status = $("#cloud-status");
        if (accountButton) accountButton.textContent = state.cloud.user?.email || "Sign in";
        if (status) {
          status.textContent = message || (state.cloud.ready
            ? `Signed in as ${state.cloud.user.email}. Score changes sync to your cloud library.`
            : state.cloud.user
              ? `Signed in as ${state.cloud.user.email}. Cloud sync is not complete.`
              : "Not connected. Your current scores remain saved on this device.");
          status.classList.toggle("error", error);
        }
      }
      function readCloudConfig() {
        localStorage.removeItem("sonora.cloud-config.v1");
        state.cloud.config = { url: SUPABASE_URL, anonKey: SUPABASE_PUBLIC_KEY };
        try {
          const session = JSON.parse(localStorage.getItem(CLOUD_SESSION_KEY) || "null");
          if (session && typeof session.access_token === "string" && typeof session.refresh_token === "string") state.cloud.session = session;
        } catch (error) {
          showToast(`Cloud sign-in could not be restored: ${error.message}`);
        }
      }
      function cloudHeaders(token = state.cloud.session?.access_token) {
        const headers = new Headers({ apikey: state.cloud.config.anonKey });
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return headers;
      }
      async function fetchWithTimeout(url, options, timeoutMs) {
        if (!timeoutMs) return await fetch(url, options);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(url, { ...options, signal: controller.signal });
        } catch (error) {
          if (controller.signal.aborted) throw new Error("The request timed out. Try again or choose a shorter file.");
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      }
      async function cloudRequest(path, options = {}) {
        const headers = cloudHeaders(options.token);
        if (options.body !== undefined) headers.set("Content-Type", "application/json");
        if (options.prefer) headers.set("Prefer", options.prefer);
        let response;
        try {
          response = await fetchWithTimeout(`${state.cloud.config.url}${path}`, {
            method: options.method || "GET",
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
          }, 15000);
        } catch (error) {
          throw new Error(error.message.startsWith("The request timed out")
            ? `Supabase did not respond in time. ${error.message}`
            : `Could not connect to Supabase. Check the project URL and internet connection. ${error.message}`);
        }
        const text = await response.text();
        let result = null;
        if (text) {
          try { result = JSON.parse(text); }
          catch (_) { throw new Error("Supabase returned an unreadable response."); }
        }
        if (!response.ok) throw new Error(result?.msg || result?.message || result?.error_description || result?.error || `Supabase returned HTTP ${response.status}.`);
        return result;
      }
      async function cloudAuthRequest(path, body, token) {
        return cloudRequest(`/auth/v1/${path}`, { method: "POST", body, token });
      }
      function storeCloudSession(session) {
        state.cloud.session = {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: Number(session.expires_at) || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
          token_type: session.token_type || "bearer"
        };
        state.cloud.user = session.user || null;
        localStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(state.cloud.session));
      }
      async function ensureCloudSession() {
        if (!state.cloud.session || !state.cloud.config) throw new Error("Sign in to your cloud account first.");
        if (state.cloud.session.expires_at < Math.floor(Date.now() / 1000) + 60) {
          const refreshed = await cloudAuthRequest("token?grant_type=refresh_token", { refresh_token: state.cloud.session.refresh_token }, null);
          if (!refreshed?.access_token || !refreshed?.refresh_token) throw new Error("Supabase could not refresh your session. Sign in again.");
          storeCloudSession(refreshed);
        }
        const user = await cloudRequest("/auth/v1/user");
        if (!user?.id) throw new Error("Supabase returned no signed-in user.");
        state.cloud.user = user;
        return user;
      }
      async function cloudLibraryRequest() {
        const records = await cloudRequest("/rest/v1/sonora_libraries?select=projects,deleted_ids,current_id,note_names_visible&limit=1");
        if (!Array.isArray(records)) throw new Error("The cloud library response was not a list. Check the Supabase schema setup.");
        return records[0] || null;
      }
      function mergeCloudLibrary(remote) {
        const deleted = new Set([...state.deletedIds, ...(Array.isArray(remote?.deleted_ids) ? remote.deleted_ids : [])]);
        const byId = new Map();
        for (const project of Array.isArray(remote?.projects) ? remote.projects : []) {
          const normalized = normalizeStoredProject(project);
          byId.set(normalized.id, normalized);
        }
        for (const project of state.projects) {
          const existing = byId.get(project.id);
          const localDate = Date.parse(project.updatedAt || "") || 0;
          const remoteDate = Date.parse(existing?.updatedAt || "") || 0;
          if (!existing || localDate >= remoteDate) byId.set(project.id, project);
        }
        const mergedProjects = [...byId.values()].filter(project => !deleted.has(project.id));
        state.deletedIds = [...deleted];
        state.projects = mergedProjects;
        const requestedId = state.currentId || remote?.current_id;
        state.currentId = state.projects.some(project => project.id === requestedId)
          ? requestedId
          : state.projects[0]?.id || null;
        state.noteNamesVisible = state.noteNamesVisible || remote?.note_names_visible === true;
      }
      async function syncCloudLibrary() {
        if (state.cloud.syncing) { state.cloud.syncAgain = true; return; }
        state.cloud.syncing = true;
        let succeeded = false;
        $("#cloud-error").textContent = "";
        updateCloudUi("Syncing scores with Supabase…");
        try {
          const user = await ensureCloudSession();
          const remote = await cloudLibraryRequest();
          mergeCloudLibrary(remote);
          persist({ sync: false });
          const payload = {
            user_id: user.id,
            projects: state.projects,
            deleted_ids: state.deletedIds,
            current_id: state.currentId,
            note_names_visible: state.noteNamesVisible,
            updated_at: new Date().toISOString()
          };
          await cloudRequest("/rest/v1/sonora_libraries?on_conflict=user_id", {
            method: "POST",
            body: payload,
            prefer: "resolution=merge-duplicates,return=minimal"
          });
          state.cloud.ready = true;
          succeeded = true;
          $("#save-state").textContent = "Cloud synced";
          updateCloudUi(`Signed in as ${user.email}. ${state.projects.length} score${state.projects.length === 1 ? "" : "s"} synced.`);
          render();
        } catch (error) {
          state.cloud.ready = false;
          updateCloudUi(error.message, true);
          $("#save-state").textContent = "Cloud sync failed";
          throw error;
        } finally {
          state.cloud.syncing = false;
          if (succeeded && state.cloud.syncAgain) {
            state.cloud.syncAgain = false;
            scheduleCloudSync();
          } else if (!succeeded) {
            state.cloud.syncAgain = false;
          }
        }
      }
      function scheduleCloudSync() {
        if (!state.cloud.user) return;
        clearTimeout(state.cloud.syncTimer);
        state.cloud.syncTimer = setTimeout(() => {
          syncCloudLibrary().catch(error => showToast(`Cloud sync failed: ${error.message}`));
        }, 700);
      }
      function populateCloudFields() {
        $("#cloud-email").value = state.cloud.user?.email || "";
        $("#cloud-error").textContent = "";
        updateCloudUi();
      }
      async function cloudSignIn(createAccount = false) {
        const errorNode = $("#cloud-error");
        errorNode.textContent = "";
        try {
          const email = $("#cloud-email").value.trim();
          const password = $("#cloud-password").value;
          if (!email || !$("#cloud-email").checkValidity()) throw new Error("Enter a valid email address.");
          if (password.length < 8) throw new Error("Password must be at least 8 characters.");
          updateCloudUi(createAccount ? "Creating your account…" : "Signing in…");
          const response = await cloudAuthRequest(
            createAccount ? "signup" : "token?grant_type=password",
            { email, password },
            null
          );
          if (!response?.access_token || !response?.refresh_token) {
            updateCloudUi("Account created. Check your email to confirm the account, then sign in.");
            return;
          }
          storeCloudSession(response);
          state.cloud.ready = false;
          await syncCloudLibrary();
          $("#cloud-password").value = "";
        } catch (error) {
          errorNode.textContent = error.message;
          updateCloudUi(error.message, true);
        }
      }
      async function cloudResetPassword() {
        const errorNode = $("#cloud-error");
        errorNode.textContent = "";
        try {
          const email = $("#cloud-email").value.trim();
          if (!email || !$("#cloud-email").checkValidity()) throw new Error("Enter your account email first.");
          await cloudAuthRequest("recover", { email, redirect_to: window.location.origin });
          updateCloudUi("If an account exists for that email, Supabase will send a password-reset link.");
        } catch (error) {
          errorNode.textContent = error.message;
          updateCloudUi(error.message, true);
        }
      }
      async function cloudSignOut() {
        let logoutError = null;
        if (state.cloud.session && state.cloud.config) {
          try { await cloudRequest("/auth/v1/logout", { method: "POST" }); }
          catch (error) {
            if (!/401|invalid|expired/i.test(error.message)) logoutError = error;
          }
        }
        state.cloud.session = null;
        state.cloud.user = null;
        state.cloud.ready = false;
        localStorage.removeItem(CLOUD_SESSION_KEY);
        updateCloudUi("Signed out. Your scores remain saved on this device.");
        $("#save-state").textContent = "Saved on this device";
        if (logoutError) showToast(`Signed out on this device, but Supabase could not revoke the remote session: ${logoutError.message}`);
      }
      async function restoreCloudAccount() {
        readCloudConfig();
        populateCloudFields();
        if (!state.cloud.config || !state.cloud.session) return;
        try {
          await ensureCloudSession();
          await syncCloudLibrary();
        } catch (error) {
          state.cloud.ready = false;
          updateCloudUi(`Cloud account needs attention: ${error.message}`, true);
        }
      }
      function defaultApiBase() {
        return window.location.protocol === "file:" ? "http://127.0.0.1:8000" : window.location.origin;
      }
      function apiBase() {
        return defaultApiBase();
      }
      async function apiRequest(path, options = {}) {
        const headers = new Headers(options.headers || {});
        const { timeoutMs = 0, ...requestOptions } = options;
        if (state.cloud.session) {
          await ensureCloudSession();
          headers.set("Authorization", `Bearer ${state.cloud.session.access_token}`);
        }
        let response;
        try {
          response = await fetchWithTimeout(`${apiBase()}${path}`, { ...requestOptions, headers }, timeoutMs);
        } catch (error) {
          if (error.message.startsWith("The request timed out")) throw error;
          throw new Error(`Sonora’s analysis service could not be reached. Check your connection and try again. ${error.message}`);
        }
        let data;
        try { data = await response.json(); }
        catch (_) { data = {}; }
        if (!response.ok) throw new Error(data.detail || `The Sonora server returned HTTP ${response.status}.`);
        return data;
      }
      async function checkBackend() {
        const badge = $("#ai-status");
        try {
          const health = await apiRequest("/api/health");
          state.apiHealth = health;
          const score = health.models?.score_ocr?.available;
          const audio = health.models?.audio_transcription?.available;
          badge.textContent = score && audio ? "Local AI ready" : score || audio ? `${score ? "Score OCR" : "Audio model"} ready` : "Models unavailable";
          badge.classList.toggle("ready", Boolean(score || audio));
          badge.classList.toggle("offline", !score && !audio);
          return true;
        } catch (_) {
          state.apiHealth = null;
          badge.textContent = "Local AI offline";
          badge.classList.remove("ready");
          badge.classList.add("offline");
          return false;
        }
      }
      async function runAnalysis() {
        const file = $("#analysis-file").files?.[0];
        const kind = $("#analysis-kind").value;
        const errorNode = $("#analysis-error");
        const button = document.querySelector('[data-action="run-analysis"]');
        errorNode.textContent = "";
        if (!file) { errorNode.textContent = kind === "score" ? "Choose a score image or PDF first." : kind === "video" ? "Choose a video file first." : "Choose an audio file first."; return; }
        const extension = file.name.split(".").pop().toLowerCase();
        const scoreExtensions = ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "pdf", "xml", "musicxml"];
        const audioExtensions = ["wav", "mp3", "m4a", "flac", "ogg", "aiff", "aif"];
        const videoExtensions = ["mp4", "mov", "m4v", "mkv", "webm", "avi"];
        if (kind === "score" && !scoreExtensions.includes(extension)) { errorNode.textContent = "For score analysis, choose an image, PDF, or MusicXML file."; return; }
        if (kind === "audio" && !audioExtensions.includes(extension)) { errorNode.textContent = "For audio transcription, choose a WAV, MP3, M4A, FLAC, OGG, or AIFF file."; return; }
        if (kind === "video" && !videoExtensions.includes(extension)) { errorNode.textContent = "For video transcription, choose an MP4, MOV, M4V, MKV, WebM, or AVI file."; return; }
        const form = new FormData();
        form.append("file", file);
        form.append("tempo", $("#analysis-tempo").value || "120");
        form.append("meter", $("#analysis-meter").value);
        form.append("instrument", $("#analysis-instrument").value);
        if (kind !== "score") form.append("title", file.name.replace(/\.[^.]+$/, ""));
        button.disabled = true;
        button.textContent = kind === "score" ? "Recognizing notation…" : "Transcribing performance…";
        errorNode.textContent = kind === "score"
          ? ["xml", "musicxml"].includes(extension) ? "Reading MusicXML locally and preparing an editable score…" : "Reading the page and reconstructing measures. Keep this window open."
          : "Listening to the full recording and finding notes. This is often the longest step.";
        try {
          let response;
          if (kind === "score" && ["xml", "musicxml"].includes(extension)) {
            const text = await file.text();
            const project = importMusicXml(text, file.name.replace(/\.(musicxml|xml)$/i, ""));
            project.source = { kind: "musicxml", filename: file.name };
            response = { score: project, source: project.source };
          } else {
            const endpoint = kind === "score" ? "/api/analyze/score" : kind === "video" ? "/api/analyze/video" : "/api/analyze/audio";
            response = await apiRequest(endpoint, { method: "POST", body: form });
          }
          const project = normalizeProject(response.score);
          project.analysis = response.confidence || null;
          project.source = response.source || { kind };
          state.projects.unshift(project);
          state.currentId = project.id;
          state.view = "studio";
          state.undo = [];
          state.redo = [];
          persist();
          closeDialogs();
          render();
          showToast(`${project.notes.length} notes read across ${project.measureCount} measures. Open the score to review and correct any uncertain notes.`);
          if (!(kind === "score" && ["xml", "musicxml"].includes(extension))) await checkBackend();
        } catch (error) {
          errorNode.textContent = error.message;
        } finally {
          button.disabled = false;
          button.textContent = $("#analysis-kind").value === "score" ? "Analyze score" : "Transcribe performance";
        }
      }
      async function searchCatalog() {
        const input = $("#catalog-query");
        const resultNode = $("#catalog-results");
        const button = document.querySelector('[data-action="search-catalog"]');
        const query = input?.value.trim();
        if (!query || query.length < 2) {
          resultNode.innerHTML = `<div class="result-empty">Enter at least two characters to search.</div>`;
          return;
        }
        button.disabled = true;
        button.textContent = "Searching…";
        resultNode.innerHTML = `<div class="result-empty">Searching music catalogs…</div>`;
        try {
          const response = await apiRequest(`/api/search?q=${encodeURIComponent(query)}`);
          const results = response.results || [];
          const entries = results.map(item => {
            const kind = item.kind === "audio" ? "audio" : "score";
            return `<article class="search-result"><div><h3>${esc(item.title)}</h3><p>${esc(item.artist || item.source)}${item.year ? ` · ${esc(item.year)}` : ""}</p><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(item.source)} ↗</a><div class="practice-empty-actions"><button class="button" type="button" data-action="open-result-analysis" data-result-kind="${kind}">Analyze a downloaded copy</button></div></div><span class="source-tag">${esc(item.kind || item.source)}</span></article>`;
          }).join("");
          const warnings = (response.warnings || []).map(warning => `<div class="notice-item">${esc(warning)}</div>`).join("");
          resultNode.innerHTML = `${warnings}${entries || `<div class="result-empty">No matches found. Try a shorter title or composer name.</div>`}<p class="dialog-help">Catalog results link to their original source. Check each item's rights and availability before use.</p>`;
        } catch (error) {
          resultNode.innerHTML = `<div class="notice-item error">${esc(error.message)}</div>`;
        } finally {
          button.disabled = false;
          button.textContent = "Search catalogs";
        }
      }
      async function lookupYouTube() {
        const input = $("#youtube-url");
        const resultNode = $("#youtube-result");
        const button = document.querySelector('[data-action="youtube-lookup"]');
        const value = input?.value.trim();
        if (!value) {
          resultNode.innerHTML = `<div class="result-empty">Paste a YouTube video link first.</div>`;
          return;
        }
        button.disabled = true;
        button.textContent = "Looking up…";
        resultNode.innerHTML = `<div class="result-empty">Looking up video details…</div>`;
        try {
          const response = await apiRequest(`/api/youtube?url=${encodeURIComponent(value)}`);
          resultNode.innerHTML = `<iframe title="${esc(response.title)}" src="${esc(response.embedUrl)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe><h3>${esc(response.title)}</h3><p>${esc(response.author || "")}</p><p>${esc(response.analysisNote)}</p><label class="practice-loop" style="display:flex;align-items:center;gap:8px"><input id="youtube-authorized" type="checkbox"> I own or am authorized to use this video</label><div class="practice-empty-actions"><button class="button" type="button" data-action="youtube-download" data-url="${esc(response.url)}">Download MP4</button><button class="button primary" type="button" data-action="youtube-analyze" data-url="${esc(response.url)}">Analyze & create score</button><a class="button" href="${esc(response.url)}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a></div><p class="dialog-help">Only download or analyze media you own or are legally authorized to use. Sonora does not bypass restrictions or support paid/copyright-protected downloads.</p>`;
        } catch (error) {
          resultNode.innerHTML = `<div class="notice-item error">${esc(error.message)}</div>`;
        } finally {
          button.disabled = false;
          button.textContent = "Preview link";
        }
      }
      async function downloadYouTube(url) {
        const authorized = $("#youtube-authorized")?.checked;
        if (!authorized) { showToast("Confirm that you own or are authorized to use this YouTube video."); return; }
        showToast("Preparing the authorized YouTube download…");
        try {
          const form = new FormData();
          form.append("url", url);
          form.append("authorized", "true");
          const headers = new Headers();
          if (state.cloud.session) {
            await ensureCloudSession();
            headers.set("Authorization", `Bearer ${state.cloud.session.access_token}`);
          }
          const response = await fetchWithTimeout(`${apiBase()}/api/youtube/download`, { method: "POST", body: form, headers }, 0);
          if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try { message = (await response.json()).detail || message; } catch (_) {}
            throw new Error(message);
          }
          const blob = await response.blob();
          if (!blob.size) throw new Error("The YouTube download returned an empty file.");
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = objectUrl;
          link.download = "sonora-youtube-video.mp4";
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
          showToast("Authorized YouTube download is ready.");
        } catch (error) {
          showToast(`YouTube download failed: ${error.message}`);
        }
      }
      async function analyzeYouTube(url) {
        const authorized = $("#youtube-authorized")?.checked;
        if (!authorized) { showToast("Confirm that you own or are authorized to analyze this YouTube video."); return; }
        try {
          showToast("Downloading and transcribing the authorized YouTube video…");
          const form = new FormData();
          form.append("url", url);
          form.append("authorized", "true");
          form.append("tempo", $("#analysis-tempo")?.value || "120");
          form.append("meter", $("#analysis-meter")?.value || "4/4");
          form.append("instrument", $("#analysis-instrument")?.value || "Piano");
          const response = await apiRequest("/api/youtube/transcribe", { method: "POST", body: form });
          const project = normalizeProject(response.score);
          project.analysis = response.confidence || null;
          project.source = response.source || { kind: "youtube", url };
          state.projects.unshift(project);
          state.currentId = project.id;
          state.view = "studio";
          state.undo = [];
          state.redo = [];
          persist();
          render();
          showToast(`${project.notes.length} notes transcribed across ${project.measureCount} measures. Review the tempo, timing, and missed passages before exporting.`);
        } catch (error) {
          showToast(`YouTube transcription failed: ${error.message}`);
        }
      }
      function showToast(message) {
        const toast = $("#toast");
        toast.textContent = message;
        toast.hidden = false;
        clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
      }
      function snapshot() {
        const project = current();
        if (!project) return;
        state.undo.push(JSON.stringify(project));
        if (state.undo.length > 40) state.undo.shift();
        state.redo = [];
      }
      function applyHistory(from, to) {
        const value = from.pop();
        if (!value) return;
        const project = current();
        if (!project) return;
        to.push(JSON.stringify(project));
        const restored = JSON.parse(value);
        const index = state.projects.findIndex(item => item.id === state.currentId);
        state.projects[index] = restored;
        persist();
        render();
      }
      function openDialog(id) {
        const dialog = document.getElementById(id);
        if (dialog && typeof dialog.showModal === "function") dialog.showModal();
      }
      function closeDialogs() { $$("dialog[open]").forEach(dialog => dialog.close()); }
      function escXml(value) { return String(value ?? "").replace(/[<>&'"]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char])); }
      function projectFileName(project, extension) {
        const base = project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "sonora-score";
        return `${base}.${extension}`;
      }
      function download(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      function exportJson() {
        const project = current();
        if (!project) return;
        const data = { format: "sonora-score", version: 1, ...project };
        download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), projectFileName(project, "json"));
        closeDialogs();
        showToast("Sonora JSON backup downloaded.");
      }
      function xmlPitch(pitch) {
        const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
        if (!match) throw new Error(`Invalid pitch: ${pitch}`);
        return `<pitch><step>${match[1]}</step>${match[2] === "#" ? "<alter>1</alter>" : match[2] === "b" ? "<alter>-1</alter>" : ""}<octave>${match[3]}</octave></pitch>`;
      }
      function noteType(duration) {
        if (duration <= .26) return "16th";
        if (duration <= .76) return "eighth";
        if (duration <= 1.01) return "quarter";
        if (duration <= 1.51) return "quarter";
        if (duration <= 2.01) return "half";
        if (duration <= 3.01) return "half";
        return "whole";
      }
      function noteDot(duration) {
        return Math.abs(duration - .75) < .001 || Math.abs(duration - 1.5) < .001 || Math.abs(duration - 3) < .001 ? "<dot/>" : "";
      }
      function musicXml(project) {
        const divisions = 480;
        const barBeats = beatsInBar(project);
        const maxMeasure = Math.max(project.measureCount, ...project.notes.map(note => note.measure), 1);
        const notesByMeasure = new Map();
        for (const note of project.notes) {
          if (!notesByMeasure.has(note.measure)) notesByMeasure.set(note.measure, []);
          notesByMeasure.get(note.measure).push(note);
        }
        const fifths = KEY_FIFTHS[project.key] ?? 0;
        const grandStaff = project.instrument === "Piano";
        const [beats, beatType] = project.meter.split("/");
        const measureXml = [];
        for (let measureNumber = 1; measureNumber <= maxMeasure; measureNumber++) {
          const notes = (notesByMeasure.get(measureNumber) || []).slice().sort((a, b) => a.beat - b.beat || (noteMidi(a.pitch) || 0) - (noteMidi(b.pitch) || 0));
          const groups = new Map();
          for (const note of notes) {
            const at = Math.round(note.beat * divisions);
            if (!groups.has(at)) groups.set(at, []);
            groups.get(at).push(note);
          }
          let cursor = 0;
          const body = [];
          for (const [at, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
            if (at > cursor) {
              body.push(`<note><rest/><duration>${at - cursor}</duration><voice>1</voice><type>${noteType((at - cursor) / divisions)}</type><staff>1</staff></note>`);
              cursor = at;
            } else if (at < cursor) {
              body.push(`<backup><duration>${cursor - at}</duration></backup>`);
              cursor = at;
            }
            const groupDuration = Math.max(...group.map(note => Math.max(1, Math.round(note.duration * divisions))));
            const dynamic = DYNAMICS.includes(group[0].dynamic) ? group[0].dynamic : "mf";
            const dynamicStaff = grandStaff && group[0].hand === "L" ? 2 : 1;
            body.push(`<direction placement="below"><direction-type><dynamics><${dynamic}/></dynamics></direction-type><staff>${dynamicStaff}</staff></direction>`);
            group.forEach((note, index) => {
              const fingering = note.finger ? `<notations><technical><fingering>${escXml(note.finger)}</fingering></technical></notations>` : "";
              const staff = grandStaff && note.hand === "L" ? 2 : 1;
              body.push(`<note>${index ? "<chord/>" : ""}${xmlPitch(note.pitch)}<duration>${Math.max(1, Math.round(note.duration * divisions))}</duration><voice>1</voice><type>${noteType(note.duration)}</type>${noteDot(note.duration)}<staff>${staff}</staff>${fingering}</note>`);
            });
            cursor = Math.max(cursor, at + groupDuration);
          }
          const end = Math.round(barBeats * divisions);
          if (cursor < end) body.push(`<note><rest/><duration>${end - cursor}</duration><voice>1</voice><type>${noteType((end - cursor) / divisions)}</type><staff>1</staff></note>`);
          const clefs = grandStaff ? `<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>` : `<clef><sign>G</sign><line>2</line></clef>`;
          const attributes = measureNumber === 1 ? `<attributes><divisions>${divisions}</divisions><key><fifths>${fifths}</fifths><mode>${project.key.toLowerCase().includes("minor") ? "minor" : "major"}</mode></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>${clefs}</attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${project.tempo}</per-minute></metronome></direction-type><sound tempo="${project.tempo}"/></direction>` : "";
          measureXml.push(`<measure number="${measureNumber}">${attributes}${body.join("")}</measure>`);
        }
        return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><score-partwise version="3.1"><work><work-title>${escXml(project.title)}</work-title></work><identification><creator type="composer">${escXml(project.composer)}</creator><encoding><software>Sonora Score Studio</software></encoding></identification><part-list><score-part id="P1"><part-name>${escXml(project.instrument)}</part-name></score-part></part-list><part id="P1">${measureXml.join("")}</part></score-partwise>`;
      }
      function exportMusicXml() {
        const project = current();
        if (!project) return;
        try {
          download(new Blob([musicXml(project)], { type: "application/vnd.recordare.musicxml+xml;charset=utf-8" }), projectFileName(project, "musicxml"));
          closeDialogs();
          showToast("MusicXML score downloaded.");
        } catch (error) {
          $("#export-error").textContent = error.message;
        }
      }
      function scoreSheetSvg(project) {
        const maxMeasure = Math.max(project.measureCount, ...project.notes.map(note => note.measure), 1);
        const barBeats = beatsInBar(project);
        const grandStaff = project.instrument === "Piano" || project.notes.some(note => note.hand === "L");
        const measuresPerSystem = 4;
        const pageWidth = 1120;
        const left = 42;
        const right = 36;
        const measureWidth = (pageWidth - left - right) / measuresPerSystem;
        const systemHeight = grandStaff ? 220 : 145;
        const headerHeight = 145;
        const systemCount = Math.ceil(maxMeasure / measuresPerSystem);
        const pageHeight = headerHeight + systemCount * systemHeight + 45;
        const steps = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
        const elements = [];
        const addText = (x, y, value, size = 12, weight = "normal") => `<text x="${x}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="${weight}">${escXml(value)}</text>`;

        elements.push(`<rect width="${pageWidth}" height="${pageHeight}" fill="#fff"/>`);
        elements.push(addText(left, 48, project.title || "Untitled score", 28, "bold"));
        if (project.composer) elements.push(addText(left, 72, project.composer, 14));
        elements.push(addText(left, 98, `${project.instrument}  ·  ${project.tempo} BPM  ·  ${project.key}  ·  ${project.meter}`, 13));

        for (let measure = 1; measure <= maxMeasure; measure++) {
          const systemIndex = Math.floor((measure - 1) / measuresPerSystem);
          const slot = (measure - 1) % measuresPerSystem;
          const x = left + slot * measureWidth;
          const yTop = headerHeight + systemIndex * systemHeight;
          const trebleTop = yTop + 28;
          const trebleBottom = trebleTop + 44;
          const bassTop = yTop + 104;
          const bassBottom = bassTop + 44;
          const staffLeft = x + 25;
          const staffRight = x + measureWidth - 8;
          const staffLines = (top, bottom) => Array.from({ length: 5 }, (_, i) => {
            const y = bottom - i * 11;
            return `<line x1="${staffLeft}" y1="${y}" x2="${staffRight}" y2="${y}" stroke="#222" stroke-width="1"/>`;
          }).join("");
          elements.push(addText(x + 4, yTop + 16, String(measure), 11));
          elements.push(staffLines(trebleTop, trebleBottom));
          if (grandStaff) elements.push(staffLines(bassTop, bassBottom));
          elements.push(`<line x1="${staffRight}" y1="${trebleTop}" x2="${staffRight}" y2="${grandStaff ? bassBottom : trebleBottom}" stroke="#222" stroke-width="1.2"/>`);
          elements.push(addText(x + 1, trebleBottom - 8, "𝄞", 31));
          if (grandStaff) elements.push(addText(x + 1, bassBottom - 8, "𝄢", 25));

          const measureNotes = sortedNotes(project).filter(note => note.measure === measure);
          const byBeat = new Map();
          measureNotes.forEach(note => {
            const key = String(note.beat);
            if (!byBeat.has(key)) byBeat.set(key, []);
            byBeat.get(key).push(note);
          });
          for (const notes of byBeat.values()) notes.forEach((note, chordIndex) => {
            const isBass = grandStaff && note.hand === "L";
            const staffBottom = isBass ? bassBottom : trebleBottom;
            const baseStep = isBass ? (2 * 7 + 4) : (4 * 7 + 2);
            const pitchMatch = /^([A-G])([#b]?)(-?\d+)$/.exec(note.pitch);
            if (!pitchMatch) return;
            const pitchStep = Number(pitchMatch[3]) * 7 + steps[pitchMatch[1]];
            const noteY = staffBottom - (pitchStep - baseStep) * 5.5;
            const beatX = staffLeft + 38 + (Math.min(barBeats, Math.max(0, note.beat)) / barBeats) * Math.max(36, measureWidth - 82);
            const noteX = beatX + chordIndex * 4;
            const hollow = Number(note.duration) >= 2;
            const stemless = Number(note.duration) >= 4;
            const stemX = noteX + (noteY > staffBottom - 22 ? 4 : -4);
            const stemEnd = noteY > staffBottom - 22 ? noteY - 25 : noteY + 25;
            const notehead = `<ellipse cx="${noteX}" cy="${noteY}" rx="5.2" ry="3.8" transform="rotate(-20 ${noteX} ${noteY})" fill="${hollow ? "white" : "#111"}" stroke="#111" stroke-width="1.4"/>`;
            const ledgerLines = [];
            for (let ledgerY = staffBottom - 55; noteY < ledgerY; ledgerY -= 11) ledgerLines.push(`<line x1="${noteX - 9}" y1="${ledgerY}" x2="${noteX + 9}" y2="${ledgerY}" stroke="#222" stroke-width="1"/>`);
            for (let ledgerY = staffBottom + 11; noteY > ledgerY; ledgerY += 11) ledgerLines.push(`<line x1="${noteX - 9}" y1="${ledgerY}" x2="${noteX + 9}" y2="${ledgerY}" stroke="#222" stroke-width="1"/>`);
            const accidental = pitchMatch[2] === "#" ? "♯" : pitchMatch[2] === "b" ? "♭" : "";
            const flagCount = Number(note.duration) < 1 ? (Number(note.duration) <= 0.25 ? 2 : 1) : 0;
            const flags = Array.from({ length: flagCount }, (_, i) => `<path d="M ${stemX} ${stemEnd + i * 8} q 13 1 8 12" fill="none" stroke="#111" stroke-width="1.6"/>`).join("");
            const dot = Math.abs(Number(note.duration) % 1) > 0.01 ? `<circle cx="${noteX + 10}" cy="${noteY - 1}" r="1.8" fill="#111"/>` : "";
            elements.push(`<g>${ledgerLines.join("")}${accidental ? addText(noteX - 14, noteY + 4, accidental, 14) : ""}${notehead}${stemless ? "" : `<line x1="${stemX}" y1="${noteY}" x2="${stemX}" y2="${stemEnd}" stroke="#111" stroke-width="1.4"/>${flags}`}${dot}<title>${escXml(`${note.pitch}, measure ${measure}, beat ${note.beat + 1}`)}</title></g>`);
          });
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" width="11.67in" height="${(pageHeight / 96).toFixed(2)}in" viewBox="0 0 ${pageWidth} ${pageHeight}" role="img" aria-label="${escXml(project.title)} sheet music">${elements.join("")}</svg>`;
      }
      function exportScoreSheet() {
        const project = current();
        if (!project) return;
        try {
          download(new Blob([scoreSheetSvg(project)], { type: "image/svg+xml;charset=utf-8" }), projectFileName(project, "svg"));
          closeDialogs();
          showToast("Printable score sheet downloaded as SVG.");
        } catch (error) {
          $("#export-error").textContent = error.message;
        }
      }
      function printScoreSheet() {
        if (!current()) return;
        closeDialogs();
        const previousView = state.view;
        const previousNoteNamesVisible = state.noteNamesVisible;
        state.view = "studio";
        state.noteNamesVisible = false;
        render();
        window.requestAnimationFrame(() => {
          window.print();
          state.view = previousView;
          state.noteNamesVisible = previousNoteNamesVisible;
          render();
        });
      }
      function variableLength(value) {
        let number = Math.max(0, Math.floor(value));
        const bytes = [number & 0x7f];
        while ((number >>= 7) > 0) bytes.unshift((number & 0x7f) | 0x80);
        return bytes;
      }
      function uint32(value) { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
      function midiFile(project) {
        const ppq = 480;
        const micros = Math.round(60000000 / project.tempo);
        const [numerator, denominator] = project.meter.split("/").map(Number);
        const power = Math.max(0, Math.round(Math.log2(denominator)));
        const events = [
          { tick: 0, priority: 0, bytes: [0xff, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255] },
          { tick: 0, priority: 0, bytes: [0xff, 0x58, 0x04, numerator & 255, power & 255, 24, 8] }
        ];
        for (const note of project.notes) {
          const pitch = noteMidi(note.pitch);
          if (pitch === null) continue;
          const start = Math.round(((note.measure - 1) * beatsInBar(project) + note.beat) * ppq);
          const end = Math.max(start + 1, start + Math.round(note.duration * ppq));
          const velocity = VELOCITIES[note.dynamic] || 80;
          events.push({ tick: start, priority: 1, bytes: [0x90, pitch, velocity] });
          events.push({ tick: end, priority: 0, bytes: [0x80, pitch, 0] });
        }
        events.sort((a, b) => a.tick - b.tick || a.priority - b.priority);
        const track = [];
        let previousTick = 0;
        for (const event of events) {
          track.push(...variableLength(event.tick - previousTick), ...event.bytes);
          previousTick = event.tick;
        }
        track.push(0, 0xff, 0x2f, 0);
        return new Uint8Array([0x4d,0x54,0x68,0x64,0,0,0,6,0,1,0,1,(ppq >> 8) & 255,ppq & 255,0x4d,0x54,0x72,0x6b,...uint32(track.length),...track]);
      }
      function exportMidi() {
        const project = current();
        if (!project) return;
        try {
          download(new Blob([midiFile(project)], { type: "audio/midi" }), projectFileName(project, "mid"));
          closeDialogs();
          showToast("MIDI file downloaded.");
        } catch (error) {
          $("#export-error").textContent = error.message;
        }
      }
      function importMusicXml(text, fallbackTitle) {
        const documentXml = new DOMParser().parseFromString(text, "application/xml");
        if (documentXml.querySelector("parsererror") || documentXml.documentElement.localName !== "score-partwise") throw new Error("This does not appear to be a valid, uncompressed MusicXML score.");
        const firstPart = documentXml.querySelector("part");
        if (!firstPart) throw new Error("The MusicXML file contains no score part.");
        const title = documentXml.querySelector("work-title, movement-title")?.textContent?.trim() || fallbackTitle || "Imported score";
        const composer = documentXml.querySelector('creator[type="composer"]')?.textContent?.trim() || "";
        const partId = firstPart.getAttribute("id");
        const partName = Array.from(documentXml.querySelectorAll("score-part")).find(part => part.getAttribute("id") === partId)?.querySelector("part-name")?.textContent?.trim();
        const instrument = ["Piano", "Guitar", "Violin", "Flute"].find(name => name.toLowerCase() === partName?.toLowerCase()) || "Other";
        let divisions = 1;
        let meter = "4/4";
        let key = "C major";
        let tempo = 96;
        let dynamic = "mf";
        const notes = [];
        let measureNumber = 0;
        for (const measure of Array.from(firstPart.children).filter(element => element.localName === "measure")) {
          measureNumber++;
          let cursor = 0;
          const label = Number(measure.getAttribute("number"));
          const actualMeasure = Number.isInteger(label) && label > 0 ? label : measureNumber;
          for (const element of Array.from(measure.children)) {
            if (element.localName === "attributes") {
              const nextDivisions = Number(element.querySelector("divisions")?.textContent);
              if (nextDivisions > 0) divisions = nextDivisions;
              const fifths = Number(element.querySelector("key fifths")?.textContent || 0);
              const mode = element.querySelector("key mode")?.textContent?.toLowerCase() === "minor" ? "minor" : "major";
              const foundKey = Object.keys(KEY_FIFTHS).find(name => KEY_FIFTHS[name] === fifths && name.endsWith(mode));
              if (foundKey) key = foundKey;
              const beats = element.querySelector("time beats")?.textContent;
              const beatType = element.querySelector("time beat-type")?.textContent;
              if (beats && beatType) meter = `${beats}/${beatType}`;
            } else if (element.localName === "direction") {
              const perMinute = Number(element.querySelector("per-minute")?.textContent || element.querySelector("sound")?.getAttribute("tempo"));
              if (perMinute >= 1) tempo = Math.round(perMinute);
              const marking = element.querySelector("dynamics > *")?.localName;
              if (DYNAMICS.includes(marking)) dynamic = marking;
            } else if (element.localName === "sound") {
              const foundTempo = Number(element.getAttribute("tempo"));
              if (foundTempo >= 1) tempo = Math.round(foundTempo);
            } else if (element.localName === "backup" || element.localName === "forward") {
              const amount = Number(element.querySelector("duration")?.textContent || 0) / divisions;
              cursor += element.localName === "backup" ? -amount : amount;
            } else if (element.localName === "note") {
              const duration = Number(element.querySelector(":scope > duration")?.textContent || divisions) / divisions;
              if (element.querySelector(":scope > rest")) {
                if (!element.querySelector(":scope > chord")) cursor += duration;
                continue;
              }
              const pitchNode = element.querySelector(":scope > pitch");
              if (!pitchNode) continue;
              const step = pitchNode.querySelector("step")?.textContent;
              const alter = Number(pitchNode.querySelector("alter")?.textContent || 0);
              const octave = pitchNode.querySelector("octave")?.textContent;
              if (!/^[A-G]$/.test(step || "") || octave == null) continue;
              const pitch = `${step}${alter === 1 ? "#" : alter === -1 ? "b" : ""}${octave}`;
              const staff = element.querySelector(":scope > staff")?.textContent === "2" ? "L" : "R";
              const fingering = element.querySelector("technical fingering")?.textContent?.trim() || "";
              notes.push({ id: uid(), pitch, measure: actualMeasure, beat: Math.max(0, cursor), duration: Math.max(.0625, duration), hand: staff, finger: fingering, dynamic });
              if (!element.querySelector(":scope > chord")) cursor += duration;
            }
          }
        }
        if (!notes.length) throw new Error("No pitched notes were found in this MusicXML file.");
        return normalizeProject({ title, composer, tempo, meter, key, instrument, measureCount: measureNumber, notes });
      }
      function importFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => { $("#import-error").textContent = `Could not read the file: ${reader.error?.message || "unknown file error"}`; };
        reader.onload = () => {
          try {
            const text = String(reader.result || "");
            const extension = file.name.split(".").pop().toLowerCase();
            let project;
            if (extension === "json") {
              const data = JSON.parse(text);
              project = normalizeProject(data.score || data);
              if (data.confidence) project.analysis = data.confidence;
              if (data.source) project.source = data.source;
            } else if (extension === "xml" || extension === "musicxml") {
              project = importMusicXml(text, file.name.replace(/\.(musicxml|xml)$/i, ""));
            } else {
              throw new Error("Use an uncompressed MusicXML (.musicxml or .xml) file, or a Sonora JSON backup.");
            }
            state.projects.unshift(project);
            state.currentId = project.id;
            state.view = "studio";
            state.undo = [];
            state.redo = [];
            persist();
            closeDialogs();
            render();
            showToast(`${project.notes.length} notes imported from ${file.name}.`);
          } catch (error) {
            $("#import-error").textContent = error.message;
          }
        };
        reader.readAsText(file);
      }
      function addSequence(text) {
        const project = current();
        if (!project) throw new Error("Create or open a score first.");
        const tokens = text.trim().split(/[\s,;]+/).filter(Boolean);
        if (!tokens.length) throw new Error("Enter at least one note, such as C4:1 D4:1.");
        const parsed = tokens.map(token => {
          const match = /^([A-Ga-g])([#b♭]?)(-?\d+)(?::([\d.]+))?$/.exec(token);
          if (!match) throw new Error(`Could not read “${token}”. Use note names such as C4 or F#3:0.5.`);
          const pitch = `${match[1].toUpperCase()}${match[2] === "♭" ? "b" : match[2]}${match[3]}`;
          const duration = match[4] == null ? 1 : Number(match[4]);
          if (noteMidi(pitch) === null || !Number.isFinite(duration) || duration <= 0) throw new Error(`“${token}” has an invalid pitch or duration.`);
          return { pitch, duration };
        });
        snapshot();
        let measure = project.notes.reduce((max, note) => Math.max(max, note.measure), 1);
        let beat = 0;
        const bar = beatsInBar(project);
        const last = sortedNotes(project).at(-1);
        if (last) {
          measure = last.measure;
          beat = last.beat + last.duration;
          while (beat >= bar) { beat -= bar; measure++; }
        }
        for (const item of parsed) {
          while (beat >= bar) { beat -= bar; measure++; }
          project.notes.push({ id: uid(), pitch: item.pitch, measure, beat, duration: item.duration, hand: "R", finger: "", dynamic: "mf" });
          beat += item.duration;
        }
        project.measureCount = Math.max(project.measureCount, measure);
        persist();
        render();
        showToast(`${parsed.length} note${parsed.length === 1 ? "" : "s"} added to the score.`);
      }
      function downloadAction(kind) {
        if (kind === "export-midi") exportMidi();
        else if (kind === "export-score-sheet") exportScoreSheet();
        else if (kind === "export-musicxml") exportMusicXml();
        else if (kind === "export-json") exportJson();
        else if (kind === "print") printScoreSheet();
      }
      function keyOptions(selected) {
        return Object.keys(KEY_FIFTHS).map(key => `<option value="${esc(key)}" ${key === selected ? "selected" : ""}>${esc(key)}</option>`).join("");
      }
      function durationOptions(selected) {
        return DURATIONS.map(([value, label]) => `<option value="${value}" ${Math.abs(Number(selected) - Number(value)) < .001 ? "selected" : ""}>${label}</option>`).join("");
      }
      function noteY(pitch, hand) {
        const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
        if (!match) return hand === "L" ? 128 : 70;
        const letter = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }[match[1]];
        const diatonic = Number(match[3]) * 7 + letter;
        const base = hand === "L" ? 2 * 7 + 4 : 4 * 7 + 2;
        const lineBase = hand === "L" ? 130 : 75;
        return lineBase - (diatonic - base) * 5.5;
      }
      function renderMeasure(project, measureNumber, notesByMeasure) {
        const measureNotes = notesByMeasure.get(measureNumber) || [];
        if (!measureNotes.length) return `<article class="measure"><div class="measure-top"><span>Measure ${measureNumber}</span><span>${project.meter}</span></div><div class="measure-empty">Empty measure</div></article>`;
        const trebleLines = [0, 1, 2, 3, 4].map(step => `<line class="staff-line" x1="25" y1="${75 - step * 11}" x2="221" y2="${75 - step * 11}"/>`).join("");
        const bassLines = [0, 1, 2, 3, 4].map(step => `<line class="staff-line" x1="25" y1="${130 - step * 11}" x2="221" y2="${130 - step * 11}"/>`).join("");
        const notesSvg = measureNotes.map(note => {
          const x = 33 + Math.min(beatsInBar(project), Math.max(0, note.beat)) / beatsInBar(project) * 176;
          const y = Math.max(9, Math.min(151, noteY(note.pitch, note.hand)));
          const staffBase = note.hand === "L" ? 130 : 75;
          const lines = [];
          for (let line = staffBase - 44; line >= 31 && note.hand !== "L"; line -= 11) lines.push(`<line class="staff-line" x1="25" y1="${line}" x2="221" y2="${line}"/>`);
          for (let line = staffBase - 44; line >= 86 && note.hand === "L"; line -= 11) lines.push(`<line class="staff-line" x1="25" y1="${line}" x2="221" y2="${line}"/>`);
          const ledger = y < (note.hand === "L" ? 86 : 31) || y > (note.hand === "L" ? 141 : 86) ? `<line class="staff-line" x1="${x - 7}" y1="${y}" x2="${x + 7}" y2="${y}"/>` : "";
          const accidental = note.pitch.includes("#") ? "♯" : note.pitch.includes("b") ? "♭" : "";
          const notehead = note.duration >= 2 ? "note-head hollow" : "note-head";
          const stem = note.duration >= 4 ? "" : `<line class="note-stem" x1="${x + 3.7}" y1="${y}" x2="${x + 3.7}" y2="${y - 19}"/>`;
          const noteMark = state.noteNamesVisible
            ? `<text class="note-name-label" x="${x}" y="${y}">${esc(note.pitch)}</text>`
            : `<ellipse class="${notehead}" cx="${x}" cy="${y}" rx="4.3" ry="3.1" transform="rotate(-20 ${x} ${y})"/>${stem}${accidental ? `<text class="note-accidental" x="${x - 12}" y="${y + 3}">${accidental}</text>` : ""}`;
          return `${ledger}<g class="score-note" data-note-id="${esc(note.id)}"><title>${esc(note.pitch)}, measure ${note.measure}, beat ${note.beat + 1}, ${note.duration} beats</title>${noteMark}</g>`;
        }).join("");
        return `<article class="measure" data-measure="${measureNumber}"><div class="measure-top"><span>Measure ${measureNumber}</span><span>${project.meter}</span></div><svg viewBox="0 0 230 158" role="img" aria-label="Measure ${measureNumber}: ${measureNotes.map(note => note.pitch).join(", ")}"><text x="3" y="57" fill="#849087" font-size="29" font-family="Georgia,serif">𝄞</text><text x="3" y="114" fill="#849087" font-size="23" font-family="Georgia,serif">𝄢</text>${trebleLines}${bassLines}${notesSvg}<line class="bar-line" x1="224" y1="31" x2="224" y2="141"/></svg></article>`;
      }
      function analyses(project) {
        const issues = [];
        const bar = beatsInBar(project);
        const range = RANGES[project.instrument] || RANGES.Other;
        for (const note of project.notes) {
          const midi = noteMidi(note.pitch);
          if (note.beat + note.duration > bar + .001) issues.push({ kind: "error", text: `${note.pitch} in measure ${note.measure} extends past the ${project.meter} bar. Move it or shorten its duration.` });
          if (midi != null && (midi < range[0] || midi > range[1])) issues.push({ kind: "warn", text: `${note.pitch} is outside the usual ${project.instrument.toLowerCase()} range.` });
        }
        const seen = new Set();
        const uniqueIssues = issues.filter(issue => {
          const key = `${issue.kind}:${issue.text}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 8);
        return uniqueIssues;
      }
      function chordNames(project) {
        const pitchNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
        const qualities = [
          ["major", [0, 4, 7]], ["minor", [0, 3, 7]], ["diminished", [0, 3, 6]], ["augmented", [0, 4, 8]]
        ];
        const result = [];
        const maxMeasure = Math.max(1, project.measureCount, ...project.notes.map(note => note.measure));
        for (let measure = 1; measure <= maxMeasure; measure++) {
          const pitches = new Set(project.notes.filter(note => note.measure === measure).map(note => {
            const midi = noteMidi(note.pitch);
            return midi == null ? -1 : midi % 12;
          }).filter(pitch => pitch >= 0));
          let found = "";
          for (let root = 0; root < 12 && !found; root++) {
            for (const [quality, intervals] of qualities) {
              if (intervals.every(interval => pitches.has((root + interval) % 12))) {
                found = `${pitchNames[root]} ${quality}`;
                break;
              }
            }
          }
          result.push({ measure, chord: found || (pitches.size ? `${pitches.size} pitch classes` : "—") });
        }
        return result;
      }
      function renderNotesTable(project) {
        const notes = sortedNotes(project);
        if (!notes.length) return `<div class="empty-notes">This score has no notes yet.<br>Use <b>Add note</b>, paste a sequence, or import MusicXML.</div>`;
        const rows = notes.map((note, index) => `<tr data-note-row="${esc(note.id)}"><td><span class="row-number">${index + 1}</span></td><td><input aria-label="Pitch, note ${index + 1}" type="text" list="pitch-list" data-note-field="pitch" data-note-id="${esc(note.id)}" value="${esc(note.pitch)}"></td><td><input aria-label="Measure, note ${index + 1}" type="number" min="1" step="1" data-note-field="measure" data-note-id="${esc(note.id)}" value="${note.measure}"></td><td><input aria-label="Beat, note ${index + 1}" type="number" min="1" step="0.25" data-note-field="beat" data-note-id="${esc(note.id)}" value="${Number(note.beat) + 1}"></td><td><input aria-label="Duration, note ${index + 1}" type="number" min="0.0625" step="0.0625" data-note-field="duration" data-note-id="${esc(note.id)}" value="${esc(note.duration)}"></td><td><select aria-label="Hand, note ${index + 1}" data-note-field="hand" data-note-id="${esc(note.id)}"><option value="R" ${note.hand === "R" ? "selected" : ""}>RH</option><option value="L" ${note.hand === "L" ? "selected" : ""}>LH</option></select></td><td><input aria-label="Fingering, note ${index + 1}" title="Suggested fingering (1–5)" type="number" min="1" max="5" step="1" data-note-field="finger" data-note-id="${esc(note.id)}" value="${esc(note.finger)}" placeholder="–"></td><td><select aria-label="Dynamic, note ${index + 1}" data-note-field="dynamic" data-note-id="${esc(note.id)}">${DYNAMICS.map(dynamic => `<option value="${dynamic}" ${note.dynamic === dynamic ? "selected" : ""}>${dynamic}</option>`).join("")}</select></td><td><span class="row-number" title="${note.confidence == null ? "No model activation score" : "Uncalibrated model activation estimate"}">${note.confidence == null ? "—" : `${Math.round(note.confidence * 100)}%`}</span></td><td><button class="delete-row" type="button" data-action="delete-note" data-note-id="${esc(note.id)}" aria-label="Delete ${esc(note.pitch)}">×</button></td></tr>`).join("");
        return `<datalist id="pitch-list">${NOTE_OPTIONS.map(pitch => `<option value="${pitch}">`).join("")}</datalist><div class="notes-scroll"><table class="notes-table"><thead><tr><th style="width:28px">#</th><th style="width:59px">Pitch</th><th style="width:48px">Bar</th><th style="width:47px">Beat</th><th style="width:72px">Length</th><th style="width:43px">Hand</th><th style="width:45px">Finger</th><th style="width:48px">Dyn.</th><th style="width:42px">AI</th><th style="width:32px"></th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }
      function commonHead(title, description, actions = "") {
        return `<div class="page-head"><div><div class="eyebrow">Sonora music workspace</div><h1>${title}</h1><p class="subtitle">${description}</p></div>${actions}</div>`;
      }
      function renderStudio(project) {
        if (!project) return `${commonHead("Your score studio", "Create or import a score to begin.")}<button class="button primary" data-action="new-project">Create a score</button>`;
        const maxMeasure = Math.max(project.measureCount, ...project.notes.map(note => note.measure), 1);
        const notesByMeasure = new Map();
        for (const note of project.notes) {
          if (!notesByMeasure.has(note.measure)) notesByMeasure.set(note.measure, []);
          notesByMeasure.get(note.measure).push(note);
        }
        const issues = analyses(project);
        const chords = chordNames(project);
        const lastDate = project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : "This device";
        const settingBar = `<section class="card toolbar-card" aria-label="Score settings"><div class="project-title-wrap"><label class="field-label" for="project-title">Score title</label><input id="project-title" class="title-input" type="text" maxlength="100" data-project-field="title" value="${esc(project.title)}"></div><div class="settings"><label class="setting wide"><span class="field-label">Composer</span><input type="text" maxlength="100" placeholder="Optional" data-project-field="composer" value="${esc(project.composer)}"></label><label class="setting wide"><span class="field-label">Instrument</span><select data-project-field="instrument">${["Piano", "Guitar", "Violin", "Flute", "Other"].map(instrument => `<option ${project.instrument === instrument ? "selected" : ""}>${instrument}</option>`).join("")}</select></label><label class="setting"><span class="field-label">Tempo · BPM</span><input type="number" min="1" data-project-field="tempo" value="${project.tempo}"></label><label class="setting"><span class="field-label">Measures</span><input type="number" min="1" step="1" data-project-field="measureCount" value="${maxMeasure}"></label><label class="setting"><span class="field-label">Time</span><input type="text" maxlength="16" placeholder="4/4" data-project-field="meter" value="${esc(project.meter)}"></label><label class="setting wide"><span class="field-label">Key</span><select data-project-field="key">${keyOptions(project.key)}</select></label></div></section>`;
        const measures = Array.from({ length: maxMeasure }, (_, index) => renderMeasure(project, index + 1, notesByMeasure)).join("");
        const issueHtml = issues.length ? issues.map(issue => `<div class="notice-item ${issue.kind === "error" ? "error" : ""}"><span class="notice-mark">${issue.kind === "error" ? "!" : "•"}</span><span>${esc(issue.text)}</span></div>`).join("") : `<div class="notice-empty">No meter or instrument-range flags. This rule check is advisory, not a substitute for music-theory review.</div>`;
        const chordHtml = chords.map(item => `<span class="chord-chip"><b>m.${item.measure}</b>&nbsp; ${esc(item.chord)}</span>`).join("");
        const noteCount = project.notes.length;
        const confidence = noteCount ? "Entered / imported · not AI-verified" : "Waiting for notes";
        const confidenceScore = Number.isFinite(Number(project.analysis?.score)) ? `<span class="confidence-badge"><b>${(Number(project.analysis.score) * 100).toFixed(1)}%</b> model activation</span>` : `<span class="confidence-badge">No calibrated score provided</span>`;
        const confidenceDescription = project.analysis?.description || "This score was entered or imported without an AI confidence estimate.";
        return `${commonHead("Score studio", "Edit every note, check the notation, and hear it back.")}${settingBar}<div class="editor-grid">
          <section class="card score-card" aria-label="Score notation">
            <div class="print-score-heading"><strong>${esc(project.title)}</strong>${project.composer ? `<span>${esc(project.composer)}</span>` : ""}<span>${esc(project.instrument)} · ${project.tempo} BPM · ${esc(project.key)} · ${esc(project.meter)}</span></div>
            <div class="card-head"><div><h2>Notation preview</h2><p>${esc(project.instrument)} · ${noteCount} note${noteCount === 1 ? "" : "s"} · ${maxMeasure} measure${maxMeasure === 1 ? "" : "s"}</p></div><div class="card-head-actions"><button class="button" type="button" data-action="toggle-note-names" aria-pressed="${state.noteNamesVisible}" title="Replace note symbols with their pitch names">${state.noteNamesVisible ? "Show symbols" : "Show note names"}</button><button class="button" type="button" data-action="undo" ${state.undo.length ? "" : "disabled"} aria-label="Undo">↶</button><button class="button" type="button" data-action="redo" ${state.redo.length ? "" : "disabled"} aria-label="Redo">↷</button><button class="button" type="button" data-action="transpose-down" aria-label="Transpose down">−½</button><button class="button" type="button" data-action="transpose-up" aria-label="Transpose up">+½</button></div></div>
            <div class="score-scroll"><div class="measure-grid">${measures}</div></div>
            <div class="score-meta"><span class="meta-chip">${esc(project.key)}</span><span class="meta-chip">${project.tempo} BPM</span><span class="meta-chip">${esc(project.meter)} time</span><span class="meta-chip">${esc(lastDate)}</span></div>
          </section>
          <div class="side-stack">
            <section class="card notes-card" aria-label="Editable note list"><div class="card-head"><div><h2>Every note</h2><p>Edit pitch, timing, hand, fingering, and dynamics.</p></div><span class="note-count">${noteCount} total</span></div>${renderNotesTable(project)}<div class="notes-actions"><button class="button" type="button" data-action="add-note">＋ Add note</button><button class="button" type="button" data-action="add-chord">＋ Chord tone</button><button class="button" type="button" data-action="add-measure">＋ Measure</button></div></section>
            <section class="card" aria-label="AI confidence estimate"><div class="card-head"><div><h2>Analysis confidence</h2><p>Uncertain notes are highlighted in the note list.</p></div></div><div class="harmony">${confidenceScore}</div><div class="confidence-note">${esc(confidenceDescription)}${project.analysis?.notesScored ? ` · ${project.analysis.notesScored} notes scored` : ""}</div></section>
            <section class="card" aria-label="Music playback"><div class="card-head"><div><h2>Play &amp; practice</h2><p>Choose an instrument-style synthesized tone for playback.</p></div></div><div class="practice-bar"><button class="play-button" type="button" data-action="${state.playing ? "stop" : "play"}">${state.playing ? "■ Stop" : "▶ Play"}</button><select class="speed-select" aria-label="Playback speed" id="play-speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option></select><select class="sound-select" aria-label="Playback sound" id="playback-sound">${PLAYBACK_SOUNDS.map(sound => `<option value="${sound}" ${project.playbackSound === sound ? "selected" : ""}>${sound}</option>`).join("")}</select><span class="play-status" id="play-status">${state.playing ? "Playing score…" : `${project.tempo} BPM · synthesized locally`}</span></div></section>
            <section class="card" aria-label="Score checks"><div class="card-head"><div><h2>Score checks</h2><p>Meter and instrument-range checks</p></div></div><div class="notice-list">${issueHtml}</div></section>
            <section class="card" aria-label="Harmony estimate"><div class="card-head"><div><h2>Harmony overview</h2><p>Pitch-class summary by measure</p></div></div><div class="harmony">${chordHtml}</div><div class="confidence-note">Confidence: ${esc(confidence)}. Chord labels are rule-based estimates, not an AI transcription.</div></section>
          </div>
        </div>`;
      }
      function renderLibrary() {
        const query = state.filter.trim().toLowerCase();
        const projects = state.projects.filter(project => !query || `${project.title} ${project.instrument} ${project.composer}`.toLowerCase().includes(query));
        const cards = projects.length ? projects.map(project => `<article class="card project-card"><div class="project-card-top"><h3><button class="project-card-open" type="button" data-open-project="${esc(project.id)}"> ${esc(project.title)}</button></h3><button class="delete-row" type="button" data-action="delete-project" data-project-id="${esc(project.id)}" aria-label="Delete ${esc(project.title)}">×</button></div><p>${esc(project.instrument)}${project.composer ? ` · ${esc(project.composer)}` : ""}</p><div class="project-card-meta"><span>${project.notes.length} notes</span><span>${Math.max(project.measureCount, ...project.notes.map(note => note.measure), 1)} measures</span><span>${project.tempo} BPM</span></div></article>`).join("") : state.projects.length ? `<div class="card library-empty">No scores match this search. Try another title or clear your search.</div>` : `<div class="card library-empty"><b>Your score library is empty.</b><p>Create a score or import one to get started. Your work will be saved in this browser.</p><div class="practice-empty-actions"><button class="button primary" type="button" data-action="new-project">＋ Create a score</button><button class="button" type="button" data-action="import">Import score</button></div></div>`;
        return `${commonHead("My scores", "Your saved work, right here on this device.", `<button class="button primary" type="button" data-action="new-project">＋ New score</button>`)}<div class="library-tools"><input class="search-input" type="search" id="library-search" placeholder="Search your scores…" value="${esc(state.filter)}" aria-label="Search your scores"><button class="button" type="button" data-action="import">Import score</button></div><div class="library-grid">${cards}</div>`;
      }
      function renderPractice(project) {
        if (!project) return `${commonHead("Practice", "Choose a score to begin practicing.")}<div class="card library-empty">There isn’t a score selected yet.<div class="practice-empty-actions"><button class="button primary" type="button" data-action="new-project">＋ Create a score</button><button class="button" type="button" data-view="library">Choose from My scores</button></div></div>`;
        const maxMeasure = Math.max(project.measureCount, ...project.notes.map(note => note.measure), 1);
        const startMeasure = Math.min(maxMeasure, Math.max(1, Number(state.practiceStart) || 1));
        const endMeasure = Math.min(maxMeasure, Math.max(startMeasure, Number(state.practiceEnd) || maxMeasure));
        const hand = ["both", "R", "L"].includes(state.practiceHand) ? state.practiceHand : "both";
        const notes = sortedNotes(project).filter(note => note.measure >= startMeasure && note.measure <= endMeasure && (hand === "both" || note.hand === hand));
        const rows = notes.map(note => `<button class="practice-note" type="button" data-action="preview-note" data-note-id="${esc(note.id)}" data-practice-note="${esc(note.id)}" aria-label="Hear ${esc(note.pitch)}, measure ${note.measure}, beat ${note.beat + 1}"><span>m. ${note.measure}</span><b>${esc(note.pitch)}</b><span>Beat ${note.beat + 1} · ${note.duration} beat${note.duration === 1 ? "" : "s"}</span><small>${note.dynamic || "mf"}${note.hand === "L" ? " · LH" : " · RH"}</small></button>`).join("");
        const speed = [0.5, 0.75, 1].includes(Number(state.practiceSpeed)) ? Number(state.practiceSpeed) : 1;
        return `${commonHead("Practice room", `${esc(project.title)} · ${esc(project.instrument)} · ${project.tempo} BPM`, `<button class="button primary" type="button" data-action="${state.playing ? "stop" : "play"}">${state.playing ? "■ Stop" : "▶ Play section"}</button>`)}<div class="practice-layout"><section class="card"><div class="card-head"><div><h2>Practice section</h2><p>Choose a passage and tap any note to hear it.</p></div><span class="note-count">${notes.length} note${notes.length === 1 ? "" : "s"}</span></div><div class="practice-progress" role="progressbar" aria-label="Practice playback progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="practice-progress"></span></div><div class="practice-controls"><label>From measure<input id="practice-start" type="number" min="1" value="${startMeasure}"></label><label>To measure<input id="practice-end" type="number" min="1" value="${endMeasure}"></label><label>Hands<select id="practice-hand"><option value="both" ${hand === "both" ? "selected" : ""}>Both hands</option><option value="R" ${hand === "R" ? "selected" : ""}>Right hand</option><option value="L" ${hand === "L" ? "selected" : ""}>Left hand</option></select></label><label>Practice speed<select id="practice-speed"><option value="0.5" ${speed === 0.5 ? "selected" : ""}>Slow · 0.5×</option><option value="0.75" ${speed === 0.75 ? "selected" : ""}>Steady · 0.75×</option><option value="1" ${speed === 1 ? "selected" : ""}>Score tempo · 1×</option></select></label><label class="practice-loop"><input id="practice-loop" type="checkbox" ${state.practiceLoop ? "checked" : ""}> Repeat this section</label></div><div class="practice-notes">${rows || `<div class="empty-notes">${project.notes.length ? "No notes in this section for the selected hand. Try Both hands or another measure range." : "Add notes in Studio to start practicing."}</div>`}</div></section><aside class="card practice-tip"><h2>Make it your practice</h2><p>Start slowly with one hand, then widen the measure range and try both hands. Turn on repeat to loop the selected passage. Tap a note in the list to hear that pitch on its own.</p><p style="margin-top:10px">Playback uses a synthesized ${esc(project.playbackSound)}-style tone, not a sampled instrument recording.</p><div class="practice-empty-actions"><button class="button" type="button" data-action="open-studio">Edit this score</button></div></aside></div>`;
      }
      function renderDiscover() {
        return `${commonHead("Discover music", "Find music, preview performances, or create a score from audio or video.")}
          <section class="card"><div class="card-head"><div><h2>Find scores and recordings</h2><p>Search catalog metadata from MusicBrainz and the Internet Archive. Only use results when their rights allow downloading.</p></div></div><form class="discovery-search" id="catalog-form" style="padding:12px"><input id="catalog-query" type="search" minlength="2" maxlength="120" placeholder="Try “Für Elise” or “Debussy Clair de Lune”" aria-label="Search music catalogs" required><button class="button primary" type="submit" data-action="search-catalog">Search catalogs</button></form><div class="search-results" id="catalog-results"><div class="result-empty">Search public catalogs, then open the original item to verify its rights and download a copy. Sonora does not bypass paywalls or paid-sheet restrictions.</div><div class="practice-empty-actions"><a class="button" href="https://imslp.org/" target="_blank" rel="noopener noreferrer">IMSLP public domain</a><a class="button" href="https://musopen.org/music/" target="_blank" rel="noopener noreferrer">Musopen free music</a><a class="button" href="https://www.mutopiaproject.org/" target="_blank" rel="noopener noreferrer">Mutopia public domain</a></div></div></section>
          <div class="discover-grid"><section class="card"><div class="card-head"><div><h2>Create a score from audio or video</h2><p>Upload a recording or video performance to detect notes and make an editable score.</p></div></div><div class="practice-tip"><p>For the clearest results, use a recording with one prominent instrument. Sonora does not apply an application-defined duration or file-size cutoff.</p><p style="margin-top:8px">YouTube links can be downloaded or analyzed only after you confirm that you own or are authorized to use the video. Sonora does not bypass restrictions or paid/copyright-protected downloads.</p><p style="margin-top:8px">Unsupported, unreadable, or non-musical inputs are rejected when no score or notes can be recognized.</p><div class="practice-empty-actions"><button class="button primary" type="button" data-action="open-audio-analysis">Choose audio file</button><button class="button" type="button" data-action="open-video-analysis">Choose video file</button></div></div></section><section class="card"><div class="card-head"><div><h2>Preview and analyze a YouTube link</h2><p>Authorized videos can be downloaded or transcribed directly.</p></div></div><form class="discovery-search" id="youtube-form" style="padding:12px"><input id="youtube-url" type="url" placeholder="https://www.youtube.com/watch?v=…" aria-label="YouTube video URL" required><button class="button" type="submit" data-action="youtube-lookup">Preview link</button></form><div class="youtube-preview" id="youtube-result"><div class="result-empty">Paste a YouTube video link, confirm that you own or are authorized to use it, then download or create a score from it.</div></div></section></div>`;
      }
      function render() {
        $("#breadcrumb").textContent = state.view === "library" ? "My scores" : state.view === "practice" ? "Practice" : state.view === "discover" ? "Discover" : "Studio";
        $$(".nav-item").forEach(button => {
          const active = button.dataset.view === state.view;
          button.classList.toggle("active", active);
          if (active) button.setAttribute("aria-current", "page");
          else button.removeAttribute("aria-current");
        });
        const project = current();
        $("#view-root").innerHTML = state.view === "library" ? renderLibrary() : state.view === "practice" ? renderPractice(project) : state.view === "discover" ? renderDiscover() : renderStudio(project);
        $("#recent-projects").innerHTML = state.projects.slice(0, 8).map(item => `<button class="project-shortcut ${item.id === state.currentId ? "current" : ""}" type="button" data-shortcut="${esc(item.id)}" title="${esc(item.title)}"><span class="project-dot"></span>${esc(item.title)}</button>`).join("") || `<span class="project-shortcut">No scores yet</span>`;
        if (state.playing) highlightPlayback();
      }
      function setView(view) {
        if (!["studio", "library", "practice", "discover"].includes(view)) return;
        if (state.playing && view !== state.view) stopPlayback(false);
        state.view = view;
        render();
      }
      function addNote(chord = false) {
        const project = current();
        if (!project) { showToast("Create a score first."); return; }
        snapshot();
        const notes = sortedNotes(project);
        const last = notes.at(-1);
        const bar = beatsInBar(project);
        let measure = last ? last.measure : 1;
        let beat = last ? last.beat + last.duration : 0;
        if (chord && last) beat = last.beat;
        while (beat >= bar) { beat -= bar; measure++; }
        let pitch = "C4";
        if (last) {
          const midi = noteMidi(last.pitch);
          pitch = midi == null ? "C4" : pitchFromMidi(Math.min(96, midi + (chord ? 4 : 2)));
        }
        project.notes.push({ id: uid(), pitch, measure, beat, duration: last?.duration || 1, hand: chord ? (last?.hand === "L" ? "R" : "L") : "R", finger: "", dynamic: last?.dynamic || "mf" });
        project.measureCount = Math.max(project.measureCount, measure);
        persist();
        render();
        const target = document.querySelector(`tr[data-note-row="${CSS.escape(project.notes.at(-1).id)}"] input`);
        if (target) { target.focus(); target.select(); }
      }
      function addMeasure() {
        const project = current();
        if (!project) return;
        snapshot();
        project.measureCount = Math.max(project.measureCount, ...project.notes.map(note => note.measure), 0) + 1;
        persist();
        render();
      }
      function mutateNote(id, field, rawValue) {
        const project = current();
        const note = project?.notes.find(item => item.id === id);
        if (!note) return;
        let value = rawValue;
        if (field === "measure") {
          value = Number(rawValue);
          if (!Number.isInteger(value) || value < 1) throw new Error("Measure must be a positive whole number.");
        } else if (field === "beat") {
          value = Number(rawValue) - 1;
          if (!Number.isFinite(value) || value < 0) throw new Error("Beat must be 1 or greater.");
        } else if (field === "duration") {
          value = Number(rawValue);
          if (!Number.isFinite(value) || value <= 0) throw new Error("Duration must be greater than zero.");
        } else if (field === "pitch" && noteMidi(rawValue) === null) {
          throw new Error("Enter a note such as C4, F#3, or Bb5.");
        } else if (field === "finger" && rawValue !== "") {
          value = Number(rawValue);
          if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error("Fingering must be 1 through 5, or left blank.");
        } else if (field === "dynamic" && !DYNAMICS.includes(rawValue)) {
          throw new Error("Choose a supported dynamic marking.");
        }
        snapshot();
        note[field] = value;
        project.measureCount = Math.max(project.measureCount, note.measure);
        persist();
        render();
      }
      function transpose(amount) {
        const project = current();
        if (!project || !project.notes.length) return;
        snapshot();
        project.notes = project.notes.map(note => {
          const midi = noteMidi(note.pitch);
          return { ...note, pitch: midi == null ? note.pitch : pitchFromMidi(Math.min(127, Math.max(0, midi + amount))) };
        });
        persist();
        render();
        showToast(`Score transposed ${amount > 0 ? "up" : "down"} ${Math.abs(amount)} semitone${Math.abs(amount) === 1 ? "" : "s"}.`);
      }
      function saveProjectField(input) {
        const project = current();
        if (!project) return;
        const field = input.dataset.projectField;
        let value = input.value;
        if (field === "title") value = value.trim().slice(0, 100) || "Untitled score";
        if (field === "composer") value = value.trim().slice(0, 100);
        if (field === "tempo") {
          value = Number(value);
          if (!Number.isInteger(value) || value < 1) throw new Error("Tempo must be a positive whole number.");
        }
        if (field === "instrument" && !RANGES[value]) throw new Error("Choose a supported instrument.");
        if (field === "key" && KEY_FIFTHS[value] === undefined) throw new Error("Choose a supported key.");
        if (field === "meter" && !/^\d+\/\d+$/.test(value)) throw new Error("Enter a time signature such as 4/4 or 7/8.");
        if (field === "measureCount") {
          value = Number(value);
          if (!Number.isInteger(value) || value < 1) throw new Error("Measure count must be a positive whole number.");
        }
        snapshot();
        project[field] = value;
        if (field === "meter") project.measureCount = Math.max(project.measureCount, ...project.notes.map(note => note.measure), 1);
        persist();
        render();
      }
      function createProject(title, instrument) {
        const project = normalizeProject({ title, instrument, tempo: 96, meter: "4/4", key: "C major", measureCount: 1, notes: [] });
        state.projects.unshift(project);
        state.currentId = project.id;
        state.view = "studio";
        state.undo = [];
        state.redo = [];
        persist();
        render();
        closeDialogs();
        showToast("New score created. Add notes or import a MusicXML file.");
      }
      function deleteProject(id) {
        const project = state.projects.find(item => item.id === id);
        if (!project) return;
        state.pendingDeleteId = id;
        $("#delete-message").textContent = `Delete “${project.title}” from this browser?`;
        openDialog("delete-dialog");
      }
      function confirmDeleteProject() {
        const id = state.pendingDeleteId;
        const project = state.projects.find(item => item.id === id);
        if (!project) { closeDialogs(); state.pendingDeleteId = null; return; }
        const title = project.title;
        if (state.playing && state.currentId === id) stopPlayback(false);
        state.projects = state.projects.filter(item => item.id !== id);
        if (!state.deletedIds.includes(id)) state.deletedIds.push(id);
        if (state.currentId === id) state.currentId = state.projects[0]?.id || null;
        state.undo = [];
        state.redo = [];
        state.pendingDeleteId = null;
        persist();
        closeDialogs();
        render();
        showToast(`“${title}” deleted.`);
      }
      function scheduleInstrumentNote(midi, when, duration, velocity, master, sound) {
        const profiles = {
          Piano: { attack: .008, sustain: .2, decay: .45, partials: [[1, .72, "sine"], [2, .22, "sine"], [3, .08, "sine"]] },
          Guitar: { attack: .004, sustain: .12, decay: .32, partials: [[1, .72, "triangle"], [2, .2, "sine"], [3, .07, "sine"]] },
          Violin: { attack: .09, sustain: .82, partials: [[1, .62, "sawtooth"], [2, .16, "sawtooth"]] },
          Flute: { attack: .035, sustain: .72, partials: [[1, .82, "sine"], [2, .12, "sine"]] },
          Synth: { attack: .012, sustain: .65, partials: [[1, .64, "square"], [2, .12, "sine"]] }
        };
        const profile = profiles[sound] || profiles.Piano;
        const noteGain = state.audio.createGain();
        const peak = Math.max(.001, Math.min(1, velocity / 127)) * .12;
        const attack = Math.min(profile.attack, duration * .3);
        const decayAt = when + Math.max(attack + .001, duration * .5);
        const releaseAt = when + Math.max(attack + .002, duration * .88);
        noteGain.gain.setValueAtTime(.0001, when);
        noteGain.gain.linearRampToValueAtTime(peak, when + attack);
        if (profile.decay) {
          noteGain.gain.exponentialRampToValueAtTime(Math.max(.0001, peak * profile.sustain), decayAt);
        }
        noteGain.gain.setTargetAtTime(.0001, releaseAt, sound === "Violin" ? .08 : .035);
        noteGain.connect(master);
        const sources = [];
        for (const [ratio, level, type] of profile.partials) {
          const oscillator = state.audio.createOscillator();
          const partialGain = state.audio.createGain();
          oscillator.type = type;
          oscillator.frequency.value = 440 * Math.pow(2, (midi - 69) / 12) * ratio;
          partialGain.gain.value = level;
          oscillator.connect(partialGain);
          partialGain.connect(noteGain);
          oscillator.start(when);
          oscillator.stop(when + duration + .12);
          sources.push(oscillator);
        }
        return sources;
      }
      async function previewPracticeNote(id) {
        const project = current();
        const note = project?.notes.find(item => item.id === id);
        const midi = note ? noteMidi(note.pitch) : null;
        if (!project || midi === null) return;
        try {
          if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
          await state.audio.resume();
          if (state.playing) stopPlayback();
          const master = state.audio.createGain();
          master.gain.value = Math.max(.02, Math.min(1, Number($("#play-volume")?.value || .45)));
          master.connect(state.audio.destination);
          const sound = PLAYBACK_SOUNDS.includes(project.playbackSound) ? project.playbackSound : "Piano";
          state.sources.push(...scheduleInstrumentNote(midi, state.audio.currentTime + .02, .45, VELOCITIES[note.dynamic] || 80, master, sound));
        } catch (error) {
          showToast(`Could not preview note: ${error.message}`);
        }
      }
      async function playPlayback(loopRestart = false) {
        const project = current();
        if (!project?.notes.length) { showToast("Add or import notes before playing."); return; }
        try {
          if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
          await state.audio.resume();
          stopPlayback(false);
          const isPractice = state.view === "practice";
          const maxMeasure = Math.max(project.measureCount, ...project.notes.map(note => note.measure), 1);
          const startMeasure = isPractice ? Math.min(maxMeasure, Math.max(1, Number(state.practiceStart) || 1)) : 1;
          const endMeasure = isPractice ? Math.min(maxMeasure, Math.max(startMeasure, Number(state.practiceEnd) || maxMeasure)) : maxMeasure;
          const hand = isPractice && ["R", "L"].includes(state.practiceHand) ? state.practiceHand : "both";
          const selectedNotes = project.notes.filter(note => note.measure >= startMeasure && note.measure <= endMeasure && (hand === "both" || note.hand === hand));
          if (!selectedNotes.length) {
            if (loopRestart) stopPlayback();
            showToast("There are no notes in this section for the selected hand.");
            return;
          }
          const speed = isPractice ? Number(state.practiceSpeed) : Number($("#play-speed")?.value || 1);
          const secondsPerBeat = 60 / project.tempo / (Number.isFinite(speed) && speed > 0 ? speed : 1);
          const startAt = state.audio.currentTime + .08;
          state.playStarted = startAt;
          const barBeats = beatsInBar(project);
          state.playbackStartBeat = (startMeasure - 1) * barBeats;
          const maxNoteBeat = Math.max(...selectedNotes.map(note => (note.measure - 1) * barBeats + note.beat + note.duration));
          state.playbackEndBeat = isPractice ? endMeasure * barBeats : Math.max(maxMeasure * barBeats, maxNoteBeat);
          state.playLength = (state.playbackEndBeat - state.playbackStartBeat) * secondsPerBeat;
          const master = state.audio.createGain();
          master.gain.value = Math.max(.02, Math.min(1, Number($("#play-volume")?.value || .45)));
          master.connect(state.audio.destination);
          state.sources = [];
          const sound = PLAYBACK_SOUNDS.includes(project.playbackSound) ? project.playbackSound : "Piano";
          for (const note of selectedNotes) {
            const midi = noteMidi(note.pitch);
            if (midi == null) continue;
            const absoluteBeat = (note.measure - 1) * barBeats + note.beat;
            const when = startAt + (absoluteBeat - state.playbackStartBeat) * secondsPerBeat;
            const duration = Math.max(.045, note.duration * secondsPerBeat * .92);
            state.sources.push(...scheduleInstrumentNote(midi, when, duration, VELOCITIES[note.dynamic] || 80, master, sound));
          }
          state.playing = true;
          render();
          state.playTimer = setInterval(highlightPlayback, 80);
          state.stopTimer = setTimeout(() => {
            if (state.view === "practice" && state.practiceLoop) playPlayback(true);
            else stopPlayback();
          }, Math.ceil((state.playLength + .3) * 1000));
        } catch (error) {
          state.playing = false;
          showToast(`Audio playback failed: ${error.message}`);
          render();
        }
      }
      function highlightPlayback() {
        if (!state.playing || !state.audio) return;
        const project = current();
        if (!project) return;
        const speed = state.view === "practice" ? Number(state.practiceSpeed) : Number($("#play-speed")?.value || 1);
        const secondsPerBeat = 60 / project.tempo / (Number.isFinite(speed) && speed > 0 ? speed : 1);
        const elapsed = Math.max(0, state.audio.currentTime - state.playStarted);
        const beat = state.playbackStartBeat + elapsed / secondsPerBeat;
        const measure = Math.floor(beat / beatsInBar(project)) + 1;
        const localBeat = beat % beatsInBar(project);
        const hand = state.view === "practice" && ["R", "L"].includes(state.practiceHand) ? state.practiceHand : "both";
        const sounding = project.notes.filter(note => note.measure === measure && (hand === "both" || note.hand === hand) && localBeat >= note.beat && localBeat < note.beat + note.duration);
        $$(".measure.playing").forEach(element => element.classList.remove("playing"));
        $$(".practice-note.active").forEach(element => element.classList.remove("active"));
        const measureElement = document.querySelector(`.measure[data-measure="${measure}"]`);
        if (measureElement) measureElement.classList.add("playing");
        for (const note of sounding) {
          const row = document.querySelector(`[data-practice-note="${CSS.escape(note.id)}"]`);
          if (row) row.classList.add("active");
        }
        const status = $("#play-status");
        if (status) status.textContent = `Measure ${Math.min(measure, Math.ceil(state.playbackEndBeat / beatsInBar(project)))} · beat ${Math.floor(localBeat) + 1}`;
        const progress = $("#practice-progress");
        if (progress) {
          const percent = state.playLength ? Math.min(100, Math.max(0, ((state.audio.currentTime - state.playStarted) / state.playLength) * 100)) : 0;
          progress.style.width = `${percent}%`;
          progress.parentElement.setAttribute("aria-valuenow", String(Math.round(percent)));
        }
      }
      function stopPlayback(renderAfter = true) {
        if (state.playTimer) clearInterval(state.playTimer);
        if (state.stopTimer) clearTimeout(state.stopTimer);
        state.playTimer = null;
        state.stopTimer = null;
        for (const source of state.sources) {
          try { source.stop(); } catch (_) { /* A scheduled oscillator may already have ended. */ }
        }
        state.sources = [];
        state.playing = false;
        $$(".measure.playing, .practice-note.active").forEach(element => element.classList.remove("playing", "active"));
        if (renderAfter && $("#view-root")) render();
      }

      document.addEventListener("click", event => {
        const nav = event.target.closest("[data-view]");
        if (nav) { setView(nav.dataset.view); return; }
        const shortcut = event.target.closest("[data-shortcut]");
        if (shortcut) { state.currentId = shortcut.dataset.shortcut; state.view = "studio"; state.undo = []; state.redo = []; persist(); render(); return; }
        const openCard = event.target.closest("[data-open-project]");
        if (openCard) {
          state.currentId = openCard.dataset.openProject; state.view = "studio"; state.undo = []; state.redo = []; persist(); render(); return;
        }
        const action = event.target.closest("[data-action]");
        if (!action) return;
        const name = action.dataset.action;
        try {
          if (name === "new-project") { $("#project-error").textContent = ""; openDialog("project-dialog"); $("#new-title").focus(); }
          else if (name === "open-cloud") { populateCloudFields(); openDialog("cloud-dialog"); }
          else if (name === "cloud-sign-in") cloudSignIn(false);
          else if (name === "cloud-sign-up") cloudSignIn(true);
          else if (name === "cloud-reset-password") cloudResetPassword();
          else if (name === "cloud-sync") syncCloudLibrary().catch(error => showToast(`Cloud sync failed: ${error.message}`));
          else if (name === "cloud-sign-out") cloudSignOut().catch(error => { $("#cloud-error").textContent = error.message; updateCloudUi(error.message, true); });
          else if (name === "import") { $("#import-error").textContent = ""; openDialog("import-dialog"); }
          else if (name === "open-analysis" || name === "open-audio-analysis" || name === "open-video-analysis") {
            $("#analysis-error").textContent = "";
            if (name !== "open-analysis") {
              $("#analysis-kind").value = name === "open-video-analysis" ? "video" : "audio";
              $("#analysis-kind").dispatchEvent(new Event("change", { bubbles: true }));
            }
            openDialog("analysis-dialog");
            checkBackend();
          } else if (name === "open-result-analysis") {
            $("#analysis-error").textContent = "";
            $("#analysis-kind").value = action.dataset.resultKind === "audio" ? "audio" : "score";
            $("#analysis-kind").dispatchEvent(new Event("change", { bubbles: true }));
            openDialog("analysis-dialog");
            checkBackend();
          }
          else if (name === "toggle-note-names") { state.noteNamesVisible = !state.noteNamesVisible; persist(); render(); }
          else if (name === "run-analysis") runAnalysis();
          else if (name === "close-dialog") closeDialogs();
          else if (name === "cancel-delete") { state.pendingDeleteId = null; closeDialogs(); }
          else if (name === "confirm-delete") confirmDeleteProject();
          else if (name === "export-menu") { $("#export-error").textContent = ""; openDialog("export-dialog"); }
          else if (name === "export-midi" || name === "export-score-sheet" || name === "export-musicxml" || name === "export-json" || name === "print") downloadAction(name);
          else if (name === "add-note") addNote(false);
          else if (name === "add-chord") addNote(true);
          else if (name === "add-measure") addMeasure();
          else if (name === "delete-note") {
            const project = current();
            snapshot();
            project.notes = project.notes.filter(note => note.id !== action.dataset.noteId);
            persist(); render();
          } else if (name === "delete-project") { event.stopPropagation(); deleteProject(action.dataset.projectId); }
          else if (name === "undo") applyHistory(state.undo, state.redo);
          else if (name === "redo") applyHistory(state.redo, state.undo);
          else if (name === "transpose-up") transpose(1);
          else if (name === "transpose-down") transpose(-1);
          else if (name === "play") playPlayback();
          else if (name === "stop") stopPlayback();
          else if (name === "youtube-download") downloadYouTube(action.dataset.url);
          else if (name === "youtube-analyze") analyzeYouTube(action.dataset.url);
          else if (name === "preview-note") previewPracticeNote(action.dataset.noteId);
          else if (name === "open-studio") setView("studio");
          else if (name === "import-sequence") {
            try {
              addSequence($("#sequence-input").value);
              $("#sequence-input").value = "";
              $("#import-error").textContent = "";
              closeDialogs();
            } catch (error) { $("#import-error").textContent = error.message; }
          }
        } catch (error) {
          showToast(error.message);
        }
      });
      document.addEventListener("change", event => {
        const input = event.target;
        if (input.id === "practice-start" || input.id === "practice-end" || input.id === "practice-hand" || input.id === "practice-speed" || input.id === "practice-loop") {
          if (input.id === "practice-start" || input.id === "practice-end") {
            const project = current();
            const maxMeasure = project ? Math.max(project.measureCount, ...project.notes.map(note => note.measure), 1) : 1;
            const rawValue = Number(input.value);
            if (!Number.isInteger(rawValue) || rawValue < 1 || rawValue > maxMeasure) {
              showToast(`Choose a measure between 1 and ${maxMeasure}.`);
              render();
              return;
            }
            if (input.id === "practice-start") {
              state.practiceStart = rawValue;
              if (state.practiceEnd && state.practiceEnd < rawValue) state.practiceEnd = rawValue;
            } else {
              state.practiceEnd = Math.max(state.practiceStart, rawValue);
            }
          } else if (input.id === "practice-hand") state.practiceHand = input.value;
          else if (input.id === "practice-speed") state.practiceSpeed = Number(input.value);
          else state.practiceLoop = input.checked;
          if (state.playing && input.id !== "practice-loop") stopPlayback(false);
          render();
          return;
        }
        if (input.id === "playback-sound") {
          const project = current();
          if (project && PLAYBACK_SOUNDS.includes(input.value)) {
            project.playbackSound = input.value;
            persist();
            if (state.playing) stopPlayback();
            else render();
          }
          return;
        }
        if (input.id === "import-file") { importFile(input.files?.[0]); input.value = ""; return; }
        if (input.id === "analysis-kind") {
          $("#analysis-file").value = "";
          $("#analysis-file").accept = input.value === "score" ? "image/*,.pdf,.xml,.musicxml" : input.value === "video" ? "video/*,.mp4,.mov,.m4v,.mkv,.webm,.avi" : "audio/*,.wav,.mp3,.m4a,.flac,.ogg,.aiff,.aif";
          $("#analysis-file-label").textContent = input.value === "score" ? "Choose score image, PDF, or MusicXML" : input.value === "video" ? "Choose video file" : "Choose audio file";
          document.querySelector('[data-action="run-analysis"]').textContent = input.value === "score" ? "Analyze score" : "Transcribe performance";
          $("#analysis-error").textContent = "";
          return;
        }
        if (input.matches("[data-note-field]")) {
          try { mutateNote(input.dataset.noteId, input.dataset.noteField, input.value); }
          catch (error) { showToast(error.message); render(); }
          return;
        }
        if (input.matches("[data-project-field]")) {
          try { saveProjectField(input); }
          catch (error) { showToast(error.message); render(); }
        }
      });
      document.addEventListener("input", event => {
        const input = event.target;
        if (input.id === "library-search") {
          state.filter = input.value;
          const selection = [input.selectionStart, input.selectionEnd];
          render();
          const replacement = $("#library-search");
          replacement.focus();
          replacement.setSelectionRange(selection[0], selection[1]);
          return;
        }
        if (input.matches("[data-project-field='title']")) {
          const project = current();
          if (project) {
            project.title = input.value.slice(0, 100) || "Untitled score";
            persist();
            $("#recent-projects").innerHTML = state.projects.slice(0, 8).map(item => `<button class="project-shortcut ${item.id === state.currentId ? "current" : ""}" type="button" data-shortcut="${esc(item.id)}" title="${esc(item.title)}"><span class="project-dot"></span>${esc(item.title)}</button>`).join("");
          }
        }
      });
      document.addEventListener("submit", event => {
        const form = event.target;
        if (form.id === "project-form") {
          event.preventDefault();
          try { createProject($("#new-title").value, $("#new-instrument").value); }
          catch (error) { $("#project-error").textContent = error.message; }
          return;
        }
        if (form.id === "catalog-form") {
          event.preventDefault();
          searchCatalog();
          return;
        }
        if (form.id === "youtube-form") {
          event.preventDefault();
          lookupYouTube();
        }
      });
      window.addEventListener("beforeunload", () => { if (state.playing) stopPlayback(false); });
      loadState();
      render();
      checkBackend();
      restoreCloudAccount();
      window.addEventListener("focus", () => {
        if (state.cloud.ready) syncCloudLibrary().catch(error => showToast(`Cloud sync failed: ${error.message}`));
      });
    })();
