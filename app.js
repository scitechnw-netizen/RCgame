(() => {
  "use strict";

  const STORAGE = {
    sessionId: "rcQuest.sessionId",
    deviceToken: "rcQuest.deviceToken",
    teamId: "rcQuest.teamId"
  };

  const screens = [...document.querySelectorAll(".screen")];
  const loadingScreen = document.getElementById("loadingScreen");
  const setupScreen = document.getElementById("setupScreen");
  const gameScreen = document.getElementById("gameScreen");
  const completeScreen = document.getElementById("completeScreen");
  const errorScreen = document.getElementById("errorScreen");
  const teamGrid = document.getElementById("teamGrid");
  const startButton = document.getElementById("startButton");
  const answerForm = document.getElementById("answerForm");
  const answerInput = document.getElementById("answerInput");
  const submitButton = document.getElementById("submitButton");
  const infoDialog = document.getElementById("infoDialog");
  const closeDialogButton = document.getElementById("closeDialogButton");
  const resumeHelpButton = document.getElementById("resumeHelpButton");
  const reloadButton = document.getElementById("reloadButton");

  let client = null;
  let teams = [];
  let selectedTeamId = null;
  let currentState = null;
  let timerInterval = null;
  let isBusy = false;

  function showScreen(target) {
    screens.forEach((screen) => screen.classList.toggle("active", screen === target));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getDeviceToken() {
    let token = localStorage.getItem(STORAGE.deviceToken);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(STORAGE.deviceToken, token);
    }
    return token;
  }

  function clearLocalSession() {
    localStorage.removeItem(STORAGE.sessionId);
    localStorage.removeItem(STORAGE.teamId);
  }

  function isConfigured() {
    const cfg = window.RC_CONFIG || {};
    return Boolean(
      cfg.SUPABASE_URL &&
      cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_URL.includes("YOUR_PROJECT_ID") &&
      !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")
    );
  }

  function normalizeNumericInput(value) {
    const thaiDigits = "๐๑๒๓๔๕๖๗๘๙";
    return String(value ?? "")
      .trim()
      .replace(/[๐-๙]/g, (digit) => String(thaiDigits.indexOf(digit)))
      .replace(/,/g, "")
      .replace(/\s+/g, "");
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  function mapError(error) {
    const message = String(error?.message || error || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ");
    if (message.includes("TEAM_IN_USE")) return "ทีมนี้เริ่มเกมจากอุปกรณ์อื่นแล้ว กรุณาติดต่อผู้จัดเกม";
    if (message.includes("SESSION_NOT_FOUND")) return "ไม่พบข้อมูลเกมของทีมนี้ กรุณากลับไปเลือกทีมใหม่";
    if (message.includes("INVALID_DEVICE")) return "เกมนี้ถูกเริ่มจากอุปกรณ์อื่น กรุณาติดต่อผู้จัดเกม";
    if (message.includes("GAME_NOT_READY")) return "ผู้จัดเกมยังตั้งค่าฐานข้อมูลไม่ครบ กรุณาติดต่อผู้จัดเกม";
    if (message.includes("Failed to fetch")) return "เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตและค่าตั้งค่า";
    return message;
  }

  function showFatalError(error) {
    console.error(error);
    document.getElementById("fatalErrorText").textContent = mapError(error);
    showScreen(errorScreen);
  }

  function setBusy(value) {
    isBusy = value;
    startButton.disabled = value || !selectedTeamId;
    submitButton.disabled = value;
    answerInput.disabled = value;
    submitButton.textContent = value ? "กำลังตรวจ..." : "ส่งคำตอบ";
  }

  function showFeedback(type, title, message, duration = 1150) {
    const overlay = document.getElementById("feedbackOverlay");
    const card = document.getElementById("feedbackCard");
    const icon = document.getElementById("feedbackIcon");
    document.getElementById("feedbackTitle").textContent = title;
    document.getElementById("feedbackMessage").textContent = message || "";
    icon.textContent = type === "success" ? "✓" : "!";
    card.className = `feedback-card ${type}`;
    overlay.classList.add("show");
    window.setTimeout(() => overlay.classList.remove("show"), duration);
  }

  function renderTeams() {
    teamGrid.innerHTML = "";
    teams.forEach((team) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "team-button";
      button.dataset.teamId = team.id;
      button.textContent = team.name;
      button.disabled = !team.is_enabled;
      button.addEventListener("click", () => {
        selectedTeamId = Number(team.id);
        document.querySelectorAll(".team-button").forEach((item) => {
          item.classList.toggle("selected", Number(item.dataset.teamId) === selectedTeamId);
        });
        startButton.disabled = false;
      });
      teamGrid.appendChild(button);
    });
  }

  function startTimer(state) {
    clearInterval(timerInterval);
    const timerElement = document.getElementById("timer");
    const started = new Date(state.started_at).getTime();
    const tick = () => {
      const elapsed = (Date.now() - started) / 1000;
      timerElement.textContent = formatDuration(elapsed);
    };
    tick();
    timerInterval = window.setInterval(tick, 1000);
  }

  function renderState(state) {
    currentState = state;
    if (!state) throw new Error("ไม่พบสถานะเกม");

    if (state.phase === "completed") {
      clearInterval(timerInterval);
      document.getElementById("completeTeamName").textContent = state.team_name;
      document.getElementById("finishTime").textContent = formatDuration(state.elapsed_seconds);
      showScreen(completeScreen);
      return;
    }

    localStorage.setItem(STORAGE.sessionId, state.session_id);
    localStorage.setItem(STORAGE.teamId, String(state.team_id));

    document.getElementById("currentTeamName").textContent = state.team_name;
    document.getElementById("progressText").textContent = `จุดที่ ${state.current_step} / ${state.total_stations}`;
    document.getElementById("progressBar").style.width = `${Math.max(0, Math.min(100, (state.current_step / state.total_stations) * 100))}%`;

    const phaseBadge = document.getElementById("phaseBadge");
    const missionIcon = document.getElementById("missionIcon");
    const missionKicker = document.getElementById("missionKicker");
    const missionTitle = document.getElementById("missionTitle");
    const missionText = document.getElementById("missionText");
    const clueBox = document.getElementById("clueBox");
    const clueText = document.getElementById("clueText");
    const redInstruction = document.getElementById("redInstruction");
    const answerLabel = document.getElementById("answerLabel");
    const answerHelp = document.getElementById("answerHelp");

    clueBox.classList.add("hidden");
    redInstruction.classList.add("hidden");
    missionText.classList.remove("hidden");

    if (state.phase === "opening") {
      phaseBadge.textContent = "เปิดสถานที่";
      phaseBadge.style.background = "#7da8ff";
      missionIcon.textContent = "🔐";
      missionKicker.textContent = "คำถามเปิดสถานที่";
      missionTitle.textContent = "ตอบคำถามเพื่อรับคำใบ้";
      missionText.textContent = state.opening_question;
      answerLabel.textContent = "กรอกคำตอบเป็นตัวเลข";
      answerInput.placeholder = "กรอกตัวเลข";
      answerHelp.textContent = "ตอบเฉพาะตัวเลข ไม่ต้องใส่หน่วย";
    } else if (state.phase === "rc") {
      phaseBadge.textContent = "ตามหา RC";
      phaseBadge.style.background = "#ffcf5c";
      missionIcon.textContent = "📍";
      missionKicker.textContent = "ภารกิจ ณ สถานที่";
      missionTitle.textContent = "เดินทางไปยังสถานที่ตามคำใบ้";
      missionText.classList.add("hidden");
      clueBox.classList.remove("hidden");
      redInstruction.classList.remove("hidden");
      clueText.textContent = state.location_clue;
      answerLabel.textContent = "กรอกคำตอบจากโจทย์ที่ติดอยู่ ณ จุด RC";
      answerInput.placeholder = "คำตอบจาก RC";
      answerHelp.textContent = "โจทย์จะไม่แสดงในระบบ ให้อ่านโจทย์ที่สถานที่จริง";
    } else if (state.phase === "final") {
      phaseBadge.textContent = "ปิดเกม";
      phaseBadge.style.background = "#ff6b7c";
      missionIcon.textContent = "🏁";
      missionKicker.textContent = "คำถามปิดเกม";
      missionTitle.textContent = "ภารกิจสุดท้าย";
      missionText.textContent = state.final_question;
      answerLabel.textContent = "กรอกผลรวมทั้งหมด";
      answerInput.placeholder = "397,xxx.x";
      answerHelp.textContent = "ใส่เครื่องหมายจุลภาคหรือไม่ใส่ก็ได้";
      document.getElementById("progressBar").style.width = "100%";
    }

    answerInput.value = "";
    answerInput.classList.remove("invalid");
    showScreen(gameScreen);
    startTimer(state);
    window.setTimeout(() => answerInput.focus({ preventScroll: true }), 250);
  }

  async function callRpc(name, params) {
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return data;
  }

  async function loadTeams() {
    const { data, error } = await client
      .from("game_teams")
      .select("id,name,is_enabled")
      .order("id", { ascending: true });
    if (error) throw error;
    teams = data || [];
    if (teams.length !== 14) throw new Error("GAME_NOT_READY: ต้องมีทีมทั้งหมด 14 ทีม");
    renderTeams();
  }

  async function resumeExistingSession() {
    const sessionId = localStorage.getItem(STORAGE.sessionId);
    if (!sessionId) return false;

    try {
      const state = await callRpc("get_game_state", {
        p_session_id: sessionId,
        p_device_token: getDeviceToken()
      });
      renderState(state);
      return true;
    } catch (error) {
      const text = String(error?.message || error);
      if (text.includes("SESSION_NOT_FOUND")) {
        clearLocalSession();
        return false;
      }
      throw error;
    }
  }

  async function initialize() {
    try {
      if (!window.supabase) throw new Error("โหลดไลบรารี Supabase ไม่สำเร็จ");
      if (!isConfigured()) throw new Error("ยังไม่ได้ตั้งค่า SUPABASE_URL และ SUPABASE_ANON_KEY ในไฟล์ config.js");

      client = window.supabase.createClient(
        window.RC_CONFIG.SUPABASE_URL,
        window.RC_CONFIG.SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );

      const resumed = await resumeExistingSession();
      if (resumed) return;

      await loadTeams();
      showScreen(setupScreen);
    } catch (error) {
      showFatalError(error);
    }
  }

  async function startGame() {
    if (!selectedTeamId || isBusy) return;
    setBusy(true);
    try {
      const state = await callRpc("start_game", {
        p_team_id: selectedTeamId,
        p_device_token: getDeviceToken()
      });
      renderState(state);
    } catch (error) {
      showFeedback("error", "เริ่มเกมไม่ได้", mapError(error), 2300);
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(event) {
    event.preventDefault();
    if (!currentState || isBusy) return;

    const answer = normalizeNumericInput(answerInput.value);
    if (!answer || !/^-?\d+(\.\d+)?$/.test(answer)) {
      answerInput.classList.add("invalid");
      showFeedback("error", "กรุณากรอกตัวเลข", "ตรวจสอบคำตอบแล้วลองอีกครั้ง", 1350);
      return;
    }

    setBusy(true);
    answerInput.classList.remove("invalid");

    try {
      const common = {
        p_session_id: currentState.session_id,
        p_device_token: getDeviceToken(),
        p_answer: answer
      };

      let result;
      if (currentState.phase === "opening") {
        result = await callRpc("submit_opening_answer", common);
      } else if (currentState.phase === "rc") {
        result = await callRpc("submit_rc_answer", common);
      } else if (currentState.phase === "final") {
        result = await callRpc("submit_final_answer", common);
      } else {
        throw new Error("สถานะเกมไม่ถูกต้อง");
      }

      if (!result.correct) {
        answerInput.classList.add("invalid");
        answerInput.select();
        showFeedback("error", "คำตอบยังไม่ถูก", "ตอบข้อนี้ใหม่อีกครั้ง", 1350);
        return;
      }

      const feedbackMessage = currentState.phase === "opening"
        ? "รับคำใบ้สถานที่แล้ว"
        : currentState.phase === "rc"
          ? "ผ่านจุด RC แล้ว"
          : "ปิดภารกิจสำเร็จ";

      showFeedback("success", "ตอบถูก!", feedbackMessage, 950);
      window.setTimeout(() => renderState(result), 700);
    } catch (error) {
      showFeedback("error", "เกิดข้อผิดพลาด", mapError(error), 2200);
    } finally {
      setBusy(false);
    }
  }

  startButton.addEventListener("click", startGame);
  answerForm.addEventListener("submit", submitAnswer);
  resumeHelpButton.addEventListener("click", () => infoDialog.showModal());
  closeDialogButton.addEventListener("click", () => infoDialog.close());
  reloadButton.addEventListener("click", () => window.location.reload());
  answerInput.addEventListener("input", () => answerInput.classList.remove("invalid"));

  initialize();
})();
