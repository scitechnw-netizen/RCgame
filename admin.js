(() => {
  "use strict";

  const STORAGE_KEY = "rcQuest.adminCode";
  const loginPanel = document.getElementById("loginPanel");
  const dashboardPanel = document.getElementById("dashboardPanel");
  const loginForm = document.getElementById("loginForm");
  const adminCodeInput = document.getElementById("adminCode");
  const loginButton = document.getElementById("loginButton");
  const loginError = document.getElementById("loginError");
  const refreshButton = document.getElementById("refreshButton");
  const logoutButton = document.getElementById("logoutButton");
  const dashboardError = document.getElementById("dashboardError");
  const lastUpdate = document.getElementById("lastUpdate");
  const calculatePairButton = document.getElementById("calculatePairButton");
  const teamSelectA = document.getElementById("teamSelectA");
  const teamSelectB = document.getElementById("teamSelectB");
  const pairCalculationResult = document.getElementById("pairCalculationResult");

  let client = null;
  let adminCode = "";
  let dashboardData = null;
  let refreshTimer = null;
  let isLoading = false;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[char]));
  }

  function formatDuration(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(Number(totalSeconds))) return "-";
    const seconds = Math.max(0, Math.floor(Number(totalSeconds)));
    const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function statusMeta(status) {
    if (status === "completed") return { label: "ส่งแล้ว", className: "completed" };
    if (status === "playing") return { label: "กำลังเล่น", className: "playing" };
    return { label: "ยังไม่เริ่ม", className: "waiting" };
  }

  function phaseLabel(phase) {
    const labels = {
      opening: "ตอบคำถามเปิด",
      rc: "ตามหา RC",
      final: "คำถามปิดเกม",
      completed: "จบภารกิจ"
    };
    return labels[phase] || "-";
  }

  function setLoginBusy(value) {
    loginButton.disabled = value;
    adminCodeInput.disabled = value;
    loginButton.textContent = value ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ";
  }

  function setDashboardBusy(value) {
    isLoading = value;
    refreshButton.disabled = value;
    refreshButton.textContent = value ? "กำลังโหลด..." : "↻ รีเฟรช";
  }

  function mapError(error) {
    const message = String(error?.message || error || "เกิดข้อผิดพลาด");
    if (message.includes("ADMIN_DENIED")) return "รหัสผ่าน Admin ไม่ถูกต้อง";
    if (message.includes("ADMIN_NOT_READY")) return "ยังไม่ได้ติดตั้งส่วน Admin ใน Supabase";
    if (message.includes("Failed to fetch")) return "เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต";
    return message;
  }

  function showLogin() {
    dashboardPanel.classList.add("hidden");
    loginPanel.classList.remove("hidden");
    clearInterval(refreshTimer);
    refreshTimer = null;
    window.setTimeout(() => adminCodeInput.focus(), 100);
  }

  function showDashboard() {
    loginPanel.classList.add("hidden");
    dashboardPanel.classList.remove("hidden");
  }

  async function callDashboard() {
    const { data, error } = await client.rpc("get_admin_dashboard", { p_admin_code: adminCode });
    if (error) throw error;
    return data;
  }

  function renderSummary(summary) {
    const cards = [
      { key: "total_teams", label: "ทีมทั้งหมด", note: "ทีมย่อย", className: "total" },
      { key: "completed_teams", label: "ส่งสำเร็จ", note: "บันทึกเวลาแล้ว", className: "completed" },
      { key: "playing_teams", label: "กำลังเล่น", note: "อยู่ระหว่างภารกิจ", className: "playing" },
      { key: "not_started_teams", label: "ยังไม่เริ่ม", note: "รอเริ่มเกม", className: "waiting" }
    ];
    document.getElementById("summaryGrid").innerHTML = cards.map((card) => `
      <article class="summary-card ${card.className}">
        <span>${card.label}</span>
        <strong>${Number(summary?.[card.key] || 0)}</strong>
        <small>${card.note}</small>
      </article>
    `).join("");
  }

  function renderOverview(teams) {
    const container = document.getElementById("overviewTeamGrid");
    container.innerHTML = teams.map((team) => {
      const meta = statusMeta(team.status);
      const detail = team.status === "waiting"
        ? "ยังไม่มีเวลาเริ่มเกม"
        : team.status === "completed"
          ? `เวลา ${formatDuration(team.elapsed_seconds)}`
          : `${phaseLabel(team.phase)} • จุด ${team.current_step || 1}/14 • ${formatDuration(team.elapsed_seconds)}`;
      return `
        <article class="overview-team-item">
          <header>
            <strong>${escapeHtml(team.team_name)}</strong>
            <span class="status-pill ${meta.className}">${meta.label}</span>
          </header>
          <p>${escapeHtml(detail)}</p>
        </article>
      `;
    }).join("");
  }

  function renderTeamReport(teams) {
    const body = document.getElementById("teamReportBody");
    body.innerHTML = teams.map((team) => {
      const meta = statusMeta(team.status);
      return `
        <tr>
          <td><strong>${escapeHtml(team.team_name)}</strong></td>
          <td><span class="status-pill ${meta.className}">${meta.label}</span></td>
          <td>${team.status === "waiting" ? '<span class="muted-cell">-</span>' : `${team.current_step || 1}/14 • ${escapeHtml(phaseLabel(team.phase))}`}</td>
          <td>${team.started_at ? formatDateTime(team.started_at) : '<span class="muted-cell">-</span>'}</td>
          <td>${team.completed_at ? formatDateTime(team.completed_at) : '<span class="muted-cell">-</span>'}</td>
          <td class="time-cell">${formatDuration(team.elapsed_seconds)}</td>
          <td>${Number(team.wrong_count || 0)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderGroupRanking(groups) {
    const list = document.getElementById("groupRankingList");
    if (!groups?.length) {
      list.innerHTML = '<div class="empty-admin">ยังไม่มีข้อมูลกลุ่มสำหรับจัดอันดับ</div>';
      return;
    }

    list.innerHTML = groups.map((group) => {
      const ready = Boolean(group.is_complete);
      const rankClass = ready && Number(group.rank_no) <= 3 ? ` rank-${group.rank_no}` : "";
      const rankText = ready ? `#${group.rank_no}` : "รอ";
      const teamATime = group.team_a_elapsed_seconds === null ? "ยังไม่ส่ง" : formatDuration(group.team_a_elapsed_seconds);
      const teamBTime = group.team_b_elapsed_seconds === null ? "ยังไม่ส่ง" : formatDuration(group.team_b_elapsed_seconds);
      return `
        <article class="group-rank-card${rankClass}">
          <div class="group-rank-number">${rankText}</div>
          <div>
            <div class="group-name">กลุ่มใหญ่ ${group.group_no}</div>
            <div class="group-members">
              ${escapeHtml(group.team_a_name)} — ${teamATime}<br />
              ${escapeHtml(group.team_b_name)} — ${teamBTime}
            </div>
          </div>
          <div class="group-total ${ready ? "" : "pending"}">
            <span>เวลารวม</span>
            <strong>${ready ? formatDuration(group.total_elapsed_seconds) : "รอครบ 2 ทีม"}</strong>
          </div>
        </article>
      `;
    }).join("");
  }

  function populateTeamSelectors(teams) {
    const options = teams.map((team) => {
      const suffix = team.status === "completed" ? ` (${formatDuration(team.elapsed_seconds)})` : " (ยังไม่ส่ง)";
      return `<option value="${team.team_id}">${escapeHtml(team.team_name + suffix)}</option>`;
    }).join("");
    teamSelectA.innerHTML = options;
    teamSelectB.innerHTML = options;
    if (teams.length > 1) teamSelectB.selectedIndex = 1;
  }

  function renderDashboard(data) {
    dashboardData = data;
    const teams = Array.isArray(data?.teams) ? data.teams : [];
    const groups = Array.isArray(data?.group_rankings) ? data.group_rankings : [];
    renderSummary(data?.summary || {});
    renderOverview(teams);
    renderTeamReport(teams);
    renderGroupRanking(groups);
    populateTeamSelectors(teams);
    lastUpdate.textContent = `อัปเดตล่าสุด ${new Date().toLocaleString("th-TH")}`;
  }

  async function loadDashboard({ fromLogin = false } = {}) {
    if (isLoading) return;
    setDashboardBusy(true);
    dashboardError.classList.add("hidden");
    try {
      const data = await callDashboard();
      renderDashboard(data);
      sessionStorage.setItem(STORAGE_KEY, adminCode);
      showDashboard();
      if (!refreshTimer) refreshTimer = window.setInterval(() => loadDashboard().catch(() => {}), 15000);
    } catch (error) {
      const message = mapError(error);
      if (fromLogin || String(error?.message || error).includes("ADMIN_DENIED")) {
        sessionStorage.removeItem(STORAGE_KEY);
        loginError.textContent = message;
        loginError.classList.remove("hidden");
        showLogin();
      } else {
        dashboardError.textContent = message;
        dashboardError.classList.remove("hidden");
      }
      throw error;
    } finally {
      setDashboardBusy(false);
    }
  }

  function switchTab(tabName) {
    const allowed = new Set(["overview", "reports", "ranking"]);
    const target = allowed.has(tabName) ? tabName : "overview";
    document.querySelectorAll(".admin-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === target);
    });
    document.querySelectorAll(".admin-tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tab-${target}`);
    });
    history.replaceState(null, "", target === "overview" ? "admin.html" : `#${target}`);
  }

  function calculatePair() {
    pairCalculationResult.classList.remove("hidden", "error");
    const teams = Array.isArray(dashboardData?.teams) ? dashboardData.teams : [];
    const teamA = teams.find((team) => String(team.team_id) === teamSelectA.value);
    const teamB = teams.find((team) => String(team.team_id) === teamSelectB.value);

    if (!teamA || !teamB || teamA.team_id === teamB.team_id) {
      pairCalculationResult.classList.add("error");
      pairCalculationResult.innerHTML = "กรุณาเลือกคนละทีม";
      return;
    }
    if (teamA.status !== "completed" || teamB.status !== "completed") {
      pairCalculationResult.classList.add("error");
      pairCalculationResult.innerHTML = `ยังคำนวณไม่ได้ เพราะต้องส่งสำเร็จครบทั้ง 2 ทีม`;
      return;
    }

    const total = Number(teamA.elapsed_seconds) + Number(teamB.elapsed_seconds);
    pairCalculationResult.innerHTML = `
      ${escapeHtml(teamA.team_name)} ${formatDuration(teamA.elapsed_seconds)} +
      ${escapeHtml(teamB.team_name)} ${formatDuration(teamB.elapsed_seconds)}
      <strong>${formatDuration(total)}</strong>
    `;
  }

  async function initialize() {
    try {
      const cfg = window.RC_CONFIG || {};
      if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR_PROJECT_ID")) {
        throw new Error("ยังไม่ได้ตั้งค่า Supabase ใน config.js");
      }
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });

      const savedCode = sessionStorage.getItem(STORAGE_KEY);
      if (savedCode) {
        adminCode = savedCode;
        try {
          await loadDashboard({ fromLogin: true });
          switchTab(location.hash.replace("#", "") || "overview");
          return;
        } catch (_) {
          // แสดงหน้าเข้าสู่ระบบแทน
        }
      }
      showLogin();
    } catch (error) {
      loginError.textContent = mapError(error);
      loginError.classList.remove("hidden");
      showLogin();
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = adminCodeInput.value.trim();
    if (!value) {
      loginError.textContent = "กรุณากรอกรหัสผ่าน Admin";
      loginError.classList.remove("hidden");
      return;
    }
    adminCode = value;
    loginError.classList.add("hidden");
    setLoginBusy(true);
    try {
      await loadDashboard({ fromLogin: true });
      switchTab(location.hash.replace("#", "") || "overview");
    } catch (_) {
      // ข้อความผิดพลาดถูกแสดงใน loadDashboard แล้ว
    } finally {
      setLoginBusy(false);
    }
  });

  document.querySelectorAll(".admin-tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  refreshButton.addEventListener("click", () => loadDashboard().catch(() => {}));
  logoutButton.addEventListener("click", () => {
    sessionStorage.removeItem(STORAGE_KEY);
    adminCode = "";
    dashboardData = null;
    adminCodeInput.value = "";
    showLogin();
  });
  calculatePairButton.addEventListener("click", calculatePair);
  window.addEventListener("hashchange", () => switchTab(location.hash.replace("#", "") || "overview"));

  initialize();
})();
