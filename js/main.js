(() => {
  const header = document.getElementById("header");
  const burger = document.getElementById("burger");
  const nav = document.getElementById("nav");

  const onScroll = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 40);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (burger && header) {
    burger.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = header.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
  }

  nav?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      header?.classList.remove("is-open");
      burger?.setAttribute("aria-expanded", "false");
      burger?.setAttribute("aria-label", "Open menu");
    });
  });

  document.addEventListener("click", (e) => {
    if (!header?.classList.contains("is-open")) return;
    if (header.contains(e.target)) return;
    header.classList.remove("is-open");
    burger?.setAttribute("aria-expanded", "false");
    burger?.setAttribute("aria-label", "Open menu");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !header?.classList.contains("is-open")) return;
    header.classList.remove("is-open");
    burger?.setAttribute("aria-expanded", "false");
    burger?.setAttribute("aria-label", "Open menu");
  });

  // Reveal
  const reveals = document.querySelectorAll(".reveal");
  const show = (el) => el.classList.add("is-visible");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            show(entry.target);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92) show(el);
      else io.observe(el);
    });
  } else {
    reveals.forEach(show);
  }

  // Menu tabs (lunch / dinner / drinks)
  const tabs = document.querySelectorAll(".menu-tab");
  const panels = document.querySelectorAll(".menu-panel");
  const validMenus = new Set(["lunch", "dinner", "drinks"]);

  const activateMenu = (name) => {
    if (!tabs.length || !validMenus.has(name)) return;
    tabs.forEach((tab) => {
      const active = tab.dataset.menu === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    panels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.panel === name);
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.menu;
      activateMenu(name);
      history.replaceState(null, "", `#${name}`);
    });
  });

  const hash = (location.hash || "").replace("#", "").toLowerCase();
  if (validMenus.has(hash)) {
    activateMenu(hash);
    const target = document.getElementById(hash);
    if (target) {
      setTimeout(() => {
        const y = target.getBoundingClientRect().top + window.scrollY - 120;
        window.scrollTo({ top: Math.max(y, 0), behavior: "smooth" });
      }, 50);
    }
  }

  window.addEventListener("hashchange", () => {
    const next = (location.hash || "").replace("#", "").toLowerCase();
    if (validMenus.has(next)) activateMenu(next);
  });

  // Newsletter signup (footer + popup)
  const isValidEmail = (email) => {
    const value = String(email || "").trim().toLowerCase();
    if (!value || value.length > 254 || value.includes("..")) return false;
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
      value
    );
  };

  const subscribeEmail = async (email, company = "") => {
    const res = await fetch("/api/newsletter/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, company }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Unable to subscribe right now.");
    return json;
  };

  document.querySelectorAll("[data-newsletter]").forEach((newsletterForm) => {
    const msg = newsletterForm.querySelector("[data-newsletter-msg]");
    newsletterForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(newsletterForm);
      const email = String(data.get("email") || "").trim();
      const company = String(data.get("company") || "");

      if (msg) {
        msg.hidden = true;
        msg.classList.remove("is-error");
      }

      if (!isValidEmail(email)) {
        if (msg) {
          msg.hidden = false;
          msg.classList.add("is-error");
          msg.textContent = "Please enter a valid email address.";
        }
        return;
      }

      try {
        const json = await subscribeEmail(email, company);
        newsletterForm.reset();
        if (msg) {
          msg.hidden = false;
          msg.textContent =
            json.message || "Thanks for signing up! Watch your inbox for a $10 coupon.";
        }
      } catch (err) {
        if (msg) {
          msg.hidden = false;
          msg.classList.add("is-error");
          msg.textContent =
            err.message ||
            "Newsletter signup needs the site server running (npm start).";
        }
      }
    });
  });

  // First-visit coupon popup
  const COUPON_KEY = "judys_coupon_popup_seen";
  const showCouponPopup = () => {
    const path = location.pathname.toLowerCase();
    if (path.includes("/admin") || path.includes("unsubscribe")) return;
    if (localStorage.getItem(COUPON_KEY)) return;

    const modal = document.createElement("div");
    modal.className = "coupon-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "coupon-modal-title");
    modal.innerHTML = `
      <div class="coupon-modal__dialog">
        <button class="coupon-modal__close" type="button" aria-label="Close">&times;</button>
        <p class="coupon-modal__eyebrow">Welcome Offer</p>
        <h2 class="coupon-modal__title" id="coupon-modal-title">Sign up for a $10 coupon</h2>
        <p class="coupon-modal__text">Join our newsletter for updates, offers, and delicious surprises — and get a $10 coupon.</p>
        <form class="coupon-modal__form" data-coupon-form>
          <label class="sr-only" for="coupon-email">Email</label>
          <input id="coupon-email" name="email" type="email" required placeholder="Your email" autocomplete="email" />
          <div class="hp-field" aria-hidden="true">
            <label for="coupon-company">Company</label>
            <input id="coupon-company" name="company" type="text" tabindex="-1" autocomplete="off" />
          </div>
          <button class="btn" type="submit">Get My $10 Coupon</button>
          <p class="coupon-modal__msg" data-coupon-msg hidden></p>
        </form>
        <button class="coupon-modal__skip" type="button">No thanks</button>
      </div>
    `;
    document.body.appendChild(modal);

    const form = modal.querySelector("[data-coupon-form]");
    const msg = modal.querySelector("[data-coupon-msg]");
    const emailInput = modal.querySelector("#coupon-email");

    const closeModal = (remember = true) => {
      modal.classList.remove("is-open");
      document.body.classList.remove("coupon-modal-open");
      if (remember) localStorage.setItem(COUPON_KEY, "1");
      setTimeout(() => modal.remove(), 280);
    };

    const openModal = () => {
      requestAnimationFrame(() => {
        modal.classList.add("is-open");
        document.body.classList.add("coupon-modal-open");
        emailInput?.focus();
      });
    };

    modal.querySelector(".coupon-modal__close")?.addEventListener("click", () => closeModal(true));
    modal.querySelector(".coupon-modal__skip")?.addEventListener("click", () => closeModal(true));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(true);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal(true);
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const email = String(data.get("email") || "").trim();
      const company = String(data.get("company") || "");
      if (msg) {
        msg.hidden = true;
        msg.classList.remove("is-error");
      }
      if (!isValidEmail(email)) {
        if (msg) {
          msg.hidden = false;
          msg.classList.add("is-error");
          msg.textContent = "Please enter a valid email address.";
        }
        return;
      }
      try {
        const json = await subscribeEmail(email, company);
        if (msg) {
          msg.hidden = false;
          msg.textContent =
            json.message || "Thanks! Watch your inbox for a $10 coupon.";
        }
        form.reset();
        setTimeout(() => closeModal(true), 1400);
      } catch (err) {
        if (msg) {
          msg.hidden = false;
          msg.classList.add("is-error");
          msg.textContent = err.message || "Unable to subscribe right now.";
        }
      }
    });

    setTimeout(openModal, 700);
  };

  showCouponPopup();

  // Dish carousel: 3 visible on desktop, 1 on mobile; advance one by one
  const slider = document.querySelector("[data-dish-slider]");
  if (slider) {
    const track = slider.querySelector("[data-dish-track]");
    const cards = [...slider.querySelectorAll(".dish-card")];
    const prevBtn = slider.querySelector("[data-dish-prev]");
    const nextBtn = slider.querySelector("[data-dish-next]");
    const dotsWrap = slider.querySelector("[data-dish-dots]");
    let index = 0;

    const mq = window.matchMedia("(max-width: 960px)");
    const getPerView = () => (mq.matches ? 1 : 3);
    const getMaxIndex = () => Math.max(0, cards.length - getPerView());

    const buildDots = () => {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = "";
      const max = getMaxIndex();
      for (let i = 0; i <= max; i += 1) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "dish-slider__dot" + (i === index ? " is-active" : "");
        dot.setAttribute("aria-label", `Show dishes starting at ${i + 1}`);
        dot.addEventListener("click", () => goTo(i));
        dotsWrap.appendChild(dot);
      }
    };

    const update = () => {
      if (!track || !cards.length) return;
      const max = getMaxIndex();
      index = Math.max(0, Math.min(max, index));

      const step =
        cards.length > 1
          ? cards[1].offsetLeft - cards[0].offsetLeft
          : cards[0].offsetWidth;
      track.style.transform = `translateX(-${index * step}px)`;

      if (prevBtn) prevBtn.disabled = index === 0;
      if (nextBtn) nextBtn.disabled = index >= max;
      dotsWrap?.querySelectorAll(".dish-slider__dot").forEach((dot, i) => {
        dot.classList.toggle("is-active", i === index);
      });
    };

    const goTo = (i) => {
      index = Math.max(0, Math.min(getMaxIndex(), i));
      update();
    };

    const syncMode = () => {
      buildDots();
      update();
    };

    prevBtn?.addEventListener("click", () => goTo(index - 1));
    nextBtn?.addEventListener("click", () => goTo(index + 1));

    let startX = 0;
    let deltaX = 0;
    let dragging = false;

    track?.addEventListener(
      "touchstart",
      (e) => {
        dragging = true;
        startX = e.touches[0].clientX;
        deltaX = 0;
      },
      { passive: true }
    );

    track?.addEventListener(
      "touchmove",
      (e) => {
        if (!dragging) return;
        deltaX = e.touches[0].clientX - startX;
      },
      { passive: true }
    );

    track?.addEventListener("touchend", () => {
      if (!dragging) return;
      dragging = false;
      if (Math.abs(deltaX) > 40) {
        goTo(deltaX < 0 ? index + 1 : index - 1);
      }
      deltaX = 0;
    });

    mq.addEventListener?.("change", syncMode);
    window.addEventListener("resize", syncMode);
    window.addEventListener("load", syncMode);
    syncMode();
  }
})();
