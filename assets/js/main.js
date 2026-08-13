/* ===========================================================================
   Qalam & Ahar — runtime enhancement
   No build step, and nothing here is load-bearing for reading the page: the
   words and the catalog are baked into index.html (by hand or by the visual
   builder in /static-admin/builder.html). This script only
     1. refreshes the data-driven lists and the announcement bar from
        /content/*.json, so a CMS edit shows up without re-saving the page,
     2. wires the sign-up form,
     3. adds the scroll-reveal motion.
   If a fetch fails — or JavaScript never runs — the baked-in page stands.
   Rendering logic lives in render.js (shared with the builder).
   =========================================================================== */

(function () {
  "use strict";

  // Opt in to JS-only styling (the scroll-reveal hide) only once this script
  // is actually running, so a blocked script can never strand content hidden.
  document.documentElement.classList.add("js");

  // Everything resolves against the directory the page is served from, so the
  // same files work at user.github.io/repo/ and at a custom domain root.
  var BASE = new URL(".", document.baseURI);

  /** Resolve a CMS media path (`/media/uploads/x.jpg`) against the site base. */
  function asset(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
    return new URL(String(path).replace(/^\/+/, ""), BASE).href;
  }

  var get = window.PureRender.get;
  var isFilled = window.PureRender.isFilled;

  function fetchJSON(name) {
    return fetch(new URL("content/" + name, BASE).href, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error(name + ": HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        console.warn("[content]", err.message);
        return null;
      });
  }

  /* --- the notify form ---------------------------------------------------- */

  /**
   * Where a sign-up goes, in order of preference:
   *   1. the saastarter4-emdash backend, if this site has been told about one
   *   2. any third-party endpoint set in the CMS (Formspree and friends)
   *   3. the visitor's own mail app
   * This repo is public, so none of these can be a secret — the form id
   * identifies a form, it does not authorise anything.
   */
  /** A form's behaviour comes from its symbol's binding, stamped onto the
      markup at export: data-form (the backend form slug), data-endpoint (a
      third-party fallback), data-success (the message). Nothing global. */
  function submitEndpoint(content, form) {
    var backend = get(content, "site.backend") || {};
    var slug = form.dataset.form || backend.form;
    if (isFilled(backend.url) && isFilled(slug)) {
      return String(backend.url).replace(/\/+$/, "") + "/api/f/" + encodeURIComponent(slug);
    }
    return isFilled(form.dataset.endpoint) ? form.dataset.endpoint : "";
  }

  /* --- accounts -------------------------------------------------------------
     A second binding type, wired the same way the notify form is: the symbol
     says what it carries, the export stamps that onto the markup, and this
     reads the markup. Nothing global, and nothing here decides what an account
     may do — the node does, and it only ever hands a new one the default. */

  function apiRoot(content) {
    var backend = get(content, "site.backend") || {};
    return isFilled(backend.url)
      ? String(backend.url).replace(/\/+$/, "") + "/api"
      : "";
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (parsed) {
          return { ok: response.ok, body: parsed };
        });
    });
  }

  function applyAccounts(content) {
    var root = apiRoot(content);
    var scope = document.querySelector('[data-symbol="account-forms"]');
    if (!scope || !root) return;

    var status = scope.querySelector("[data-account-status]");
    var who = scope.querySelector("[data-account-name]");
    var heading = scope.querySelector("[data-account-heading]");

    function say(node, message, isError) {
      if (!node) return;
      node.textContent = message || "";
      node.hidden = !message;
      if (isError) node.setAttribute("data-error", "");
      else node.removeAttribute("data-error");
    }

    /* One attribute on <html> says which half of the page is drawn, and CSS
       does the drawing. The inline script in the head has already set it from
       the stored hint, so by the time this runs the page is usually already
       right and nothing moves; when the hint was wrong — a session that
       expired since — this is what corrects it. */
    function paint(session) {
      var signedIn = Boolean(session && session.user);
      var name = signedIn ? session.user.name || session.user.email : "";

      if (signedIn) document.documentElement.dataset.account = "in";
      else delete document.documentElement.dataset.account;

      if (who) who.textContent = name;
      // The page is not "Sign in" once you are.
      if (heading) heading.textContent = signedIn ? "Your account" : "Sign in";

      // Remembered so the next visit paints straight into the right state. A
      // display hint, never a credential: the server is asked every time.
      try {
        if (signedIn) localStorage.setItem("qa.account", name);
        else localStorage.removeItem("qa.account");
      } catch (error) {
        /* storage refused; the page still works, it just flashes once */
      }
    }

    // The greeting is already filled, during parse, by the inline script beside
    // it. Nothing to do here until the session check comes back.

    function refresh() {
      return fetch(root + "/auth/get-session", { credentials: "include" })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .catch(function () {
          return null;
        })
        .then(paint);
    }

    var signUp = scope.querySelector('form[data-account="sign-up"]');
    if (signUp) {
      signUp.addEventListener("submit", function (event) {
        event.preventDefault();
        var note = signUp.querySelector("[data-account-note]");
        var email = signUp.querySelector('[name="email"]').value;
        var password = signUp.querySelector('[name="password"]').value;
        var nameField = signUp.querySelector('[name="name"]');
        say(note, "Creating your account…");

        post(root + "/public/signup", {
          email: email,
          password: password,
          name: nameField ? nameField.value : "",
        })
          .then(function (result) {
            if (!result.ok) {
              say(note, result.body.error || "That did not work.", true);
              return null;
            }
            // Straight on to the same endpoint an existing visitor uses, so
            // there is one place that mints a session.
            return post(root + "/auth/sign-in/email", {
              email: email,
              password: password,
            });
          })
          .then(function (result) {
            if (!result) return;
            say(note, result.ok ? "" : "Account created. Sign in below.");
            if (result.ok) refresh();
          })
          .catch(function () {
            say(note, "Could not reach the server.", true);
          });
      });
    }

    var signIn = scope.querySelector('form[data-account="sign-in"]');
    if (signIn) {
      signIn.addEventListener("submit", function (event) {
        event.preventDefault();
        var note = signIn.querySelector("[data-account-note]");
        say(note, "Signing in…");
        post(root + "/auth/sign-in/email", {
          email: signIn.querySelector('[name="email"]').value,
          password: signIn.querySelector('[name="password"]').value,
        })
          .then(function (result) {
            if (!result.ok) {
              say(note, "That email and password did not match.", true);
              return;
            }
            say(note, "");
            refresh();
          })
          .catch(function () {
            say(note, "Could not reach the server.", true);
          });
      });
    }

    var out = scope.querySelector("[data-account-sign-out]");
    if (out) {
      out.addEventListener("click", function () {
        post(root + "/auth/sign-out", {}).then(function () {
          paint(null);
        });
      });
    }

    say(status, "");
    refresh();
  }

  function applyForms(content) {
    var mailto = get(content, "site.contact.email");

    document.querySelectorAll("form[data-form], form.notify").forEach(function (form) {
      var action = submitEndpoint(content, form);
      var success = form.dataset.success || "You are on the list. Watch your inbox.";
      form.addEventListener("submit", function (event) {
        event.preventDefault();

        var input = form.querySelector('input[type="email"]');
        var status = form.querySelector(".notify__status");
        var email = input.value.trim();

        if (!input.checkValidity() || !email) {
          say(status, "That email address is not complete. Check it and try again.", "error");
          input.focus();
          return;
        }

        // No form endpoint configured yet: hand the visitor to their mail app
        // rather than silently dropping the address.
        if (!action) {
          if (!isFilled(mailto)) {
            say(status, "The list is not open yet. Try again shortly.", "error");
            return;
          }
          window.location.href =
            "mailto:" +
            mailto +
            "?subject=" +
            encodeURIComponent("Opening notice") +
            "&body=" +
            encodeURIComponent("Please add " + email + " to the list.");
          say(status, "Opening your mail app to finish.");
          return;
        }

        var button = form.querySelector("button[type='submit']");
        button.disabled = true;
        say(status, "Sending…");

        // Sent as FormData on purpose: multipart/form-data is a CORS-safe
        // content type, so the browser skips the preflight round trip that
        // application/json would force on every submission.
        fetch(action, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: new FormData(form),
        })
          .then(function (res) {
            return res.json().then(
              function (body) {
                return { ok: res.ok, body: body };
              },
              function () {
                return { ok: res.ok, body: {} };
              }
            );
          })
          .then(function (result) {
            // The backend reports per-field problems rather than a bare failure.
            var fieldError = (result.body.errors || [])[0];
            if (fieldError) {
              say(status, fieldError.message, "error");
              return;
            }
            if (!result.ok || result.body.success === false) {
              say(status, result.body.message || "That did not send. Try again.", "error");
              return;
            }
            form.reset();
            say(status, result.body.message || success);
          })
          .catch(function () {
            say(status, "That did not send. Try again, or email us directly.", "error");
          })
          .finally(function () {
            button.disabled = false;
          });
      });
    });
  }

  function say(node, message, state) {
    if (!node) return;
    node.textContent = message;
    if (state) {
      node.dataset.state = state;
    } else {
      delete node.dataset.state;
    }
  }

  /* --- scroll reveal ------------------------------------------------------ */

  function reveal(nodes) {
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
      return;
    }

    // Anything still unobserved after a beat gets shown anyway, so a card can
    // never be stranded invisible (print, a stalled observer, a headless render).
    var failsafe = setTimeout(function () {
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
    }, 2500);

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10%" }
    );

    nodes.forEach(function (node) {
      observer.observe(node);
    });

    window.addEventListener("beforeprint", function () {
      clearTimeout(failsafe);
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
    });
  }

  /* --- go ----------------------------------------------------------------- */

  // Content files are discovered from the bindings: site and pages always,
  // plus whatever roots the symbols' Content sources name (catalog.items ->
  // catalog.json, craft.steps -> craft.json, …). Adding a source-bound symbol
  // needs no change here.
  fetchJSON("symbols.json").then(function (manifest) {
    var symbolEntries = {};
    var roots = { site: true, pages: true };

    (((manifest || {}).symbols) || []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      symbolEntries[entry.id] = entry;
      if (isFilled(entry.source)) roots[String(entry.source).split(".")[0]] = true;
    });

    var names = Object.keys(roots);
    return Promise.all(
      names.map(function (name) {
        return fetchJSON(name + ".json");
      })
    ).then(function (parts) {
      var content = { symbolEntries: symbolEntries };
      names.forEach(function (name, index) {
        content[name] = parts[index] || {};
      });
      window.PureRender.bindAll(document, content, { asset: asset });
      applyForms(content);
      applyAccounts(content);

      var lots = document.querySelectorAll(".lot");
      lots.forEach(function (node, index) {
        node.style.setProperty("--reveal-delay", index * 70 + "ms");
      });
      reveal(lots);
    });
  });
})();
