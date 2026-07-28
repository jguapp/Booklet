import { ApiError, getSession, login, logout, saveArticle } from "./api";

const root = document.getElementById("root")!;

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}

async function renderLoginForm() {
  root.replaceChildren();

  const emailInput = el("input", { type: "email", placeholder: "you@example.com" });
  const passwordInput = el("input", { type: "password", placeholder: "••••••••" });
  const status = el("p", { class: "status" });
  const submitButton = el("button", { type: "button" }, ["Log in"]);

  submitButton.addEventListener("click", async () => {
    submitButton.setAttribute("disabled", "true");
    status.textContent = "";
    status.classList.remove("error");
    try {
      await login((emailInput as HTMLInputElement).value, (passwordInput as HTMLInputElement).value);
      await renderSaveView();
    } catch (err) {
      status.classList.add("error");
      status.textContent = err instanceof ApiError ? err.message : "Couldn't log in. Try again.";
      submitButton.removeAttribute("disabled");
    }
  });

  root.append(
    el("label", {}, ["Email"]),
    emailInput,
    el("label", {}, ["Password"]),
    passwordInput,
    submitButton,
    status,
    el("p", { class: "status" }, [
      "Booklet accounts are only for syncing across devices -- log in here to save pages straight to your library.",
    ]),
  );
}

async function renderSaveView() {
  const session = await getSession();
  if (!session) {
    await renderLoginForm();
    return;
  }

  root.replaceChildren();

  const logoutButton = el("button", { type: "button", class: "secondary" }, ["Log out"]);
  logoutButton.addEventListener("click", async () => {
    await logout();
    await renderLoginForm();
  });

  const accountRow = el("div", { class: "account-row" }, [session.email, logoutButton]);
  // Stack account info above the logout button rather than side-by-side --
  // simpler than fighting flexbox in a 280px popup.
  accountRow.style.flexDirection = "column";
  accountRow.style.alignItems = "stretch";
  accountRow.style.gap = "6px";

  const tab = await getActiveTab();
  const status = el("p", { class: "status" });
  const saveButton = el("button", { type: "button" }, ["Save this page"]);

  if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
    saveButton.setAttribute("disabled", "true");
    status.textContent = "This tab isn't a saveable web page.";
  } else {
    saveButton.addEventListener("click", async () => {
      saveButton.setAttribute("disabled", "true");
      status.classList.remove("error");
      status.textContent = "Saving…";
      try {
        const result = await saveArticle(tab.url!);
        if (result.extractionStatus === "FAILED") {
          status.classList.add("error");
          status.textContent = result.extractionError ?? "Saved, but couldn't extract readable content.";
        } else {
          status.textContent = `Saved: ${result.title ?? tab.url}`;
        }
      } catch (err) {
        status.classList.add("error");
        status.textContent = err instanceof ApiError ? err.message : "Couldn't save that page.";
      } finally {
        saveButton.removeAttribute("disabled");
      }
    });
  }

  root.append(accountRow, saveButton, status);
}

renderSaveView();
