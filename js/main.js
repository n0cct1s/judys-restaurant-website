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
  const apiBase = String(window.JUDYS_CONFIG?.apiBase || "")
    .trim()
    .replace(/\/+$/, "");
  const apiUrl = (path) => `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;

  const isValidEmail = (email) => {
    const value = String(email || "").trim().toLowerCase();
    if (!value || value.length > 254 || value.includes("..")) return false;
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
      value
    );
  };

  const subscribeEmail = async (email, company = "", source = "newsletter") => {
    let res;
    try {
      res = await fetch(apiUrl("/api/newsletter/subscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company, source }),
      });
    } catch {
      throw new Error(
        apiBase
          ? "Unable to reach the signup server. Please try again later."
          : "Newsletter signup needs the API running (set js/config.js apiBase, or npm start)."
      );
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        json.error ||
          (res.status === 404 || res.status === 405
            ? "Signup API is not connected yet on this website."
            : "Unable to subscribe right now.")
      );
    }
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
        const json = await subscribeEmail(email, company, "newsletter");
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
          msg.textContent = err.message || "Unable to subscribe right now.";
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
        const json = await subscribeEmail(email, company, "coupon");
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

  // Live Google rating (static JSON on Pages; API when Node server is up)
  const ratingRoot = document.querySelector("[data-google-rating]");
  if (ratingRoot) {
    const scoreEl = ratingRoot.querySelector("[data-google-score]");
    const starsEl = ratingRoot.querySelector("[data-google-stars]");

    const starString = (rating) => {
      const rounded = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
      return "\u2605".repeat(rounded) + "\u2606".repeat(5 - rounded);
    };

    const applyRating = (data) => {
      const rating = Number(data?.rating);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) return;
      if (scoreEl) scoreEl.textContent = rating.toFixed(1);
      if (starsEl) starsEl.textContent = starString(rating);
      ratingRoot.setAttribute("aria-label", `${rating.toFixed(1)} Google rating`);
      if (data?.mapsUrl) ratingRoot.setAttribute("href", data.mapsUrl);
      ratingRoot.hidden = false;
    };

    const loadJson = async (url) => {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const type = res.headers.get("content-type") || "";
      if (!type.includes("json")) return null;
      return res.json();
    };

    const loadRating = async () => {
      // Prefer static cache first so GitHub Pages always shows a rating
      const sources = [
        "js/google-rating.json",
        apiUrl("/api/google-rating"),
        "api/google-rating",
      ];
      for (const url of sources) {
        try {
          const data = await loadJson(url);
          if (data && data.rating != null) {
            applyRating(data);
            return;
          }
        } catch {
          // try next source
        }
      }
    };

    loadRating();
  }

  // Dish carousel: seamless ring (3× track) + auto-scroll + swipe + arrows
  const slider = document.querySelector("[data-dish-slider]");
  if (slider) {
    const viewport = slider.querySelector("[data-dish-viewport]") || slider.querySelector(".dish-slider__viewport");
    const track = slider.querySelector("[data-dish-track]");
    const prevBtn = slider.querySelector("[data-dish-prev]");
    const nextBtn = slider.querySelector("[data-dish-next]");
    if (viewport && track) {
      const originals = Array.from(track.children);
      const setCount = originals.length;
      if (setCount < 2) {
        // fall through — nothing to ring
      } else {
      // [copy][originals][copy] — stay in the middle copy for a continuous ring
      const headFrag = document.createDocumentFragment();
      const tailFrag = document.createDocumentFragment();
      originals.forEach((card) => {
        const head = card.cloneNode(true);
        const tail = card.cloneNode(true);
        head.setAttribute("aria-hidden", "true");
        tail.setAttribute("aria-hidden", "true");
        headFrag.appendChild(head);
        tailFrag.appendChild(tail);
      });
      track.insertBefore(headFrag, track.firstChild);
      track.appendChild(tailFrag);

      let autoTimer = null;
      let paused = false;
      let dragging = false;
      let startX = 0;
      let startScroll = 0;
      let moved = false;
      let setWidth = 0;
      let jumping = false;

      const preferReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const stepSize = () => {
        const card = track.querySelector(".dish-card:not([aria-hidden='true'])") || track.querySelector(".dish-card");
        if (!card) return Math.max(180, viewport.clientWidth * 0.7);
        const style = getComputedStyle(track);
        const gap = Number.parseFloat(style.columnGap || style.gap || "0") || 0;
        return card.getBoundingClientRect().width + gap;
      };

      const measureSetWidth = () => {
        // Middle set starts at index setCount
        const cards = Array.from(track.children).slice(setCount, setCount * 2);
        if (!cards.length) {
          setWidth = 0;
          return;
        }
        const first = cards[0];
        const last = cards[cards.length - 1];
        setWidth = last.offsetLeft + last.offsetWidth - first.offsetLeft;
      };

      // Keep scroll in the middle copy — last flows into first with no teleport flash
      const normalizeRing = () => {
        if (jumping || setWidth <= 0) return;
        const left = viewport.scrollLeft;
        if (left >= setWidth * 2) {
          jumping = true;
          viewport.scrollLeft = left - setWidth;
          jumping = false;
        } else if (left < setWidth) {
          jumping = true;
          viewport.scrollLeft = left + setWidth;
          jumping = false;
        }
      };

      const pause = (ms = 5000) => {
        paused = true;
        window.clearTimeout(pause._t);
        pause._t = window.setTimeout(() => {
          paused = false;
        }, ms);
      };

      const scrollByStep = (dir) => {
        if (setWidth <= 0) return;
        normalizeRing();
        viewport.scrollBy({ left: dir * stepSize(), behavior: "smooth" });
        window.setTimeout(normalizeRing, 450);
        pause(6000);
      };

      const tick = () => {
        if (paused || dragging || preferReducedMotion) return;
        scrollByStep(1);
      };

      const startAuto = () => {
        window.clearInterval(autoTimer);
        if (preferReducedMotion) return;
        autoTimer = window.setInterval(tick, 3500);
      };

      if (prevBtn) prevBtn.disabled = false;
      if (nextBtn) nextBtn.disabled = false;
      prevBtn?.addEventListener("click", () => scrollByStep(-1));
      nextBtn?.addEventListener("click", () => scrollByStep(1));

      viewport.addEventListener(
        "scroll",
        () => {
          if (!dragging && !jumping) normalizeRing();
        },
        { passive: true }
      );

      const remountRing = () => {
        measureSetWidth();
        if (setWidth <= 0) return;
        jumping = true;
        // Land on the middle copy, same offset within the set
        const offset = ((viewport.scrollLeft % setWidth) + setWidth) % setWidth;
        viewport.scrollLeft = setWidth + offset;
        jumping = false;
      };

      window.addEventListener("resize", remountRing);
      // Measure after layout
      requestAnimationFrame(() => {
        remountRing();
        startAuto();
      });

      viewport.addEventListener(
        "pointerdown",
        (e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          dragging = true;
          moved = false;
          normalizeRing();
          startX = e.clientX;
          startScroll = viewport.scrollLeft;
          viewport.classList.add("is-dragging");
          viewport.setPointerCapture?.(e.pointerId);
          pause(6000);
        },
        { passive: true }
      );

      viewport.addEventListener(
        "pointermove",
        (e) => {
          if (!dragging) return;
          const dx = e.clientX - startX;
          if (Math.abs(dx) > 4) moved = true;
          let next = startScroll - dx;
          // Keep drag math inside the middle band while swiping across the seam
          if (setWidth > 0) {
            while (next >= setWidth * 2) {
              next -= setWidth;
              startScroll -= setWidth;
            }
            while (next < setWidth) {
              next += setWidth;
              startScroll += setWidth;
            }
          }
          viewport.scrollLeft = next;
        },
        { passive: true }
      );

      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        viewport.classList.remove("is-dragging");
        try {
          viewport.releasePointerCapture?.(e.pointerId);
        } catch {
          // ignore
        }
        normalizeRing();
        pause(6000);
      };

      viewport.addEventListener("pointerup", endDrag);
      viewport.addEventListener("pointercancel", endDrag);
      viewport.addEventListener("pointerleave", endDrag);

      viewport.addEventListener(
        "click",
        (e) => {
          if (moved) {
            e.preventDefault();
            e.stopPropagation();
            moved = false;
          }
        },
        true
      );

      viewport.addEventListener(
        "wheel",
        (e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaY) > 0) {
            viewport.scrollLeft += e.deltaY;
            normalizeRing();
            pause(5000);
          }
        },
        { passive: true }
      );

      viewport.addEventListener(
        "touchstart",
        () => {
          pause(6000);
        },
        { passive: true }
      );

      slider.addEventListener("mouseenter", () => {
        paused = true;
      });
      slider.addEventListener("mouseleave", () => {
        paused = false;
      });

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          window.clearInterval(autoTimer);
        } else {
          startAuto();
        }
      });
      }
    }
  }
})();
