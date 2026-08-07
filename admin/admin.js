(() => {
  const shell = document.getElementById("app");
  const loginView = document.getElementById("login-view");
  const dashboardView = document.getElementById("dashboard-view");
  const loginForm = document.getElementById("login-form");
  const loginMsg = document.getElementById("login-msg");
  const logoutBtn = document.getElementById("logout-btn");
  const stats = document.getElementById("stats");
  const rows = document.getElementById("subscriber-rows");
  const statusFilter = document.getElementById("status-filter");
  const search = document.getElementById("search");
  const campaignForm = document.getElementById("campaign-form");
  const campaignMsg = document.getElementById("campaign-msg");
  const campaignList = document.getElementById("campaign-list");
  const mailStatus = document.getElementById("mail-status");

  let sessionTimer = null;
  const DEFAULT_SESSION_MS = 1000 * 60 * 60 * 2; // 2 hours

  const showMsg = (el, text, ok = true) => {
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("is-ok", ok);
    el.classList.toggle("is-error", !ok);
  };

  const clearSessionTimer = () => {
    if (sessionTimer) {
      clearTimeout(sessionTimer);
      sessionTimer = null;
    }
  };

  const forceLogin = (message) => {
    clearSessionTimer();
    setAuthView(false);
    if (message) showMsg(loginMsg, message, false);
  };

  const scheduleSessionExpiry = (expiresInMs) => {
    clearSessionTimer();
    const wait = Math.max(
      1000,
      Number(expiresInMs) > 0 ? Number(expiresInMs) : DEFAULT_SESSION_MS
    );
    sessionTimer = setTimeout(() => {
      fetch("/api/admin/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      }).catch(() => {});
      forceLogin("Session expired after 2 hours. Please log in again.");
    }, wait);
  };

  const api = async (url, options = {}) => {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      credentials: "same-origin",
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.includes("/api/admin/login")) {
      forceLogin(data.error || "Session expired. Please log in again.");
      throw new Error(data.error || "Unauthorized");
    }
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const setAuthView = (authenticated) => {
    shell?.classList.toggle("is-authed", authenticated);
    loginView.hidden = authenticated;
    dashboardView.hidden = !authenticated;
    if (!authenticated) {
      clearSessionTimer();
      loginForm?.reset();
    }
  };

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const renderStats = (counts) => {
    const items = [
      ["Total", counts.total || 0],
      ["Subscribed", counts.subscribed || 0],
      ["Unsubscribed", counts.unsubscribed || 0],
      ["Bounced", counts.bounced || 0],
    ];
    stats.innerHTML = items
      .map(
        ([label, value]) =>
          `<div class="admin-stat"><strong>${value}</strong><span>${label}</span></div>`
      )
      .join("");
  };

  const renderSubscribers = (subscribers) => {
    if (!subscribers.length) {
      rows.innerHTML =
        '<tr><td colspan="4">No subscribers found for this filter.</td></tr>';
      return;
    }

    rows.innerHTML = subscribers
      .map((sub) => {
        const options = ["subscribed", "unsubscribed", "bounced"]
          .map(
            (status) =>
              `<option value="${status}" ${
                sub.status === status ? "selected" : ""
              }>${status}</option>`
          )
          .join("");
        return `
          <tr data-id="${sub.id}">
            <td>${sub.email}</td>
            <td>
              <span class="status-pill status-pill--${sub.status}">${sub.status}</span>
              <div style="margin-top:.45rem">
                <select data-status>${options}</select>
              </div>
            </td>
            <td>${formatDate(sub.created_at)}</td>
            <td>
              <div class="admin-actions">
                <button type="button" data-save>Save group</button>
                <button type="button" data-delete>Remove</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  };

  const renderCampaigns = (campaigns) => {
    if (!campaigns.length) {
      campaignList.innerHTML = "<li>No campaigns sent yet.</li>";
      return;
    }
    campaignList.innerHTML = campaigns
      .map(
        (c) => `
        <li>
          <strong>${c.subject}</strong>
          <span>
            Sent ${c.sent_count}/${c.recipient_count}
            ${c.failed_count ? ` · Failed ${c.failed_count}` : ""} · ${formatDate(c.created_at)}
          </span>
        </li>
      `
      )
      .join("");
  };

  const loadDashboard = async () => {
    const [subData, campaignData, me] = await Promise.all([
      api(
        `/api/admin/subscribers?status=${encodeURIComponent(
          statusFilter.value || ""
        )}&q=${encodeURIComponent(search.value || "")}`
      ),
      api("/api/admin/campaigns"),
      api("/api/admin/me"),
    ]);

    renderStats(subData.counts);
    renderSubscribers(subData.subscribers);
    renderCampaigns(campaignData.campaigns);
    scheduleSessionExpiry(me.expiresInMs);
    mailStatus.textContent = me.mailConfigured
      ? "SMTP is configured. Campaign emails will be sent for real."
      : "SMTP is not configured yet. Campaigns run in dry-run mode and are logged on the server until you add SMTP settings to .env.";
  };

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const password = new FormData(loginForm).get("password");
      const result = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      loginMsg.hidden = true;
      setAuthView(true);
      scheduleSessionExpiry(result.expiresInMs);
      await loadDashboard();
    } catch (err) {
      showMsg(loginMsg, err.message, false);
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
    forceLogin("");
    loginMsg.hidden = true;
  });

  statusFilter?.addEventListener("change", () => loadDashboard().catch(console.error));
  let searchTimer;
  search?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadDashboard().catch(console.error), 250);
  });

  rows?.addEventListener("click", async (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const id = row.dataset.id;

    if (e.target.matches("[data-save]")) {
      const status = row.querySelector("[data-status]").value;
      try {
        await api(`/api/admin/subscribers/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    }

    if (e.target.matches("[data-delete]")) {
      if (!confirm("Remove this email?")) return;
      try {
        await api(`/api/admin/subscribers/${id}`, { method: "DELETE" });
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  campaignForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(campaignForm);
    const payload = {
      targetStatus: "subscribed",
      subject: form.get("subject"),
      body: form.get("body"),
    };
    if (!confirm("Send this email to everyone in the subscribed group? Their group will not change.")) {
      return;
    }

    try {
      const result = await api("/api/admin/campaigns/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showMsg(campaignMsg, result.message, true);
      campaignForm.reset();
      await loadDashboard();
    } catch (err) {
      showMsg(campaignMsg, err.message, false);
    }
  });

  // Start on login only; show dashboard only after auth check.
  setAuthView(false);
  api("/api/admin/me")
    .then(async (me) => {
      if (!me.authenticated) {
        setAuthView(false);
        return;
      }
      setAuthView(true);
      scheduleSessionExpiry(me.expiresInMs);
      await loadDashboard();
    })
    .catch(() => setAuthView(false));
})();
