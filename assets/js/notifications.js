
  (function(){
    const EXCLUDE = /\/messages\.html$/i;
    if (EXCLUDE.test(location.pathname)) return;

    const CURRENT_USER_ID = localStorage.getItem("userId") || sessionStorage.getItem("userId");
    if (!CURRENT_USER_ID) return;

    let prevCount = 0;
    let bellTimeout = null;

    // Create floating bell
    const bell = document.createElement('div');
    bell.id = "chatBell";
    bell.style.position = "fixed";
    bell.style.right = "24px";
    bell.style.bottom = "24px";
    bell.style.width = "56px";
    bell.style.height = "56px";
    bell.style.borderRadius = "50%";
    bell.style.background = "#800000";
    bell.style.display = "none";
    bell.style.alignItems = "center";
    bell.style.justifyContent = "center";
    bell.style.boxShadow = "0 10px 20px rgba(0,0,0,.2)";
    bell.style.zIndex = "9999";
    bell.innerHTML = '<span style="color:#fff;font-size:26px;line-height:1">🔔</span>';
    document.body.appendChild(bell);

    const style = document.createElement('style');
    style.textContent = `
    @keyframes shakeBell {
      0% { transform: translate(0,0) rotate(0); }
      20% { transform: translate(-2px,0) rotate(-10deg); }
      40% { transform: translate(2px,0) rotate(8deg); }
      60% { transform: translate(-2px,0) rotate(-6deg); }
      80% { transform: translate(2px,0) rotate(4deg); }
      100% { transform: translate(0,0) rotate(0); }
    }
    .shake { animation: shakeBell 0.6s ease-in-out 3; }
    .badge-dot {
      position: absolute; top: -8px; right: -10px;
      min-width: 18px; height: 18px; border-radius: 999px;
      display: inline-flex; align-items:center; justify-content:center;
      background: #9ca3af; color: #fff; font-size: 11px; padding: 0 5px;
    }
    .badge-dot.active { background: #800000; }
    .messages-link-wrap { position: relative; display: inline-block; vertical-align: middle; }
    `;
    document.head.appendChild(style);

    // Try to find a Messages link and attach badge
    function ensureNavBadge(){
      const anchors = Array.from(document.querySelectorAll("a, span"));
      let msgLink = anchors.find(a => (a.tagName==="A" && (/(\/messages\.html)$/i.test(a.getAttribute("href")||"") || /messages\.html/i.test(a.getAttribute("onclick")||""))) )
                || anchors.find(a => /\bMessages\b/i.test(a.textContent||""));
      if (!msgLink) return null;

      // Wrap once
      if (!msgLink.parentElement.classList.contains("messages-link-wrap")) {
        const wrap = document.createElement("span");
        wrap.className = "messages-link-wrap";
        msgLink.parentNode.insertBefore(wrap, msgLink);
        wrap.appendChild(msgLink);
      }
      let wrap = msgLink.parentElement;
      let badge = wrap.querySelector("#navUnreadBadge");
      if (!badge) {
        badge = document.createElement("span");
        badge.id = "navUnreadBadge";
        badge.className = "badge-dot";
        badge.textContent = "0";
        wrap.appendChild(badge);
      }
      return badge;
    }

    const badgeEl = ensureNavBadge();

    async function refreshCount() {
  try {
    const res = await fetch(`/api/messages/unread-count/${CURRENT_USER_ID}`);
    if (!res.ok) {
      console.warn("Unread count fetch failed:", res.status, await res.text());
      return;
    }
    const { count = 0 } = await res.json();

    if (badgeEl) {
      badgeEl.textContent = String(count);
      if (count > 0) badgeEl.classList.add("active");
      else badgeEl.classList.remove("active");
    }
    if (count > prevCount) {
      bell.style.display = "flex";
      bell.classList.add("shake");
      clearTimeout(bellTimeout);
      bellTimeout = setTimeout(() => {
        bell.classList.remove("shake");
        bell.style.display = "none";
      }, 2000);
    }
    prevCount = count;
  } catch (e) {
    console.error("Unread count error:", e);
  }
}


    refreshCount();
    setInterval(refreshCount, 5000);
  })();
