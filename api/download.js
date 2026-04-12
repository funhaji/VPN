function normalizeGithubUrl(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com") return { url: raw, note: "" };
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && parts[2] === "blob") {
      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[3];
      const rest = parts.slice(4).join("/");
      return {
        url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest}`,
        note: "لینک گیتهاب به raw تبدیل شد."
      };
    }
    if (parts.length >= 4 && parts[2] === "releases" && parts[3] === "tag") {
      return {
        url: raw,
        note: "برای دانلود مستقیم از Release، لینک asset را از بخش Assets بردارید."
      };
    }
    return { url: raw, note: "" };
  } catch {
    return { url: raw, note: "" };
  }
}

function buildDownloadUrl(target, filename) {
  const u = new URL("/api/download", window.location.origin);
  u.searchParams.set("url", target);
  if (filename) u.searchParams.set("filename", filename);
  return u.toString();
}

function copyToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("downloadForm");
  const inputUrl = document.getElementById("url");
  const inputFilename = document.getElementById("filename");
  const btnGenerate = document.getElementById("btnGenerate");
  const btnCopy = document.getElementById("btnCopy");
  const btnOpen = document.getElementById("btnOpen");
  const resultBox = document.getElementById("resultBox");
  const resultLink = document.getElementById("resultLink");
  const hint = document.getElementById("urlHint");

  function updatePreview() {
    const raw = String(inputUrl.value || "").trim();
    const filename = String(inputFilename.value || "").trim();
    const mapped = normalizeGithubUrl(raw);
    if (mapped.note) hint.textContent = mapped.note;
    else hint.textContent = "";
    if (!raw) {
      resultBox.hidden = true;
      return;
    }
    const dl = buildDownloadUrl(mapped.url, filename);
    resultLink.textContent = dl;
    resultLink.href = dl;
    btnOpen.href = dl;
    resultBox.hidden = false;
  }

  inputUrl.addEventListener("input", updatePreview);
  inputFilename.addEventListener("input", updatePreview);

  btnGenerate.addEventListener("click", () => {
    updatePreview();
    if (!resultBox.hidden) {
      resultLink.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  btnCopy.addEventListener("click", async () => {
    updatePreview();
    const text = resultLink.href;
    if (!text || text === "#") return;
    await copyToClipboard(text);
    btnCopy.textContent = "کپی شد";
    setTimeout(() => {
      btnCopy.textContent = "کپی";
    }, 900);
  });

  form.addEventListener("submit", () => {
    const raw = String(inputUrl.value || "").trim();
    if (!raw) return;
    const mapped = normalizeGithubUrl(raw);
    if (mapped.url !== raw) {
      inputUrl.value = mapped.url;
    }
  });

  updatePreview();
});
